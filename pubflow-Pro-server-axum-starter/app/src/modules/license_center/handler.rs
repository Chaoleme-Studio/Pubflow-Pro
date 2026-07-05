use aide::transform::TransformOperation;
use axum::Json;
use axum::extract::State;
use std::sync::Arc;

use crate::{ApiResponse, AppError, AppState, shared::FromState};

use super::dto::{
    LicenseLookupRequest, LicenseLookupResponse, SelfReplaceLicenseRequest,
    SelfReplaceLicenseResponse, SelfResetDevicesRequest, SelfResetDevicesResponse,
    SelfRevokeLicenseRequest, SelfRevokeLicenseResponse,
};
use super::service::LicenseCenterService;

pub async fn lookup(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LicenseLookupRequest>,
) -> Result<ApiResponse<LicenseLookupResponse>, AppError> {
    let service = LicenseCenterService::from_state(&state);
    Ok(ApiResponse::success(service.lookup(req).await?))
}

pub fn lookup_docs(op: TransformOperation) -> TransformOperation {
    op.description("用户自助查询激活码状态")
        .tag("PubFlow License Center")
        .response::<200, ApiResponse<LicenseLookupResponse>>()
}

pub async fn self_replace(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SelfReplaceLicenseRequest>,
) -> Result<ApiResponse<SelfReplaceLicenseResponse>, AppError> {
    let service = LicenseCenterService::from_state(&state);
    Ok(ApiResponse::success(service.self_replace(req).await?))
}

pub fn self_replace_docs(op: TransformOperation) -> TransformOperation {
    op.description("用户自助补发新激活码并注销旧码")
        .tag("PubFlow License Center")
        .response::<200, ApiResponse<SelfReplaceLicenseResponse>>()
}

pub async fn self_revoke(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SelfRevokeLicenseRequest>,
) -> Result<ApiResponse<SelfRevokeLicenseResponse>, AppError> {
    let service = LicenseCenterService::from_state(&state);
    Ok(ApiResponse::success(service.self_revoke(req).await?))
}

pub fn self_revoke_docs(op: TransformOperation) -> TransformOperation {
    op.description("用户自助注销激活码")
        .tag("PubFlow License Center")
        .response::<200, ApiResponse<SelfRevokeLicenseResponse>>()
}

pub async fn self_reset_devices(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SelfResetDevicesRequest>,
) -> Result<ApiResponse<SelfResetDevicesResponse>, AppError> {
    let service = LicenseCenterService::from_state(&state);
    Ok(ApiResponse::success(service.self_reset_devices(req).await?))
}

pub fn self_reset_devices_docs(op: TransformOperation) -> TransformOperation {
    op.description("用户自助解除旧设备占用")
        .tag("PubFlow License Center")
        .response::<200, ApiResponse<SelfResetDevicesResponse>>()
}
