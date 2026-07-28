use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{
        Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{
        HeaderMap, StatusCode, Uri,
        header::{AUTHORIZATION, ORIGIN},
    },
    middleware,
    response::{IntoResponse, Redirect, Response},
    routing::{get, post, put},
};
use futures_util::{SinkExt, StreamExt};
use rust_embed::RustEmbed;
use serde::Deserialize;
use serde_json::{Value, json};
use subtle::ConstantTimeEq;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

use crate::{
    error::AppError,
    local_api,
    models::{ExtensionMessage, JobCreate, JobView, terminal_job_status},
    project::build_project,
    state::AppState,
};

#[derive(RustEmbed)]
#[folder = "../pubflow-Pro-Web/dist/"]
struct WebAssets;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(root))
        .route("/publish", get(publish_page))
        .route("/health", get(health))
        .route("/v1/jobs", post(create_job))
        .route("/v1/jobs/{job_id}", get(get_job))
        .route("/v1/extension/ws", get(extension_ws))
        .route("/v1/local/session/challenge", get(local_api::challenge))
        .route("/v1/local/session/login", post(local_api::login))
        .route("/v1/local/session", get(local_api::session))
        .route("/v1/local/session/logout", post(local_api::logout))
        .route(
            "/v1/local/workspace/select",
            post(local_api::select_workspace),
        )
        .route("/v1/local/quota", get(local_api::quota))
        .route("/v1/local/channel/test", post(local_api::channel_test))
        .route(
            "/v1/local/jobs",
            get(local_api::list_jobs).post(local_api::create_job),
        )
        .route(
            "/v1/local/jobs/{job_id}/assets/{asset_id}",
            put(local_api::upload_asset),
        )
        .route(
            "/v1/local/jobs/{job_id}/complete",
            post(local_api::complete_job),
        )
        .fallback(static_asset)
        .layer(TraceLayer::new_for_http())
        .layer(middleware::from_fn(local_api::lan_only))
        .with_state(state)
}

async fn root() -> Redirect {
    Redirect::temporary("/publish?transport=local")
}

async fn publish_page() -> Response {
    static_file("publish/index.html")
}

async fn static_asset(uri: Uri) -> Response {
    let requested = uri.path().trim_start_matches('/');
    let path = match requested {
        "" => "publish/index.html",
        value if value.ends_with('/') => return static_file(&format!("{value}index.html")),
        "publish" => "publish/index.html",
        value => value,
    };
    static_file(path)
}

fn static_file(path: &str) -> Response {
    let Some(asset) = WebAssets::get(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let content_type = mime_guess::from_path(path).first_or_octet_stream();
    (
        StatusCode::OK,
        [
            (axum::http::header::CONTENT_TYPE, content_type.as_ref()),
            (
                axum::http::header::CACHE_CONTROL,
                if path.contains("/assets/") || path.starts_with("assets/") {
                    "public, max-age=31536000, immutable"
                } else {
                    "no-cache"
                },
            ),
        ],
        asset.data,
    )
        .into_response()
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Value> {
    let workspace_matched = *state.extension_workspace_match.read().await;
    let native_publish_authorized = state
        .extension_grant
        .read()
        .await
        .as_ref()
        .is_some_and(|grant| grant.valid_until > chrono::Utc::now().timestamp());
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "workspace": state.settings.workspace_root,
        "extensionConnected": state.events.receiver_count() > 0,
        "workspaceMatched": workspace_matched,
        "nativePublishAuthorized": native_publish_authorized
    }))
}

