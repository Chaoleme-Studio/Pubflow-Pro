use aide::transform::TransformOperation;
use axum::Json;
use axum::extract::{Path, Query, State};
use std::sync::Arc;
use uuid::Uuid;

use crate::{ApiResponse, AppError, AppState, shared::FromState};

use super::dto::{
    AdminAppVersionItem, AdminAppVersionListResponse, AdminAppVersionQuery, AdminLoginRequest,
    AdminLoginResponse, AdminProductCatalogConfig, CreateAppVersionRequest,
    DeleteAppVersionResponse, GenerateLicenseRequest, GenerateLicenseResponse, LicenseListResponse,
    ListLicenseQuery, ListOrderQuery, ListUserQuery, OrderOperationItem, ReplaceLicenseRequest,
    ReplaceLicenseResponse, RevokeLicenseRequest, RevokeLicenseResponse, UpdateAppVersionRequest,
    UpdateLicenseLimitsRequest, UpdateLicenseLimitsResponse, UserOperationItem,
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

pub async fn product_catalog_config(
    State(state): State<Arc<AppState>>,
) -> Result<ApiResponse<AdminProductCatalogConfig>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(
        service.product_catalog_config().await?,
    ))
}

pub fn product_catalog_config_docs(op: TransformOperation) -> TransformOperation {
    op.description("查询后台商品和下载配置")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<AdminProductCatalogConfig>>()
}

pub async fn save_product_catalog_config(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AdminProductCatalogConfig>,
) -> Result<ApiResponse<AdminProductCatalogConfig>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(
        service.save_product_catalog_config(req).await?,
    ))
}

pub fn save_product_catalog_config_docs(op: TransformOperation) -> TransformOperation {
    op.description("保存后台商品和下载配置")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<AdminProductCatalogConfig>>()
}

pub async fn list_app_versions(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AdminAppVersionQuery>,
) -> Result<ApiResponse<AdminAppVersionListResponse>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(
        service.list_app_versions(query).await?,
    ))
}

pub fn list_app_versions_docs(op: TransformOperation) -> TransformOperation {
    op.description("查询后台插件版本记录")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<AdminAppVersionListResponse>>()
}

pub async fn create_app_version(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateAppVersionRequest>,
) -> Result<ApiResponse<AdminAppVersionItem>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(service.create_app_version(req).await?))
}

pub fn create_app_version_docs(op: TransformOperation) -> TransformOperation {
    op.description("发布新的插件版本记录")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<AdminAppVersionItem>>()
}

pub async fn get_app_version(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<ApiResponse<AdminAppVersionItem>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(service.get_app_version(id).await?))
}

pub fn get_app_version_docs(op: TransformOperation) -> TransformOperation {
    op.description("查询单条插件版本记录")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<AdminAppVersionItem>>()
}

pub async fn update_app_version(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateAppVersionRequest>,
) -> Result<ApiResponse<AdminAppVersionItem>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(
        service.update_app_version(id, req).await?,
    ))
}

pub fn update_app_version_docs(op: TransformOperation) -> TransformOperation {
    op.description("更新插件版本记录")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<AdminAppVersionItem>>()
}

pub async fn delete_app_version(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<ApiResponse<DeleteAppVersionResponse>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(service.delete_app_version(id).await?))
}

pub fn delete_app_version_docs(op: TransformOperation) -> TransformOperation {
    op.description("删除插件版本记录")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<DeleteAppVersionResponse>>()
}

pub async fn replace_license(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ReplaceLicenseRequest>,
) -> Result<ApiResponse<ReplaceLicenseResponse>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(service.replace_license(req).await?))
}

pub fn replace_license_docs(op: TransformOperation) -> TransformOperation {
    op.description("补发 License 激活码")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<ReplaceLicenseResponse>>()
}

pub async fn update_license_limits(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateLicenseLimitsRequest>,
) -> Result<ApiResponse<UpdateLicenseLimitsResponse>, AppError> {
    let service = AdminService::from_state(&state);
    Ok(ApiResponse::success(
        service.update_license_limits(req).await?,
    ))
}

pub fn update_license_limits_docs(op: TransformOperation) -> TransformOperation {
    op.description("调整 License 设备限制")
        .tag("PubFlow Admin")
        .response::<200, ApiResponse<UpdateLicenseLimitsResponse>>()
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
