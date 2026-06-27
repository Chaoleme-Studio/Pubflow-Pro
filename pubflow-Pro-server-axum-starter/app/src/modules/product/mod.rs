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
        .api_route(
            "/version",
            get_with(handler::latest_version, handler::latest_version_docs),
        )
        .api_route(
            "/versions",
            get_with(handler::recent_versions, handler::recent_versions_docs),
        )
        .with_state(state)
}
