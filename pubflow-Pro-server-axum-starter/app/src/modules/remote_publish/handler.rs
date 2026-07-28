use std::{collections::HashMap, sync::Arc, time::Duration};

use crate::core::state::{RemoteExtensionConnection, RemoteProbeRequest};
use crate::lease::dto::DeviceProof;
use crate::lease::service::LeaseService;
use crate::shared::FromState;
use axum::{
    Json,
    body::Body,
    extract::{Path, State},
    extract::{
        Query, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use pubflow_core::remote_protocol::{decode_auth, decode_message, encode_message};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{io::AsyncWriteExt, sync::oneshot, time::Instant};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use super::{
    dto::{
        AdminQuotaOverrideRequest, ChannelTestView, CreateJobRequest, JobListView, LoginRequest,
    },
    service::{ACCESS_COOKIE, IssuedSession, REFRESH_COOKIE, RemotePublishService},
};

pub async fn admin_set_quota(
    State(state): State<Arc<AppState>>,
    Path(license_id): Path<Uuid>,
    Json(req): Json<AdminQuotaOverrideRequest>,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    Ok(ApiResponse::success(
        service
            .set_quota_override(license_id, req.job_limit, req.byte_limit)
            .await?,
    )
    .into_response())
}
use crate::{ApiResponse, AppError, AppState, PubFlowError, ValidationError};

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginRequest>,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    let issued = service.login(&req.activation_code).await?;
    Ok(session_response(&service, issued))
}

pub async fn refresh(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    let refresh = cookie(&headers, REFRESH_COOKIE).ok_or(crate::AuthError::InvalidToken)?;
    let issued = service.refresh(refresh).await?;
    Ok(session_response(&service, issued))
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    if let Some(access) = cookie(&headers, ACCESS_COOKIE)
        && let Ok((session, _)) = service.authenticate_access(access).await
    {
        service.revoke_session(session.id).await?;
    }
    let mut response_headers = HeaderMap::new();
    append_cookie(
        &mut response_headers,
        expired_cookie(ACCESS_COOKIE, service.secure_cookies()),
    )?;
    append_cookie(
        &mut response_headers,
        expired_cookie(REFRESH_COOKIE, service.secure_cookies()),
    )?;
    Ok((
        response_headers,
        ApiResponse::success(serde_json::json!({"loggedOut": true})),
    )
        .into_response())
}

pub async fn session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    let (session, license) = authenticate(&service, &headers).await?;
    Ok(ApiResponse::success(service.session_view(&session, &license)).into_response())
}

pub async fn create_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreateJobRequest>,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    let (_, license) = authenticate(&service, &headers).await?;
    let (job, created) = service.create_job(&license, req).await?;
    Ok((
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        ApiResponse::success(job),
    )
        .into_response())
}

pub async fn list_jobs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    let (_, license) = authenticate(&service, &headers).await?;
    let items = service.list_jobs(license.id).await?;
    Ok(ApiResponse::success(JobListView { items }).into_response())
}

pub async fn get_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    let (_, license) = authenticate(&service, &headers).await?;
    Ok(ApiResponse::success(service.get_job(license.id, job_id).await?).into_response())
}

pub async fn quota(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    let (_, license) = authenticate(&service, &headers).await?;
    Ok(ApiResponse::success(service.quota(&license).await?).into_response())
}

pub async fn test_channel(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    let (_, license) = authenticate(&service, &headers).await?;
    let probe_sender = state
        .remote_connections
        .lock()
        .await
        .get(&license.id)
        .map(|connection| connection.probe_sender.clone())
        .ok_or(PubFlowError::RemoteExtensionOffline)?;
    let (response, receiver) = oneshot::channel();
    probe_sender
        .try_send(RemoteProbeRequest {
            test_id: Uuid::new_v4(),
            requested_at: Instant::now().into_std(),
            response,
        })
        .map_err(|error| match error {
            tokio::sync::mpsc::error::TrySendError::Full(_) => PubFlowError::RateLimitExceeded,
            tokio::sync::mpsc::error::TrySendError::Closed(_) => {
                PubFlowError::RemoteExtensionOffline
            }
        })?;
    let result = tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| PubFlowError::RemoteExtensionTimeout)?
        .map_err(|_| PubFlowError::RemoteExtensionOffline)?;
    Ok(ApiResponse::success(ChannelTestView {
        connected: true,
        latency_ms: result.latency_ms,
        tested_at: chrono::Utc::now(),
        extension_version: result.extension_version,
    })
    .into_response())
}

