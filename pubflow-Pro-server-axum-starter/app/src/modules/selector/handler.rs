use aide::transform::TransformOperation;
use axum::Json;
use axum::extract::State;
use std::sync::Arc;

use crate::{ApiResponse, AppError, AppState, shared::FromState};

use super::dto::{
    FetchSelectorRequest, SelectorResponse, SelectorVersionResponse, UploadSelectorRequest,
    UploadSelectorResponse,
};
use super::service::SelectorService;

pub async fn fetch(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FetchSelectorRequest>,
) -> Result<ApiResponse<SelectorResponse>, AppError> {
    let service = SelectorService::from_state(&state);
    Ok(ApiResponse::success(service.fetch(req).await?))
}

pub fn fetch_docs(op: TransformOperation) -> TransformOperation {
    op.description("获取当前加密 Selector")
        .tag("PubFlow Selector")
        .response::<200, ApiResponse<SelectorResponse>>()
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
    Json(req): Json<UploadSelectorRequest>,
) -> Result<ApiResponse<UploadSelectorResponse>, AppError> {
    let service = SelectorService::from_state(&state);
    Ok(ApiResponse::success(service.upload(req).await?))
}

pub fn upload_docs(op: TransformOperation) -> TransformOperation {
    op.description("上传新的 Selector 版本")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<UploadSelectorResponse>>()
}
