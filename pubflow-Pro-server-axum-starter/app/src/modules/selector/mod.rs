use crate::AppState;
use aide::axum::ApiRouter;
use aide::axum::routing::{get_with, post_with};
use std::sync::Arc;

pub mod dto;
mod handler;
pub mod service;

pub fn routes(state: Arc<AppState>) -> ApiRouter {
    ApiRouter::new()
        .api_route("/fetch", post_with(handler::fetch, handler::fetch_docs))
        .api_route(
            "/version",
            get_with(handler::version, handler::version_docs),
        )
        .with_state(state)
}

pub fn admin_routes(state: Arc<AppState>) -> ApiRouter {
    ApiRouter::new()
        .api_route(
            "/selector/upload",
            post_with(handler::upload, handler::upload_docs),
        )
        .with_state(state)
}