pub async fn upload_asset(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((job_id, asset_id)): Path<(Uuid, Uuid)>,
    body: Body,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    let (_, license) = authenticate(&service, &headers).await?;
    let (job, asset) = service.owned_asset(license.id, job_id, asset_id).await?;
    if job.status != "uploading" {
        return Err(PubFlowError::InvalidRemoteJobState.into());
    }
    if asset.status == "uploaded" {
        return Ok(
            ApiResponse::success(service.get_job(license.id, job_id).await?).into_response(),
        );
    }
    if let Some(content_length) = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok())
        && content_length != asset.declared_size
    {
        return Err(ValidationError::custom("素材 Content-Length 与声明长度不一致").into());
    }

    let _transfer_permit = state.remote_transfer_limiter.acquire().await;
    let (part_path, final_path) = service.pending_asset_path(license.id, job_id, asset_id);
    if let Some(parent) = part_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut file = tokio::fs::File::create(&part_path).await?;
    let mut stream = body.into_data_stream();
    let mut hasher = Sha256::new();
    let mut received = 0i64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|error| PubFlowError::Internal(format!("读取素材上传流失败: {error}")))?;
        received = received.saturating_add(chunk.len() as i64);
        if received > asset.declared_size {
            drop(file);
            let _ = tokio::fs::remove_file(&part_path).await;
            return Err(ValidationError::custom("素材上传长度超过声明值").into());
        }
        state.remote_transfer_limiter.pace(chunk.len()).await;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    drop(file);
    let actual_hash = hex::encode(hasher.finalize());
    if received != asset.declared_size || actual_hash != asset.sha256 {
        let _ = tokio::fs::remove_file(&part_path).await;
        return Err(ValidationError::custom("素材长度或 SHA-256 校验失败").into());
    }
    tokio::fs::rename(&part_path, &final_path).await?;
    service.commit_asset(asset, &final_path).await?;
    Ok(ApiResponse::success(service.get_job(license.id, job_id).await?).into_response())
}

pub async fn complete_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    let (_, license) = authenticate(&service, &headers).await?;
    let job = service.complete_job(license.id, job_id).await?;
    state.notify_remote_job(license.id).await;
    Ok(ApiResponse::success(job).into_response())
}

pub async fn extension_ws(State(state): State<Arc<AppState>>, ws: WebSocketUpgrade) -> Response {
    ws.protocols(["pfrp.v1"])
        .on_upgrade(move |socket| handle_extension_socket(state, socket))
}

#[derive(Deserialize)]
pub struct AssetTicketQuery {
    ticket: String,
}

