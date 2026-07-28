use std::{
    collections::{BTreeMap, HashSet},
    fs,
    net::{IpAddr, SocketAddr},
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use axum::{
    Json,
    body::Body,
    extract::{ConnectInfo, Path as AxumPath, State},
    http::{HeaderMap, HeaderValue, Request, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, SecondsFormat, Utc};
use futures_util::StreamExt;
use hkdf::Hkdf;
use p256::{
    PublicKey, SecretKey,
    ecdh::diffie_hellman,
    elliptic_curve::{rand_core::OsRng, sec1::ToEncodedPoint},
};
use rand::{Rng, distributions::Alphanumeric};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::{
    error::AppError,
    models::{
        AssetInput, ContentType, FillOptions, JobCreate, JobView, PlatformId, PublishMode,
        Visibility,
    },
    project::build_project,
    routes::job_summary,
    state::{AppState, ExtensionGrant, LocalChallenge, LocalSession},
};

const CHALLENGE_TTL_MS: i64 = 60_000;
const SESSION_TTL_MS: i64 = 15 * 60 * 1000;
const LOGIN_FAILURE_WINDOW_MS: i64 = 5 * 60 * 1000;
const LOGIN_LOCK_MS: i64 = 10 * 60 * 1000;
const MAX_LOGIN_FAILURES: usize = 5;
const SESSION_COOKIE: &str = "pubflow_native_session";
const HKDF_INFO: &[u8] = b"pubflow-native-local-session-v1";
const MAX_VIDEO_BYTES: u64 = 20 * 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_MUSIC_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeView {
    challenge_id: String,
    server_public_key: String,
    expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoginRequest {
    challenge_id: String,
    client_public_key: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LoginPlaintext {
    password: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    tier: String,
    features: Vec<String>,
    license_expires_at: Option<String>,
    access_expires_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalQuotaView {
    date: String,
    unlimited: bool,
    job_limit: i64,
    jobs_used: i64,
    jobs_remaining: i64,
    byte_limit: i64,
    bytes_used: i64,
    bytes_remaining: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum LocalAssetRole {
    Video,
    Cover,
    Music,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAssetDescriptor {
    role: LocalAssetRole,
    file_name: String,
    content_type: Option<String>,
    size: u64,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateLocalJob {
    request_id: String,
    content_type: ContentType,
    title: String,
    #[serde(default)]
    description: String,
    article_content: Option<String>,
    #[serde(default)]
    topics: Vec<String>,
    #[serde(default)]
    campaign_ids: Vec<String>,
    platforms: Vec<PlatformId>,
    scheduled_at: Option<i64>,
    #[serde(default)]
    visibility: Visibility,
    #[serde(default)]
    original_declare: bool,
    #[serde(default)]
    platform_settings: BTreeMap<String, Value>,
    fill_options: Option<FillOptions>,
    #[serde(default)]
    publish_mode: PublishMode,
    #[serde(default)]
    assets: Vec<LocalAssetDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StagedAsset {
    asset_id: String,
    descriptor: LocalAssetDescriptor,
    uploaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StagedJob {
    job_id: String,
    project_id: String,
    created_at: i64,
    request: CreateLocalJob,
    assets: Vec<StagedAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAssetView {
    asset_id: String,
    role: LocalAssetRole,
    file_name: String,
    content_type: Option<String>,
    size: u64,
    sha256: String,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalJobView {
    job_id: String,
    project_id: String,
    request_id: String,
    content_type: ContentType,
    title: String,
    platforms: Vec<PlatformId>,
    publish_mode: PublishMode,
    status: String,
    status_sequence: i64,
    declared_bytes: u64,
    assets: Vec<LocalAssetView>,
    error: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct LocalJobList {
    items: Vec<LocalJobView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSelectionView {
    selected: bool,
    directory_name: Option<String>,
    restart_required: bool,
}

pub async fn lan_only(
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    request: Request<Body>,
    next: Next,
) -> Response {
    if is_local_network(address.ip()) && !is_cross_site_request(&request) {
        next.run(request).await
    } else {
        AppError::Forbidden("只允许从本机或局域网访问 PubFlow Native".to_owned()).into_response()
    }
}

pub async fn challenge(State(state): State<Arc<AppState>>) -> Json<ChallengeView> {
    let now = Utc::now().timestamp_millis();
    let challenge_id = Uuid::new_v4().to_string();
    let secret_key = SecretKey::random(&mut OsRng);
    let public_key = secret_key.public_key().to_encoded_point(false);
    let expires_at_ms = now + CHALLENGE_TTL_MS;
    let mut challenges = state.local_challenges.lock().await;
    challenges.retain(|_, challenge| challenge.expires_at_ms > now);
    challenges.insert(
        challenge_id.clone(),
        LocalChallenge {
            secret_key,
            expires_at_ms,
        },
    );
    Json(ChallengeView {
        challenge_id,
        server_public_key: URL_SAFE_NO_PAD.encode(public_key.as_bytes()),
        expires_at: iso_from_ms(expires_at_ms),
    })
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    Json(request): Json<LoginRequest>,
) -> Result<Response, AppError> {
    let now = Utc::now().timestamp_millis();
    check_login_allowed(&state, address.ip(), now).await?;
    let plaintext = match decrypt_login(&state, request).await {
        Ok(plaintext) => plaintext,
        Err(error) => {
            record_login_failure(&state, address.ip(), now).await;
            return Err(error);
        }
    };
    if !constant_time_eq(&plaintext.password, &state.settings.local_password) {
        record_login_failure(&state, address.ip(), now).await;
        return Err(AppError::Unauthorized);
    }
    clear_login_failures(&state, address.ip()).await;
    let grant = require_native_license_capability(&state).await?;
    let expires_at_ms = (now + SESSION_TTL_MS).min(grant.valid_until * 1000);
    let session_id = random_secret(64);
    let session = LocalSession {
        tier: grant.tier,
        features: grant.features,
        license_expires_at: Some(iso_from_ms(grant.valid_until * 1000)),
        access_expires_at: iso_from_ms(expires_at_ms),
        expires_at_ms,
    };
    let view = session_view(&session);
    let mut sessions = state.local_sessions.lock().await;
    sessions.retain(|_, session| session.expires_at_ms > now);
    sessions.insert(session_id.clone(), session);
    let max_age = ((expires_at_ms - now) / 1000).max(1);
    let cookie = format!(
        "{SESSION_COOKIE}={session_id}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}"
    );
    let mut response = Json(view).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).map_err(|_| AppError::Unauthorized)?,
    );
    Ok(response)
}

pub async fn session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<SessionView>, AppError> {
    let session = require_session(&state, &headers).await?;
    Ok(Json(session_view(&session)))
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if let Some(session_id) = cookie_value(&headers, SESSION_COOKIE) {
        state.local_sessions.lock().await.remove(session_id);
    }
    let mut response = Json(json!({ "loggedOut": true })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static(
            "pubflow_native_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        ),
    );
    Ok(response)
}

pub async fn select_workspace(
    State(state): State<Arc<AppState>>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<WorkspaceSelectionView>, AppError> {
    require_session(&state, &headers).await?;
    if !address.ip().is_loopback() {
        return Err(AppError::Forbidden(
            "只能在运行 Native 的电脑上重新选择工作区".to_owned(),
        ));
    }
    if state.database.has_active_jobs().await? || has_staged_jobs(&state)? {
        return Err(AppError::Conflict(
            "WORKSPACE_BUSY：请等待上传和发布任务结束后再切换工作区".to_owned(),
        ));
    }
    let selected = tokio::task::spawn_blocking(crate::config::pick_workspace_directory)
        .await
        .map_err(|error| AppError::Internal(error.into()))?;
    let Some(selected) = selected else {
        return Ok(Json(WorkspaceSelectionView {
            selected: false,
            directory_name: None,
            restart_required: false,
        }));
    };
    let saved = state
        .settings
        .save_workspace_selection(&selected)
        .map_err(AppError::Internal)?;
    let restart_required = saved != state.settings.workspace_root;
    Ok(Json(WorkspaceSelectionView {
        selected: true,
        directory_name: saved
            .file_name()
            .map(|value| value.to_string_lossy().into_owned()),
        restart_required,
    }))
}

pub async fn quota(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<LocalQuotaView>, AppError> {
    require_session(&state, &headers).await?;
    Ok(Json(LocalQuotaView {
        date: Utc::now().date_naive().to_string(),
        unlimited: true,
        job_limit: 0,
        jobs_used: 0,
        jobs_remaining: 0,
        byte_limit: 0,
        bytes_used: 0,
        bytes_remaining: 0,
    }))
}

pub async fn channel_test(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    require_session(&state, &headers).await?;
    require_native_capability(&state).await?;
    let extension_version = state.extension_version.read().await.clone();
    Ok(Json(json!({
        "connected": true,
        "latencyMs": 0,
        "testedAt": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        "extensionVersion": extension_version,
    })))
}

pub async fn list_jobs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<LocalJobList>, AppError> {
    require_session(&state, &headers).await?;
    let details = state.database.list_details(20).await?;
    let items = details
        .into_iter()
        .map(|(view, request)| local_view_from_database(view, request))
        .collect();
    Ok(Json(LocalJobList { items }))
}

pub async fn create_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut request): Json<CreateLocalJob>,
) -> Result<(StatusCode, Json<LocalJobView>), AppError> {
    require_session(&state, &headers).await?;
    require_native_capability(&state).await?;
    validate_local_request(&mut request)?;
    let _guard = state.create_lock.lock().await;
    if let Some(existing) = state
        .database
        .find_by_request_id(&request.request_id)
        .await?
        && let Some((view, stored)) = state.database.detail(&existing.job_id).await?
    {
        return Ok((StatusCode::OK, Json(local_view_from_database(view, stored))));
    }
    let staged = StagedJob {
        job_id: Uuid::new_v4().to_string(),
        project_id: Uuid::new_v4().to_string(),
        created_at: Utc::now().timestamp_millis(),
        assets: request
            .assets
            .iter()
            .cloned()
            .map(|descriptor| StagedAsset {
                asset_id: Uuid::new_v4().to_string(),
                descriptor,
                uploaded: false,
            })
            .collect(),
        request,
    };
    let directory = staging_job_dir(&state, &staged.job_id);
    fs::create_dir_all(directory.join("assets"))?;
    write_staged_job(&state, &staged)?;
    Ok((StatusCode::CREATED, Json(local_view_from_staged(&staged))))
}

pub async fn upload_asset(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath((job_id, asset_id)): AxumPath<(String, String)>,
    body: Body,
) -> Result<StatusCode, AppError> {
    require_session(&state, &headers).await?;
    require_native_capability(&state).await?;
    let _guard = state.create_lock.lock().await;
    let mut staged = read_staged_job(&state, &job_id)?;
    let asset = staged
        .assets
        .iter_mut()
        .find(|asset| asset.asset_id == asset_id)
        .ok_or_else(|| AppError::NotFound(format!("素材 {asset_id} 不存在")))?;
    let final_path = staged_asset_path(&state, &job_id, asset);
    if let Some(parent) = final_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let temporary = final_path.with_extension(format!("upload-{}", Uuid::new_v4()));
    let result = stream_asset(body, &temporary, &asset.descriptor).await;
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error);
    }
    tokio::fs::rename(&temporary, &final_path).await?;
    asset.uploaded = true;
    write_staged_job(&state, &staged)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn complete_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(job_id): AxumPath<String>,
) -> Result<Json<LocalJobView>, AppError> {
    require_session(&state, &headers).await?;
    require_native_capability(&state).await?;
    let _guard = state.create_lock.lock().await;
    let staged = read_staged_job(&state, &job_id)?;
    if staged.assets.iter().any(|asset| !asset.uploaded) {
        return Err(AppError::Conflict("仍有素材尚未上传完成".to_owned()));
    }
    let request = materialize_request(&state, &staged)?;
    let workspace = state.settings.workspace_root.clone();
    let project_id = staged.project_id.clone();
    let request_for_build = request.clone();
    let built = tokio::task::spawn_blocking(move || {
        build_project(&workspace, &project_id, &request_for_build)
    })
    .await
    .map_err(|error| AppError::Internal(error.into()))?
    .map_err(AppError::Internal)?;
    let project_path = built.project_path.to_string_lossy().into_owned();
    let inserted = state
        .database
        .insert(&staged.job_id, &built.project_id, &project_path, &request)
        .await;
    let job = match inserted {
        Ok(job) => job,
        Err(error) => {
            let _ = fs::remove_dir_all(&built.project_path);
            return Err(error);
        }
    };
    let _ = fs::remove_dir_all(staging_job_dir(&state, &staged.job_id));
    let _ = state.events.send(json!({
        "type": "JOB_AVAILABLE",
        "payload": job_summary(&job)
    }));
    Ok(Json(local_view_from_database(job, request)))
}

async fn decrypt_login(
    state: &Arc<AppState>,
    request: LoginRequest,
) -> Result<LoginPlaintext, AppError> {
    let challenge = state
        .local_challenges
        .lock()
        .await
        .remove(request.challenge_id.trim())
        .ok_or(AppError::Unauthorized)?;
    if challenge.expires_at_ms <= Utc::now().timestamp_millis() {
        return Err(AppError::Unauthorized);
    }
    let client_public_bytes = decode_base64(&request.client_public_key)?;
    let client_public =
        PublicKey::from_sec1_bytes(&client_public_bytes).map_err(|_| AppError::Unauthorized)?;
    let shared = diffie_hellman(
        challenge.secret_key.to_nonzero_scalar(),
        client_public.as_affine(),
    );
    let hkdf = Hkdf::<Sha256>::new(
        Some(request.challenge_id.as_bytes()),
        shared.raw_secret_bytes().as_slice(),
    );
    let mut key = [0_u8; 32];
    hkdf.expand(HKDF_INFO, &mut key)
        .map_err(|_| AppError::Unauthorized)?;
    let nonce = decode_base64(&request.nonce)?;
    if nonce.len() != 12 {
        return Err(AppError::Unauthorized);
    }
    let ciphertext = decode_base64(&request.ciphertext)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| AppError::Unauthorized)?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| AppError::Unauthorized)?;
    serde_json::from_slice(&plaintext).map_err(|_| AppError::Unauthorized)
}

async fn require_session(
    state: &Arc<AppState>,
    headers: &HeaderMap,
) -> Result<LocalSession, AppError> {
    let session_id = cookie_value(headers, SESSION_COOKIE).ok_or(AppError::Unauthorized)?;
    let now = Utc::now().timestamp_millis();
    let mut sessions = state.local_sessions.lock().await;
    sessions.retain(|_, session| session.expires_at_ms > now);
    sessions
        .get(session_id)
        .cloned()
        .ok_or(AppError::Unauthorized)
}

pub(crate) async fn require_native_capability(
    state: &Arc<AppState>,
) -> Result<ExtensionGrant, AppError> {
    let grant = require_native_license_capability(state).await?;
    if *state.extension_workspace_match.read().await != Some(true) {
        return Err(AppError::ServiceUnavailable(
            "插件选择的工作区与 Native 不一致".to_owned(),
        ));
    }
    Ok(grant)
}

async fn require_native_license_capability(
    state: &Arc<AppState>,
) -> Result<ExtensionGrant, AppError> {
    if state.events.receiver_count() == 0 {
        return Err(AppError::ServiceUnavailable(
            "Chrome 插件尚未连接".to_owned(),
        ));
    }
    let grant =
        state.extension_grant.read().await.clone().ok_or_else(|| {
            AppError::Forbidden("当前插件授权不包含 Native 本地发布能力".to_owned())
        })?;
    if grant.valid_until <= Utc::now().timestamp() {
        return Err(AppError::Forbidden("当前插件授权已过期".to_owned()));
    }
    Ok(grant)
}

async fn check_login_allowed(state: &Arc<AppState>, ip: IpAddr, now: i64) -> Result<(), AppError> {
    let mut attempts = state.local_login_attempts.lock().await;
    attempts.retain(|_, value| {
        value.locked_until_ms > now
            || value
                .failed_at_ms
                .back()
                .is_some_and(|failed| *failed + LOGIN_FAILURE_WINDOW_MS > now)
    });
    if attempts
        .get(&ip)
        .is_some_and(|attempt| attempt.locked_until_ms > now)
    {
        return Err(AppError::TooManyRequests(
            "本地访问密码错误次数过多，请稍后再试".to_owned(),
        ));
    }
    Ok(())
}

async fn record_login_failure(state: &Arc<AppState>, ip: IpAddr, now: i64) {
    let mut attempts = state.local_login_attempts.lock().await;
    let attempt = attempts.entry(ip).or_default();
    while attempt
        .failed_at_ms
        .front()
        .is_some_and(|failed| *failed + LOGIN_FAILURE_WINDOW_MS <= now)
    {
        attempt.failed_at_ms.pop_front();
    }
    attempt.failed_at_ms.push_back(now);
    if attempt.failed_at_ms.len() >= MAX_LOGIN_FAILURES {
        attempt.locked_until_ms = now + LOGIN_LOCK_MS;
        attempt.failed_at_ms.clear();
    }
}

async fn clear_login_failures(state: &Arc<AppState>, ip: IpAddr) {
    state.local_login_attempts.lock().await.remove(&ip);
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    left.as_bytes().ct_eq(right.as_bytes()).into()
}

fn has_staged_jobs(state: &Arc<AppState>) -> Result<bool, AppError> {
    let staging = state.settings.data_dir.join("staging");
    if !staging.is_dir() {
        return Ok(false);
    }
    Ok(fs::read_dir(staging)?.next().transpose()?.is_some())
}

fn is_cross_site_request(request: &Request<Body>) -> bool {
    if request
        .headers()
        .get("sec-fetch-site")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("cross-site"))
    {
        return true;
    }
    if !request.uri().path().starts_with("/v1/local/") {
        return false;
    }
    let Some(origin) = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let Some(host) = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    else {
        return true;
    };
    origin
        .parse::<axum::http::Uri>()
        .ok()
        .and_then(|uri| uri.authority().map(|value| value.as_str().to_owned()))
        .is_none_or(|authority| !authority.eq_ignore_ascii_case(host))
}

fn session_view(session: &LocalSession) -> SessionView {
    SessionView {
        tier: session.tier.clone(),
        features: session.features.clone(),
        license_expires_at: session.license_expires_at.clone(),
        access_expires_at: session.access_expires_at.clone(),
    }
}

fn validate_local_request(request: &mut CreateLocalJob) -> Result<(), AppError> {
    request.request_id = request.request_id.trim().to_owned();
    if request.request_id.is_empty() || request.request_id.len() > 128 {
        return Err(AppError::BadRequest(
            "requestId 必须为 1-128 个字符".to_owned(),
        ));
    }
    let mut roles = HashSet::new();
    for asset in &mut request.assets {
        asset.file_name = asset.file_name.trim().to_owned();
        asset.sha256 = asset.sha256.trim().to_ascii_lowercase();
        validate_file_name(&asset.file_name)?;
        if asset.size == 0 || asset.size > asset_size_limit(asset.role) {
            return Err(AppError::BadRequest(format!(
                "素材 {} 的大小无效",
                asset.file_name
            )));
        }
        if asset.sha256.len() != 64 || !asset.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(AppError::BadRequest(format!(
                "素材 {} 的 SHA-256 无效",
                asset.file_name
            )));
        }
        if asset.role != LocalAssetRole::Image && !roles.insert(asset.role) {
            return Err(AppError::BadRequest(format!(
                "素材角色 {:?} 只能出现一次",
                asset.role
            )));
        }
    }
    let mut normalized = local_to_job_create(request, |_| "pending.asset".to_owned());
    normalized
        .validate_and_normalize()
        .map_err(AppError::BadRequest)?;
    request.title = normalized.title;
    request.topics = normalized.topics;
    request.campaign_ids = normalized.campaign_ids;
    request.platforms = normalized.platforms;
    Ok(())
}

fn materialize_request(state: &Arc<AppState>, staged: &StagedJob) -> Result<JobCreate, AppError> {
    let mut request = local_to_job_create(&staged.request, |role| {
        staged
            .assets
            .iter()
            .find(|asset| asset.descriptor.role == role)
            .map(|asset| {
                staged_asset_path(state, &staged.job_id, asset)
                    .to_string_lossy()
                    .into_owned()
            })
            .unwrap_or_default()
    });
    request.assets.image_paths = staged
        .assets
        .iter()
        .filter(|asset| asset.descriptor.role == LocalAssetRole::Image)
        .map(|asset| {
            staged_asset_path(state, &staged.job_id, asset)
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    request
        .validate_and_normalize()
        .map_err(AppError::BadRequest)?;
    Ok(request)
}

fn local_to_job_create(
    request: &CreateLocalJob,
    asset_path: impl Fn(LocalAssetRole) -> String,
) -> JobCreate {
    let has = |role| request.assets.iter().any(|asset| asset.role == role);
    JobCreate {
        request_id: Some(request.request_id.clone()),
        content_type: request.content_type,
        title: request.title.clone(),
        description: request.description.clone(),
        article_content: request.article_content.clone(),
        topics: request.topics.clone(),
        campaign_ids: request.campaign_ids.clone(),
        platforms: request.platforms.clone(),
        scheduled_at: request.scheduled_at,
        visibility: request.visibility,
        original_declare: request.original_declare,
        platform_settings: request.platform_settings.clone(),
        fill_options: request.fill_options.clone(),
        publish_mode: request.publish_mode,
        assets: AssetInput {
            video_path: has(LocalAssetRole::Video).then(|| asset_path(LocalAssetRole::Video)),
            cover_path: has(LocalAssetRole::Cover).then(|| asset_path(LocalAssetRole::Cover)),
            image_paths: request
                .assets
                .iter()
                .filter(|asset| asset.role == LocalAssetRole::Image)
                .map(|_| asset_path(LocalAssetRole::Image))
                .collect(),
            music_path: has(LocalAssetRole::Music).then(|| asset_path(LocalAssetRole::Music)),
        },
    }
}

async fn stream_asset(
    body: Body,
    destination: &Path,
    descriptor: &LocalAssetDescriptor,
) -> Result<(), AppError> {
    let mut file = tokio::fs::File::create(destination).await?;
    let mut stream = body.into_data_stream();
    let mut digest = Sha256::new();
    let mut written = 0_u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| AppError::BadRequest(error.to_string()))?;
        written = written.saturating_add(chunk.len() as u64);
        if written > descriptor.size || written > asset_size_limit(descriptor.role) {
            return Err(AppError::BadRequest(format!(
                "素材 {} 超过声明大小",
                descriptor.file_name
            )));
        }
        digest.update(&chunk);
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    if written != descriptor.size {
        return Err(AppError::BadRequest(format!(
            "素材 {} 实际大小与声明不一致",
            descriptor.file_name
        )));
    }
    let actual = hex::encode(digest.finalize());
    if actual != descriptor.sha256 {
        return Err(AppError::BadRequest(format!(
            "素材 {} 的 SHA-256 校验失败",
            descriptor.file_name
        )));
    }
    Ok(())
}

fn local_view_from_staged(staged: &StagedJob) -> LocalJobView {
    LocalJobView {
        job_id: staged.job_id.clone(),
        project_id: staged.project_id.clone(),
        request_id: staged.request.request_id.clone(),
        content_type: staged.request.content_type,
        title: staged.request.title.clone(),
        platforms: staged.request.platforms.clone(),
        publish_mode: staged.request.publish_mode,
        status: "uploading".to_owned(),
        status_sequence: 0,
        declared_bytes: staged
            .assets
            .iter()
            .map(|asset| asset.descriptor.size)
            .sum(),
        assets: staged.assets.iter().map(local_asset_view).collect(),
        error: None,
        created_at: iso_from_ms(staged.created_at),
        updated_at: iso_from_ms(staged.created_at),
    }
}

fn local_view_from_database(view: JobView, request: JobCreate) -> LocalJobView {
    let declared_bytes = request
        .assets
        .video_path
        .iter()
        .chain(request.assets.cover_path.iter())
        .chain(request.assets.music_path.iter())
        .chain(request.assets.image_paths.iter())
        .filter_map(|path| fs::metadata(path).ok().map(|metadata| metadata.len()))
        .sum();
    LocalJobView {
        job_id: view.job_id,
        project_id: view.project_id,
        request_id: request.request_id.unwrap_or_default(),
        content_type: request.content_type,
        title: request.title,
        platforms: view.platforms,
        publish_mode: request.publish_mode,
        status: view.status,
        status_sequence: view.status_sequence,
        declared_bytes,
        assets: Vec::new(),
        error: view.error,
        created_at: iso_from_ms(view.created_at),
        updated_at: iso_from_ms(view.updated_at),
    }
}

fn local_asset_view(asset: &StagedAsset) -> LocalAssetView {
    LocalAssetView {
        asset_id: asset.asset_id.clone(),
        role: asset.descriptor.role,
        file_name: asset.descriptor.file_name.clone(),
        content_type: asset.descriptor.content_type.clone(),
        size: asset.descriptor.size,
        sha256: asset.descriptor.sha256.clone(),
        status: if asset.uploaded {
            "uploaded"
        } else {
            "pending"
        }
        .to_owned(),
    }
}

fn staging_job_dir(state: &Arc<AppState>, job_id: &str) -> PathBuf {
    state.settings.data_dir.join("staging").join(job_id)
}

fn staged_job_path(state: &Arc<AppState>, job_id: &str) -> PathBuf {
    staging_job_dir(state, job_id).join("request.json")
}

fn staged_asset_path(state: &Arc<AppState>, job_id: &str, asset: &StagedAsset) -> PathBuf {
    staging_job_dir(state, job_id)
        .join("assets")
        .join(&asset.asset_id)
        .join(&asset.descriptor.file_name)
}

fn write_staged_job(state: &Arc<AppState>, staged: &StagedJob) -> Result<(), AppError> {
    let path = staged_job_path(state, &staged.job_id);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::BadRequest("暂存路径无效".to_owned()))?;
    fs::create_dir_all(parent)?;
    let temporary = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    fs::write(&temporary, serde_json::to_vec_pretty(staged)?)?;
    fs::rename(temporary, path)?;
    Ok(())
}

fn read_staged_job(state: &Arc<AppState>, job_id: &str) -> Result<StagedJob, AppError> {
    if Uuid::parse_str(job_id).is_err() {
        return Err(AppError::NotFound(format!("任务 {job_id} 不存在")));
    }
    let path = staged_job_path(state, job_id);
    if !path.is_file() {
        return Err(AppError::NotFound(format!("任务 {job_id} 不存在")));
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn validate_file_name(file_name: &str) -> Result<(), AppError> {
    let path = Path::new(file_name);
    if file_name.is_empty()
        || file_name.len() > 255
        || path.components().count() != 1
        || !matches!(path.components().next(), Some(Component::Normal(_)))
        || file_name.contains(['/', '\\'])
    {
        return Err(AppError::BadRequest("素材文件名无效".to_owned()));
    }
    Ok(())
}

fn asset_size_limit(role: LocalAssetRole) -> u64 {
    match role {
        LocalAssetRole::Video => MAX_VIDEO_BYTES,
        LocalAssetRole::Cover | LocalAssetRole::Image => MAX_IMAGE_BYTES,
        LocalAssetRole::Music => MAX_MUSIC_BYTES,
    }
}

fn decode_base64(value: &str) -> Result<Vec<u8>, AppError> {
    URL_SAFE_NO_PAD
        .decode(value.trim())
        .map_err(|_| AppError::Unauthorized)
}

fn cookie_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find_map(|(key, value)| (key == name).then_some(value))
}

fn random_secret(length: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

fn iso_from_ms(timestamp: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(timestamp)
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn is_local_network(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unicast_link_local()
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|ip| ip.is_loopback() || ip.is_private() || ip.is_link_local())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_network_filter_accepts_only_loopback_private_and_link_local() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.2",
            "169.254.1.1",
            "::1",
            "fe80::1",
            "fd00::1",
        ] {
            assert!(is_local_network(address.parse().unwrap()), "{address}");
        }
        for address in ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"] {
            assert!(!is_local_network(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn rejects_path_traversal_file_names() {
        assert!(validate_file_name("video.mp4").is_ok());
        assert!(validate_file_name("../video.mp4").is_err());
        assert!(validate_file_name("folder/video.mp4").is_err());
    }

    #[test]
    fn compares_local_password_without_normalizing_it() {
        assert!(constant_time_eq("123456", "123456"));
        assert!(!constant_time_eq("123456", "1234567"));
        assert!(!constant_time_eq("123456", "123 456"));
    }

    #[test]
    fn rejects_cross_site_local_api_requests() {
        let cross_site = Request::builder()
            .uri("/v1/local/session/login")
            .header("host", "192.168.1.20:5190")
            .header("origin", "https://attacker.example")
            .body(Body::empty())
            .unwrap();
        assert!(is_cross_site_request(&cross_site));

        let same_origin = Request::builder()
            .uri("/v1/local/session/login")
            .header("host", "192.168.1.20:5190")
            .header("origin", "http://192.168.1.20:5190")
            .body(Body::empty())
            .unwrap();
        assert!(!is_cross_site_request(&same_origin));
    }
}
