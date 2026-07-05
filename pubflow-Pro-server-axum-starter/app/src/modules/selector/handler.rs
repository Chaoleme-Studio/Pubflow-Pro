use aide::transform::TransformOperation;
use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

use crate::{ApiResponse, AppError, AppState, shared::FromState};

use super::dto::{SelectorVersionResponse, UploadSelectorRequest, UploadSelectorResponse};
use super::service::SelectorService;

pub async fn fetch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, AppError> {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !content_type.starts_with("application/octet-stream") {
        return Err(crate::error::PubFlowError::SelectorProtocol(
            "PFSP_UNSUPPORTED_MEDIA_TYPE".to_string(),
        )
        .into());
    }
    let service = SelectorService::from_state(&state);
    let bytes = service.fetch_protocol(&body).await?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/octet-stream")],
        bytes,
    )
        .into_response())
}

pub fn fetch_docs(op: TransformOperation) -> TransformOperation {
    op.description("使用 PFSP v1 二进制协议获取当前加密 Selector")
        .tag("PubFlow Selector")
}

pub async fn version(
    State(state): State<Arc<AppState>>,
) -> Result<ApiResponse<SelectorVersionResponse>, AppError> {
    let service = SelectorService::from_state(&state);
    Ok(ApiResponse::success(service.version().await?))
}

pub fn version_docs(op: TransformOperation) -> TransformOperation {
    op.description("获取 Selector 最新版本")
        .tag("PubFlow Selector")
        .response::<200, ApiResponse<SelectorVersionResponse>>()
}

pub async fn upload(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<UploadSelectorRequest>,
) -> Result<ApiResponse<UploadSelectorResponse>, AppError> {
    let service = SelectorService::from_state(&state);
    Ok(ApiResponse::success(
        service
            .upload(
                req,
                crate::admin::service::AdminAuditContext {
                    operator: state.config.admin_username.clone(),
                    source_ip: admin_source_ip(&headers),
                },
            )
            .await?,
    ))
}

pub fn upload_docs(op: TransformOperation) -> TransformOperation {
    op.description("上传新的 Selector 版本")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<UploadSelectorResponse>>()
}

fn admin_source_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or("admin")
        .to_string()
}