pub async fn download_asset(
    State(state): State<Arc<AppState>>,
    Path(asset_id): Path<Uuid>,
    Query(query): Query<AssetTicketQuery>,
) -> Result<Response, AppError> {
    let service = RemotePublishService::from_state(&state);
    let (asset, path) = service
        .download_asset_with_ticket(asset_id, &query.ticket)
        .await?;
    let transfer_permit = state.remote_transfer_limiter.acquire().await;
    let file = tokio::fs::File::open(path).await?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(
            asset
                .content_type
                .as_deref()
                .unwrap_or("application/octet-stream"),
        )
        .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&asset.declared_size.to_string())
            .map_err(|_| PubFlowError::Internal("素材长度无效".to_string()))?,
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    let limiter = state.remote_transfer_limiter.clone();
    let stream = ReaderStream::new(file)
        .then(move |result| {
            let limiter = limiter.clone();
            async move {
                if let Ok(chunk) = &result {
                    limiter.pace(chunk.len()).await;
                }
                result
            }
        })
        .map(move |result| {
            let _keep_permit_alive = &transfer_permit;
            result
        });
    Ok((headers, Body::from_stream(stream)).into_response())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionAuth {
    lease_token: String,
    client_install_id: String,
    device_proof: DeviceProof,
    extension_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    content = "payload",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
enum ClientMessage {
    Ping {
        timestamp: Option<i64>,
    },
    ClaimJob {
        job_id: String,
    },
    JobStatus(super::dto::JobStatusMessage),
    ProjectMaterialized {
        job_id: String,
        status_sequence: i64,
    },
    ChannelProbeAck {
        test_id: String,
        server_sent_at: i64,
    },
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "type",
    content = "payload",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
enum ServerMessage {
    AuthOk {
        protocol_version: u8,
        server_time: i64,
    },
    Pong {
        timestamp: i64,
    },
    ChannelProbe {
        test_id: String,
        server_sent_at: i64,
    },
    JobAvailable {
        job_id: String,
        title: String,
        content_type: String,
    },
    JobDetail(serde_json::Value),
    Ack {
        job_id: String,
        status: String,
        status_sequence: i64,
    },
    Error {
        code: String,
        message: String,
    },
}

async fn handle_extension_socket(state: Arc<AppState>, mut socket: WebSocket) {
    let auth_frame =
        match tokio::time::timeout(std::time::Duration::from_secs(10), socket.recv()).await {
            Ok(Some(Ok(Message::Binary(bytes)))) => bytes,
            _ => {
                let _ = socket
                    .send(Message::Close(Some(CloseFrame {
                        code: 1008,
                        reason: "PFRP auth required".into(),
                    })))
                    .await;
                return;
            }
        };
    let decoded = match decode_auth::<ExtensionAuth>(
        &auth_frame,
        &state.config.selector_protocol_private_key,
    ) {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, "PFRP auth frame rejected");
            let _ = socket
                .send(Message::Close(Some(CloseFrame {
                    code: 1008,
                    reason: "PFRP auth failed".into(),
                })))
                .await;
            return;
        }
    };
    if (chrono::Utc::now().timestamp_millis() - decoded.timestamp_ms).abs()
        > state.config.selector_replay_window_seconds * 1000
    {
        let _ = socket
            .send(Message::Close(Some(CloseFrame {
                code: 1008,
                reason: "PFRP auth expired".into(),
            })))
            .await;
        return;
    }
    let lease_service = LeaseService::from_state(&state);
    let (license, _) = match lease_service
        .authenticate_remote_connection(
            &decoded.payload.lease_token,
            &decoded.payload.client_install_id,
            &decoded.payload.device_proof,
        )
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, "PFRP lease authentication rejected");
            let _ = socket
                .send(Message::Close(Some(CloseFrame {
                    code: 1008,
                    reason: "device authentication failed".into(),
                })))
                .await;
            return;
        }
    };
    tracing::info!(license_id = %license.id, install_id = %decoded.payload.client_install_id, extension_version = ?decoded.payload.extension_version, "PFRP extension connected");
    let connection_id = Uuid::new_v4();
    let extension_version = decoded.payload.extension_version.clone();
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel();
    let (probe_sender, mut probe_receiver) = tokio::sync::mpsc::channel(4);
    let (job_sender, mut job_receiver) = tokio::sync::mpsc::channel(1);
    let service = RemotePublishService::from_state(&state);
    let mut send_sequence = 1u64;
    let mut receive_sequence = 1u64;
    let mut pending_probes: HashMap<Uuid, (i64, RemoteProbeRequest)> = HashMap::new();
    if send_pfrp(
        &mut socket,
        &ServerMessage::AuthOk {
            protocol_version: 1,
            server_time: chrono::Utc::now().timestamp_millis(),
        },
        &decoded.keys.server_to_client,
        &mut send_sequence,
    )
    .await
    .is_err()
    {
        return;
    }
    if send_next_available(
        &service,
        &mut socket,
        license.id,
        &decoded.keys.server_to_client,
        &mut send_sequence,
    )
    .await
    .is_err()
    {
        return;
    }
    if let Some(previous) = state.remote_connections.lock().await.insert(
        license.id,
        RemoteExtensionConnection {
            connection_id,
            cancel: cancel_tx,
            probe_sender,
            job_sender,
        },
    ) {
        let _ = previous.cancel.send(());
    }

    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                let _ = socket.send(Message::Close(Some(CloseFrame { code: 1000, reason: "replaced by a newer connection".into() }))).await;
                break;
            }
            notification = job_receiver.recv() => {
                if notification.is_none()
                    || send_next_available(&service, &mut socket, license.id, &decoded.keys.server_to_client, &mut send_sequence).await.is_err() { break; }
            }
            probe = probe_receiver.recv() => {
                let Some(probe) = probe else { break; };
                pending_probes.retain(|_, (_, pending)| !pending.response.is_closed());
                if pending_probes.len() >= 4 {
                    tracing::warn!(license_id = %license.id, "PFRP pending probe limit reached");
                    continue;
                }
                let test_id = probe.test_id;
                let server_sent_at = chrono::Utc::now().timestamp_millis();
                pending_probes.insert(test_id, (server_sent_at, probe));
                if send_pfrp(
                    &mut socket,
                    &ServerMessage::ChannelProbe {
                        test_id: test_id.to_string(),
                        server_sent_at,
                    },
                    &decoded.keys.server_to_client,
                    &mut send_sequence,
                )
                .await
                .is_err()
                {
                    break;
                }
            }
            incoming = socket.recv() => {
                let Some(Ok(message)) = incoming else { break; };
                match message {
                    Message::Binary(bytes) => {
                        let command = match decode_message::<ClientMessage>(&bytes, &decoded.keys.client_to_server, receive_sequence) {
                            Ok(command) => { receive_sequence += 1; command },
                            Err(error) => { tracing::warn!(license_id = %license.id, %error, "PFRP message rejected"); break; }
                        };
                        let command = match command {
                            ClientMessage::ChannelProbeAck { test_id, server_sent_at } => {
                                let Ok(test_id) = Uuid::parse_str(&test_id) else {
                                    tracing::warn!(license_id = %license.id, "PFRP probe ACK testId rejected");
                                    break;
                                };
                                let Some((expected_sent_at, probe)) = pending_probes.remove(&test_id) else {
                                    tracing::warn!(license_id = %license.id, %test_id, "PFRP unsolicited probe ACK rejected");
                                    break;
                                };
                                if server_sent_at != expected_sent_at {
                                    tracing::warn!(license_id = %license.id, %test_id, "PFRP probe ACK timestamp mismatch");
                                    break;
                                }
                                let latency_ms = probe
                                    .requested_at
                                    .elapsed()
                                    .as_millis()
                                    .min(u64::MAX as u128) as u64;
                                let _ = probe.response.send(crate::core::state::RemoteProbeResult {
                                    latency_ms,
                                    extension_version: extension_version.clone(),
                                });
                                continue;
                            }
                            command => command,
                        };
                        let result = handle_client_message(&state, &service, license.id, &decoded.payload.client_install_id, command).await;
                        let response = match result {
                            Ok(message) => message,
                            Err(error) => {
                                tracing::warn!(license_id = %license.id, %error, "remote publish command failed");
                                ServerMessage::Error {
                                    code: "REMOTE_COMMAND_FAILED".to_string(),
                                    message: "远程任务命令执行失败".to_string(),
                                }
                            }
                        };
                        if send_pfrp(&mut socket, &response, &decoded.keys.server_to_client, &mut send_sequence).await.is_err() { break; }
                    }
                    Message::Ping(payload) => { if socket.send(Message::Pong(payload)).await.is_err() { break; } }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        }
    }
    let _ = service
        .release_unmaterialized_claims(license.id, &decoded.payload.client_install_id)
        .await;
    let mut connections = state.remote_connections.lock().await;
    if connections
        .get(&license.id)
        .is_some_and(|connection| connection.connection_id == connection_id)
    {
        connections.remove(&license.id);
    }
    drop(connections);
    state.notify_remote_job(license.id).await;
}