async fn create_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut request): Json<JobCreate>,
) -> Result<impl IntoResponse, AppError> {
    require_api_token(&headers, &state)?;
    local_api::require_native_capability(&state).await?;
    request
        .validate_and_normalize()
        .map_err(AppError::BadRequest)?;

    let _guard = state.create_lock.lock().await;
    if let Some(request_id) = request.request_id.as_deref()
        && let Some(existing) = state.database.find_by_request_id(request_id).await?
    {
        return Ok((StatusCode::OK, Json(existing)));
    }

    let job_id = Uuid::new_v4().to_string();
    let project_id = Uuid::new_v4().to_string();
    let workspace = state.settings.workspace_root.clone();
    let request_for_build = request.clone();
    let project_id_for_build = project_id.clone();
    let built = tokio::task::spawn_blocking(move || {
        build_project(&workspace, &project_id_for_build, &request_for_build)
    })
    .await
    .map_err(|error| AppError::Internal(error.into()))?
    .map_err(AppError::Internal)?;

    let project_path = built.project_path.to_string_lossy().into_owned();
    let job = state
        .database
        .insert(&job_id, &built.project_id, &project_path, &request)
        .await?;
    let _ = state.events.send(json!({
        "type": "JOB_AVAILABLE",
        "payload": job_summary(&job)
    }));
    Ok((StatusCode::CREATED, Json(job)))
}

async fn get_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Result<Json<JobView>, AppError> {
    require_api_token(&headers, &state)?;
    state
        .database
        .get(&job_id)
        .await?
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("任务 {job_id} 不存在")))
}

#[derive(Debug, Deserialize)]
struct WsAuth {
    token: Option<String>,
}

