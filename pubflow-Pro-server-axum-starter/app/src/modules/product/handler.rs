use aide::transform::TransformOperation;
use axum::extract::{Query, State};
use std::sync::Arc;

use crate::{ApiResponse, AppError, AppState, shared::FromState};

use super::dto::{
    ProductCatalogResponse, ProductVersionListQuery, ProductVersionListResponse,
    ProductVersionQuery, ProductVersionResponse,
};
use super::service::ProductService;

pub async fn catalog(
    State(state): State<Arc<AppState>>,
) -> Result<ApiResponse<ProductCatalogResponse>, AppError> {
    let service = ProductService::from_state(&state);
    Ok(ApiResponse::success(service.catalog().await?))
}

pub fn catalog_docs(op: TransformOperation) -> TransformOperation {
    op.description("获取前台产品套餐和下载配置")
        .tag("PubFlow Product")
        .response::<200, ApiResponse<ProductCatalogResponse>>()
}

pub async fn latest_version(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ProductVersionQuery>,
) -> Result<ApiResponse<ProductVersionResponse>, AppError> {
    let service = ProductService::from_state(&state);
    Ok(ApiResponse::success(
        service.latest_version(query.platform).await?,
    ))
}

pub fn latest_version_docs(op: TransformOperation) -> TransformOperation {
    op.description("获取指定平台最新插件版本")
        .tag("PubFlow Product")
        .response::<200, ApiResponse<ProductVersionResponse>>()
}

pub async fn recent_versions(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ProductVersionListQuery>,
) -> Result<ApiResponse<ProductVersionListResponse>, AppError> {
    let service = ProductService::from_state(&state);
    Ok(ApiResponse::success(
        service.recent_versions(query.platform, query.limit).await?,
    ))
}

pub fn recent_versions_docs(op: TransformOperation) -> TransformOperation {
    op.description("获取指定平台最近版本更新日志")
        .tag("PubFlow Product")
        .response::<200, ApiResponse<ProductVersionListResponse>>()
}