async fn handle_client_message(
    state: &AppState,
    service: &RemotePublishService,
    license_id: Uuid,
    install_id: &str,
    message: ClientMessage,
) -> Result<ServerMessage, AppError> {
    match message {
        ClientMessage::Ping { timestamp } => Ok(ServerMessage::Pong {
            timestamp: timestamp.unwrap_or_else(|| chrono::Utc::now().timestamp_millis()),
        }),
        ClientMessage::ClaimJob { job_id } => {
            let id = Uuid::parse_str(&job_id).map_err(|_| ValidationError::custom("jobId 无效"))?;
            Ok(ServerMessage::JobDetail(
                service.claim_job(license_id, install_id, id).await?,
            ))
        }
        ClientMessage::JobStatus(status) => {
            let terminal = matches!(status.status.as_str(), "completed" | "failed" | "cancelled");
            let view = service
                .update_job_status(license_id, install_id, status)
                .await?;
            if terminal {
                state.notify_remote_job(license_id).await;
            }
            Ok(ServerMessage::Ack {
                job_id: view.job_id,
                status: view.status,
                status_sequence: view.status_sequence,
            })
        }
        ClientMessage::ProjectMaterialized {
            job_id,
            status_sequence,
        } => {
            let id = Uuid::parse_str(&job_id).map_err(|_| ValidationError::custom("jobId 无效"))?;
            let view = service
                .project_materialized(license_id, install_id, id, status_sequence)
                .await?;
            Ok(ServerMessage::Ack {
                job_id: view.job_id,
                status: view.status,
                status_sequence: view.status_sequence,
            })
        }
        ClientMessage::ChannelProbeAck { .. } => {
            Err(ValidationError::custom("通道探测响应位置无效").into())
        }
    }
}

async fn send_next_available(
    service: &RemotePublishService,
    socket: &mut WebSocket,
    license_id: Uuid,
    key: &[u8; 32],
    sequence: &mut u64,
) -> Result<(), ()> {
    if let Ok(Some(job)) = service.next_queued(license_id).await {
        send_pfrp(
            socket,
            &ServerMessage::JobAvailable {
                job_id: job.job_id,
                title: job.title,
                content_type: job.content_type,
            },
            key,
            sequence,
        )
        .await?;
    }
    Ok(())
}

