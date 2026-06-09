use crate::AppState;
use aide::axum::ApiRouter;
use aide::axum::routing::get_with;
use std::sync::Arc;

pub mod dto;
mod handler;
pub mod service;

pub fn routes(state: Arc<AppState>) -> ApiRouter {
    ApiRouter::new()
        .api_route(
            "/catalog",
            get_with(handler::catalog, handler::catalog_docs),
        )
        .with_state(state)
}