async fn extension_ws(
    State(state): State<Arc<AppState>>,
    Query(auth): Query<WsAuth>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Result<Response, AppError> {
    validate_extension(&headers, auth.token.as_deref(), &state)?;
    Ok(websocket
        .on_upgrade(move |socket| handle_extension_socket(state, socket))
        .into_response())
}

async fn handle_extension_socket(state: Arc<AppState>, socket: WebSocket) {
    *state.extension_workspace_match.write().await = None;
    *state.extension_version.write().await = None;
    *state.extension_grant.write().await = None;
    let (mut sender, mut receiver) = socket.split();
    let mut events = state.events.subscribe();
    let snapshot = match state.database.next_queued().await {
        Ok(job) => json!({
            "type": "STATE_SNAPSHOT",
            "payload": { "nextJob": job.as_ref().map(job_summary) }
        }),
        Err(error) => {
            tracing::error!(%error, "读取 Agent 队列快照失败");
            return;
        }
    };
    if send_json(&mut sender, snapshot).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            incoming = receiver.next() => {
                let Some(Ok(message)) = incoming else { break; };
                match message {
                    Message::Text(text) => {
                        let response = match serde_json::from_str::<ExtensionMessage>(&text) {
                            Ok(message) => process_extension_message(&state, message).await,
                            Err(error) => Ok(Some(json!({
                                "type": "PROTOCOL_ERROR",
                                "payload": { "error": error.to_string() }
                            }))),
                        };
                        match response {
                            Ok(Some(message)) => {
                                if send_json(&mut sender, message).await.is_err() { break; }
                            }
                            Ok(None) => {}
                            Err(error) => {
                                let message = json!({
                                    "type": "PROTOCOL_ERROR",
                                    "payload": { "error": error.to_string() }
                                });
                                if send_json(&mut sender, message).await.is_err() { break; }
                            }
                        }
                    }
                    Message::Ping(payload) => {
                        if sender.send(Message::Pong(payload)).await.is_err() { break; }
                    }
                    Message::Close(_) => break,
                    Message::Binary(_) | Message::Pong(_) => {}
                }
            }
            event = events.recv() => {
                match event {
                    Ok(message) => {
                        if send_json(&mut sender, message).await.is_err() { break; }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
    *state.extension_workspace_match.write().await = None;
    *state.extension_version.write().await = None;
    *state.extension_grant.write().await = None;
}

async fn process_extension_message(
    state: &Arc<AppState>,
    message: ExtensionMessage,
) -> Result<Option<Value>, AppError> {
    match message {
        ExtensionMessage::Hello(payload) => {
            let workspace_matched =
                payload.workspace_id.as_deref() == Some(state.settings.workspace_id.as_str());
            let grant = validate_extension_grant(payload.license_grant);
            let native_publish_authorized = grant.is_some();
            *state.extension_workspace_match.write().await = Some(workspace_matched);
            *state.extension_version.write().await = payload.version.clone();
            *state.extension_grant.write().await = grant;
            tracing::info!(
                extension_id = payload.extension_id.as_deref().unwrap_or("unknown"),
                version = payload.version.as_deref().unwrap_or("unknown"),
                workspace_matched,
                native_publish_authorized,
                "Chrome 插件已连接"
            );
            Ok(Some(json!({
                "type": "HELLO_ACK",
                "payload": {
                    "version": env!("CARGO_PKG_VERSION"),
                    "workspaceMatched": workspace_matched,
                    "nativePublishAuthorized": native_publish_authorized
                }
            })))
        }
        ExtensionMessage::Ping(payload) => Ok(Some(json!({
            "type": "PONG",
            "payload": payload
        }))),
        ExtensionMessage::ClaimJob(payload) => {
            if local_api::require_native_capability(state).await.is_err() {
                return Ok(Some(json!({
                    "type": "JOB_REJECTED",
                    "payload": {
                        "jobId": payload.job_id,
                        "code": "NATIVE_PUBLISH_NOT_AUTHORIZED"
                    }
                })));
            }
            let Some(job) = state.database.claim(&payload.job_id).await? else {
                return Ok(Some(json!({
                    "type": "JOB_REJECTED",
                    "payload": {
                        "jobId": payload.job_id,
                        "code": "BUSY_OR_NOT_QUEUED"
                    }
                })));
            };
            let Some((_, request)) = state.database.detail(&job.job_id).await? else {
                return Err(AppError::NotFound(format!("任务 {} 不存在", job.job_id)));
            };
            Ok(Some(json!({
                "type": "JOB_DETAIL",
                "payload": {
                    "jobId": job.job_id,
                    "projectId": job.project_id,
                    "projectPath": job.project_path,
                    "contentType": request.content_type,
                    "title": request.title,
                    "platforms": request.platforms,
                    "autoSubmit": request.publish_mode == crate::models::PublishMode::AutoSubmit,
                    "status": job.status,
                    "statusSequence": job.status_sequence
                }
            })))
        }
        ExtensionMessage::JobAccepted(payload) => {
            state
                .database
                .update_status(&payload.job_id, "running", payload.status_sequence, None)
                .await?;
            Ok(None)
        }
        ExtensionMessage::JobStatus(payload) => {
            if !matches!(
                payload.status.as_str(),
                "running" | "completed" | "failed" | "cancelled"
            ) {
                return Err(AppError::BadRequest(format!(
                    "未知任务状态：{}",
                    payload.status
                )));
            }
            let _task_snapshot = payload.task;
            let updated = state
                .database
                .update_status(
                    &payload.job_id,
                    &payload.status,
                    payload.status_sequence,
                    payload.error.as_deref(),
                )
                .await?;
            if terminal_job_status(&updated.status)
                && let Some(next) = state.database.next_queued().await?
            {
                let _ = state.events.send(json!({
                    "type": "JOB_AVAILABLE",
                    "payload": job_summary(&next)
                }));
            }
            Ok(Some(json!({
                "type": "JOB_STATUS_ACK",
                "payload": {
                    "jobId": updated.job_id,
                    "status": updated.status,
                    "statusSequence": updated.status_sequence
                }
            })))
        }
    }
}

fn validate_extension_grant(
    grant: Option<crate::models::ExtensionLicenseGrant>,
) -> Option<crate::state::ExtensionGrant> {
    let grant = grant?;
    let expected = match grant.tier.as_str() {
        "plus" => vec!["batch", "native-publish", "publish", "selector-updates"],
        "pro" => vec![
            "batch",
            "native-publish",
            "publish",
            "remote-publish",
            "selector-updates",
        ],
        _ => return None,
    };
    let valid_until = grant.valid_until?;
    if valid_until <= chrono::Utc::now().timestamp() {
        return None;
    }
    let mut actual = grant.features.clone();
    actual.sort();
    actual.dedup();
    if actual != expected {
        return None;
    }
    Some(crate::state::ExtensionGrant {
        tier: grant.tier,
        features: grant.features,
        valid_until,
    })
}

fn require_api_token(headers: &HeaderMap, state: &AppState) -> Result<(), AppError> {
    let supplied = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("");
    if constant_time_eq(supplied, &state.settings.api_token) {
        Ok(())
    } else {
        Err(AppError::Unauthorized)
    }
}

fn validate_extension(
    headers: &HeaderMap,
    supplied_token: Option<&str>,
    state: &AppState,
) -> Result<(), AppError> {
    let origin = headers
        .get(ORIGIN)
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    let extension_id = origin
        .strip_prefix("chrome-extension://")
        .or_else(|| origin.strip_prefix("moz-extension://"))
        .filter(|value| !value.is_empty() && !value.contains('/'))
        .ok_or(AppError::Unauthorized)?;
    if !state.settings.allowed_extension_ids.is_empty()
        && !state
            .settings
            .allowed_extension_ids
            .iter()
            .any(|allowed| allowed == extension_id)
    {
        return Err(AppError::Unauthorized);
    }
    if let Some(expected) = state.settings.extension_token.as_deref()
        && !constant_time_eq(supplied_token.unwrap_or(""), expected)
    {
        return Err(AppError::Unauthorized);
    }
    Ok(())
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    left.as_bytes().ct_eq(right.as_bytes()).into()
}

pub(crate) fn job_summary(job: &JobView) -> Value {
    json!({ "jobId": job.job_id, "projectId": job.project_id })
}

async fn send_json(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    value: Value,
) -> Result<(), axum::Error> {
    sender.send(Message::Text(value.to_string().into())).await
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        net::{IpAddr, Ipv4Addr, SocketAddr},
    };

    use futures_util::{SinkExt, StreamExt};
    use tempfile::tempdir;
    use tokio_tungstenite::{
        connect_async,
        tungstenite::{Message as ClientMessage, client::IntoClientRequest, http::HeaderValue},
    };

    use super::*;
    use crate::{
        config::Settings,
        database::JobDatabase,
        models::{AssetInput, ContentType, PlatformId, Visibility},
        state::AppState,
    };

    #[tokio::test]
    async fn publish_page_is_served_without_a_redirect_loop() {
        let response = publish_page().await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(axum::http::header::CONTENT_TYPE),
            Some(&HeaderValue::from_static("text/html"))
        );
    }

    #[test]
    fn extension_grant_rejects_basic_expired_and_incomplete_capabilities() {
        use crate::models::ExtensionLicenseGrant;

        assert!(
            validate_extension_grant(Some(ExtensionLicenseGrant {
                tier: "basic".to_owned(),
                features: vec![
                    "publish".to_owned(),
                    "batch".to_owned(),
                    "selector-updates".to_owned()
                ],
                valid_until: Some(chrono::Utc::now().timestamp() + 3600),
            }))
            .is_none()
        );
        assert!(
            validate_extension_grant(Some(ExtensionLicenseGrant {
                tier: "plus".to_owned(),
                features: vec![
                    "publish".to_owned(),
                    "batch".to_owned(),
                    "selector-updates".to_owned(),
                    "native-publish".to_owned(),
                ],
                valid_until: Some(chrono::Utc::now().timestamp() - 1),
            }))
            .is_none()
        );
        assert!(
            validate_extension_grant(Some(ExtensionLicenseGrant {
                tier: "plus".to_owned(),
                features: vec!["publish".to_owned(), "native-publish".to_owned()],
                valid_until: Some(chrono::Utc::now().timestamp() + 3600),
            }))
            .is_none()
        );
    }

    #[tokio::test]
    async fn websocket_sends_snapshot_and_claims_job() {
        let directory = tempdir().unwrap();
        let database = JobDatabase::connect(&directory.path().join("jobs.sqlite3"))
            .await
            .unwrap();
        let request = JobCreate {
            request_id: Some("ws-request".to_owned()),
            content_type: ContentType::Video,
            title: "WebSocket task".to_owned(),
            description: String::new(),
            article_content: None,
            topics: vec![],
            campaign_ids: vec![],
            platforms: vec![PlatformId::Douyin],
            scheduled_at: None,
            visibility: Visibility::Public,
            original_declare: false,
            platform_settings: BTreeMap::new(),
            fill_options: None,
            publish_mode: crate::models::PublishMode::FillOnly,
            assets: AssetInput {
                video_path: Some("/tmp/video.mp4".to_owned()),
                ..AssetInput::default()
            },
        };
        database
            .insert("job-ws", "project-ws", "/workspace/project-ws", &request)
            .await
            .unwrap();
        let settings = Settings {
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            data_dir: directory.path().join("data"),
            workspace_root: directory.path().join("workspace"),
            workspace_id: "workspace-test-id".to_owned(),
            local_password: "123456".to_owned(),
            api_token: "test-api-token-at-least-24-characters".to_owned(),
            extension_token: None,
            allowed_extension_ids: vec![],
        };
        let state = AppState::new(settings, database.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                router(state).into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        });

        let mut handshake = format!("ws://{address}/v1/extension/ws")
            .into_client_request()
            .unwrap();
        handshake.headers_mut().insert(
            "origin",
            HeaderValue::from_static("chrome-extension://pubflow-test"),
        );
        let (mut websocket, _) = connect_async(handshake).await.unwrap();
        let snapshot = websocket
            .next()
            .await
            .unwrap()
            .unwrap()
            .into_text()
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&snapshot).unwrap()["type"],
            "STATE_SNAPSHOT"
        );

        websocket
            .send(ClientMessage::Text(
                json!({
                    "type": "HELLO",
                    "payload": {
                        "extensionId": "pubflow-test",
                        "version": "0.1.0",
                        "workspaceId": "workspace-test-id",
                        "licenseGrant": {
                            "tier": "pro",
                            "features": [
                                "publish",
                                "batch",
                                "selector-updates",
                                "native-publish",
                                "remote-publish"
                            ],
                            "validUntil": chrono::Utc::now().timestamp() + 3600
                        }
                    }
                })
                .to_string()
                .into(),
            ))
            .await
            .unwrap();
        let hello_ack = websocket
            .next()
            .await
            .unwrap()
            .unwrap()
            .into_text()
            .unwrap();
        let hello_ack: Value = serde_json::from_str(&hello_ack).unwrap();
        assert_eq!(hello_ack["type"], "HELLO_ACK");
        assert_eq!(hello_ack["payload"]["workspaceMatched"], true);
        assert_eq!(hello_ack["payload"]["nativePublishAuthorized"], true);

        websocket
            .send(ClientMessage::Text(
                json!({ "type": "CLAIM_JOB", "payload": { "jobId": "job-ws" } })
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let detail = websocket
            .next()
            .await
            .unwrap()
            .unwrap()
            .into_text()
            .unwrap();
        let detail: Value = serde_json::from_str(&detail).unwrap();
        assert_eq!(detail["type"], "JOB_DETAIL");
        assert_eq!(detail["payload"]["projectId"], "project-ws");
        assert_eq!(
            database.get("job-ws").await.unwrap().unwrap().status,
            "claimed"
        );

        websocket
            .send(ClientMessage::Text(
                json!({
                    "type": "JOB_ACCEPTED",
                    "payload": { "jobId": "job-ws", "statusSequence": 1 }
                })
                .to_string()
                .into(),
            ))
            .await
            .unwrap();
        websocket
            .send(ClientMessage::Text(
                json!({
                    "type": "JOB_STATUS",
                    "payload": {
                        "jobId": "job-ws",
                        "status": "failed",
                        "statusSequence": 2,
                        "error": "test failure"
                    }
                })
                .to_string()
                .into(),
            ))
            .await
            .unwrap();
        let acknowledgement = websocket
            .next()
            .await
            .unwrap()
            .unwrap()
            .into_text()
            .unwrap();
        let acknowledgement: Value = serde_json::from_str(&acknowledgement).unwrap();
        assert_eq!(acknowledgement["type"], "JOB_STATUS_ACK");
        assert_eq!(
            database.get("job-ws").await.unwrap().unwrap().status,
            "failed"
        );

        server.abort();
    }
}