async fn send_pfrp<T: Serialize>(
    socket: &mut WebSocket,
    message: &T,
    key: &[u8; 32],
    sequence: &mut u64,
) -> Result<(), ()> {
    let frame = encode_message(message, key, *sequence).map_err(|_| ())?;
    socket
        .send(Message::Binary(frame.into()))
        .await
        .map_err(|_| ())?;
    *sequence += 1;
    Ok(())
}

async fn authenticate(
    service: &RemotePublishService,
    headers: &HeaderMap,
) -> Result<(entity::remote_web_session::Model, entity::license::Model), AppError> {
    let access = cookie(headers, ACCESS_COOKIE).ok_or(crate::AuthError::InvalidToken)?;
    service.authenticate_access(access).await
}

fn session_response(service: &RemotePublishService, issued: IssuedSession) -> Response {
    let mut headers = HeaderMap::new();
    let now = chrono::Utc::now();
    let access_age = (issued.view.access_expires_at - now).num_seconds().max(0);
    let refresh_age = (issued.view.refresh_expires_at - now).num_seconds().max(0);
    append_cookie(
        &mut headers,
        session_cookie(
            ACCESS_COOKIE,
            &issued.access_token,
            access_age,
            service.secure_cookies(),
        ),
    )
    .expect("valid access cookie");
    append_cookie(
        &mut headers,
        session_cookie(
            REFRESH_COOKIE,
            &issued.refresh_token,
            refresh_age,
            service.secure_cookies(),
        ),
    )
    .expect("valid refresh cookie");
    (headers, ApiResponse::success(issued.view)).into_response()
}

fn session_cookie(name: &str, value: &str, max_age: i64, secure: bool) -> String {
    format!(
        "{name}={value}; Path=/v1/remote; Max-Age={max_age}; HttpOnly; SameSite=Strict{}",
        if secure { "; Secure" } else { "" }
    )
}

fn expired_cookie(name: &str, secure: bool) -> String {
    session_cookie(name, "", 0, secure)
}

fn append_cookie(headers: &mut HeaderMap, value: String) -> Result<(), AppError> {
    headers.append(
        header::SET_COOKIE,
        HeaderValue::from_str(&value)
            .map_err(|_| PubFlowError::Internal("生成会话 Cookie 失败".to_string()))?,
    );
    Ok(())
}

fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| {
            let (key, value) = part.trim().split_once('=')?;
            (key == name && !value.is_empty()).then_some(value)
        })
}

#[cfg(test)]
mod tests {
    use super::{ClientMessage, ServerMessage};
    use serde_json::json;

    #[test]
    fn pfrp_messages_use_camel_case_payload_fields() {
        let message = ServerMessage::JobAvailable {
            job_id: "job-1".to_string(),
            title: "title".to_string(),
            content_type: "video".to_string(),
        };
        assert_eq!(
            serde_json::to_value(message).unwrap(),
            json!({
                "type": "JOB_AVAILABLE",
                "payload": {
                    "jobId": "job-1",
                    "title": "title",
                    "contentType": "video"
                }
            })
        );

        let command: ClientMessage = serde_json::from_value(json!({
            "type": "PROJECT_MATERIALIZED",
            "payload": { "jobId": "job-1", "statusSequence": 2 }
        }))
        .unwrap();
        assert!(matches!(
            command,
            ClientMessage::ProjectMaterialized {
                job_id,
                status_sequence: 2
            } if job_id == "job-1"
        ));

        let probe = ServerMessage::ChannelProbe {
            test_id: "e3e610d0-5c45-4d1d-90c4-40e9fc60b9aa".to_string(),
            server_sent_at: 1_785_000_000_000,
        };
        assert_eq!(
            serde_json::to_value(probe).unwrap(),
            json!({
                "type": "CHANNEL_PROBE",
                "payload": {
                    "testId": "e3e610d0-5c45-4d1d-90c4-40e9fc60b9aa",
                    "serverSentAt": 1_785_000_000_000_i64
                }
            })
        );

        let ack: ClientMessage = serde_json::from_value(json!({
            "type": "CHANNEL_PROBE_ACK",
            "payload": {
                "testId": "e3e610d0-5c45-4d1d-90c4-40e9fc60b9aa",
                "serverSentAt": 1_785_000_000_000_i64
            }
        }))
        .unwrap();
        assert!(matches!(
            ack,
            ClientMessage::ChannelProbeAck {
                test_id,
                server_sent_at: 1_785_000_000_000
            } if test_id == "e3e610d0-5c45-4d1d-90c4-40e9fc60b9aa"
        ));
    }
}
