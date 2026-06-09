use aide::transform::TransformOperation;
use axum::extract::State;
use std::sync::Arc;

use crate::{ApiResponse, AppError, AppState, shared::FromState};

use super::dto::ProductCatalogResponse;
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
