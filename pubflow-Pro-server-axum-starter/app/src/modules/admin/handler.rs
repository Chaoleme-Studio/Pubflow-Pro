use aide::transform::TransformOperation;
use axum::Json;
use axum::extract::{Query, State};
use std::sync::Arc;

use crate::{ApiResponse, AppError, AppState, shared::FromState};

use super::dto::{
    AdminLoginRequest, AdminLoginResponse, GenerateLicenseRequest, GenerateLicenseResponse,
    LicenseListResponse, ListLicenseQuery, ListOrderQuery, ListUserQuery, OrderOperationItem,
    RevokeLicenseRequest, RevokeLicenseResponse, UserOperationItem,
};
use super::service::AdminService;

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AdminLoginRequest>,
) -> Result<ApiResponse<AdminLoginResponse>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(service.login(req)?))
}

pub fn login_docs(op: TransformOperation) -> TransformOperation {
    op.description("管理后台登录")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<AdminLoginResponse>>()
}

pub async fn generate_licenses(
    State(state): State<Arc<AppState>>,
    Json(req): Json<GenerateLicenseRequest>,
) -> Result<ApiResponse<GenerateLicenseResponse>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(service.generate_licenses(req).await?))
}

pub fn generate_licenses_docs(op: TransformOperation) -> TransformOperation {
    op.description("批量生成 License 激活码")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<GenerateLicenseResponse>>()
}

pub async fn revoke_license(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RevokeLicenseRequest>,
) -> Result<ApiResponse<RevokeLicenseResponse>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(service.revoke_license(req).await?))
}

pub fn revoke_license_docs(op: TransformOperation) -> TransformOperation {
    op.description("吊销 License")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<RevokeLicenseResponse>>()
}

pub async fn list_licenses(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListLicenseQuery>,
) -> Result<ApiResponse<LicenseListResponse>, AppError> {
    let service = AdminService::from_state(&state);
    let (items, total, page, page_size, summary) = service.list_licenses(query).await?;
    Ok(ApiResponse::success(LicenseListResponse {
        items,
        summary,
        total: total as i64,
        page: page as i64,
        page_size: page_size as i64,
    }))
}

pub fn list_licenses_docs(op: TransformOperation) -> TransformOperation {
    op.description("查询 License 列表")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<LicenseListResponse>>()
}

pub async fn list_users(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListUserQuery>,
) -> Result<ApiResponse<UserOperationItem>, AppError> {
    let service = AdminService::from_state(&state);
    let (items, total, page, page_size) = service.list_users(query).await?;
    Ok(ApiResponse::list(
        items,
        total as i64,
        page as i64,
        page_size as i64,
    ))
}

pub fn list_users_docs(op: TransformOperation) -> TransformOperation {
    op.description("查询用户运营列表")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<UserOperationItem>>()
}

pub async fn list_orders(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListOrderQuery>,
) -> Result<ApiResponse<OrderOperationItem>, AppError> {
    let service = AdminService::from_state(&state);
    let (items, total, page, page_size) = service.list_orders(query).await?;
    Ok(ApiResponse::list(
        items,
        total as i64,
        page as i64,
        page_size as i64,
    ))
}

pub fn list_orders_docs(op: TransformOperation) -> TransformOperation {
    op.description("查询订单运营列表")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<OrderOperationItem>>()
}
