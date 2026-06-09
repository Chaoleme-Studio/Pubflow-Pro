use aide::transform::TransformOperation;
use axum::Json;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;

use crate::{ApiResponse, AppError, AppState, shared::FromState};

use super::dto::{
    ActivateLeaseRequest, ActivateLeaseResponse, DeactivateLeaseRequest, DeactivateLeaseResponse,
    RenewLeaseRequest, RenewLeaseResponse, VerifyLeaseRequest, VerifyLeaseResponse,
};
use super::service::LeaseService;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DateRangeParams {
    pub from: Option<String>,
    pub to: Option<String>,
}

/// 从请求头提取客户端 IP
fn extract_client_ip(headers: &HeaderMap) -> String {
    if let Some(forwarded) = headers.get("x-forwarded-for") {
        if let Ok(val) = forwarded.to_str() {
            if let Some(ip) = val.split(',').next() {
                let trimmed = ip.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }
    if let Some(real_ip) = headers.get("x-real-ip") {
        if let Ok(val) = real_ip.to_str() {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    "unknown".to_string()
}

/// 激活 lease
pub async fn activate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ActivateLeaseRequest>,
) -> Result<ApiResponse<ActivateLeaseResponse>, AppError> {
    let ip = extract_client_ip(&headers);
    let service = LeaseService::from_state(&state);
    Ok(ApiResponse::success(service.activate(req, &ip).await?))
}

pub fn activate_docs(op: TransformOperation) -> TransformOperation {
    op.description("激活订阅 lease，绑定设备")
        .tag("PubFlow Lease")
        .response::<200, ApiResponse<ActivateLeaseResponse>>()
}

/// 验证 lease
pub async fn verify(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VerifyLeaseRequest>,
) -> Result<ApiResponse<VerifyLeaseResponse>, AppError> {
    let service = LeaseService::from_state(&state);
    Ok(ApiResponse::success(service.verify(req).await?))
}

pub fn verify_docs(op: TransformOperation) -> TransformOperation {
    op.description("验证 lease 有效性，检查设备绑定和过期时间")
        .tag("PubFlow Lease")
        .response::<200, ApiResponse<VerifyLeaseResponse>>()
}

/// 续租 lease
pub async fn renew(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RenewLeaseRequest>,
) -> Result<ApiResponse<RenewLeaseResponse>, AppError> {
    let service = LeaseService::from_state(&state);
    Ok(ApiResponse::success(service.renew(req).await?))
}

pub fn renew_docs(op: TransformOperation) -> TransformOperation {
    op.description("续租 lease，延长有效期")
        .tag("PubFlow Lease")
        .response::<200, ApiResponse<RenewLeaseResponse>>()
}

/// 解绑设备
pub async fn deactivate(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DeactivateLeaseRequest>,
) -> Result<ApiResponse<DeactivateLeaseResponse>, AppError> {
    let service = LeaseService::from_state(&state);
    Ok(ApiResponse::success(service.deactivate(req).await?))
}

pub fn deactivate_docs(op: TransformOperation) -> TransformOperation {
    op.description("解绑设备，吊销关联的 lease")
        .tag("PubFlow Lease")
        .response::<200, ApiResponse<DeactivateLeaseResponse>>()
}

/// 管理员查询 lease 记录
pub async fn admin_list(
    State(state): State<Arc<AppState>>,
    Query(params): Query<DateRangeParams>,
) -> Result<ApiResponse<super::dto::AdminLeaseListResponse>, AppError> {
    let service = LeaseService::from_state(&state);
    let items = service.admin_list_leases(params.from, params.to).await?;
    Ok(ApiResponse::success(super::dto::AdminLeaseListResponse {
        items,
    }))
}

pub fn admin_list_docs(op: TransformOperation) -> TransformOperation {
    op.description("管理员查询 Lease 激活记录")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<super::dto::AdminLeaseListResponse>>()
}

/// 管理员查询 DAU 统计
pub async fn admin_dau(
    State(state): State<Arc<AppState>>,
    Query(params): Query<DateRangeParams>,
) -> Result<ApiResponse<super::dto::DauStatListResponse>, AppError> {
    let service = LeaseService::from_state(&state);
    let items = service.admin_dau_stats(params.from, params.to).await?;
    Ok(ApiResponse::success(super::dto::DauStatListResponse {
        items,
    }))
}

pub fn admin_dau_docs(op: TransformOperation) -> TransformOperation {
    op.description("管理员查询 DAU 统计")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<super::dto::DauStatListResponse>>()
}
