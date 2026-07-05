use crate::AppState;
use aide::axum::ApiRouter;
use aide::axum::routing::post_with;
use std::sync::Arc;
use tower_governor::{GovernorLayer, governor::GovernorConfigBuilder};

pub mod dto;
mod handler;
pub mod service;

pub fn routes(state: Arc<AppState>) -> ApiRouter {
    let limiter = GovernorConfigBuilder::default()
        .per_second(1)
        .burst_size(5)
        .use_headers()
        .finish()
        .unwrap();

    ApiRouter::new()
        .api_route("/lookup", post_with(handler::lookup, handler::lookup_docs))
        .api_route(
            "/replace",
            post_with(handler::self_replace, handler::self_replace_docs),
        )
        .api_route(
            "/revoke",
            post_with(handler::self_revoke, handler::self_revoke_docs),
        )
        .api_route(
            "/reset-devices",
            post_with(
                handler::self_reset_devices,
                handler::self_reset_devices_docs,
            ),
        )
        .layer(GovernorLayer::new(limiter))
        .with_state(state)
}
