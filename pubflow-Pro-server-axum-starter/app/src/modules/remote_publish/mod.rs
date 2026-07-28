use crate::{
    AppState,
    shared::{TrustedProxyIpKeyExtractor, requests_per_second_period},
};
use aide::axum::ApiRouter;
use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post, put},
};
use std::sync::Arc;
use tower_governor::{GovernorLayer, governor::GovernorConfigBuilder};

pub mod dto;
mod handler;
pub mod service;

pub fn routes(state: Arc<AppState>) -> ApiRouter {
    let login_limiter = GovernorConfigBuilder::default()
        .key_extractor(TrustedProxyIpKeyExtractor)
        .period(requests_per_second_period(1))
        .burst_size(5)
        .use_headers()
        .finish()
        .unwrap();
    let channel_test_limiter = GovernorConfigBuilder::default()
        .key_extractor(TrustedProxyIpKeyExtractor)
        .period(requests_per_second_period(1))
        .burst_size(3)
        .use_headers()
        .finish()
        .unwrap();
    ApiRouter::new()
        .route(
            "/session/login",
            post(handler::login).layer(GovernorLayer::new(login_limiter)),
        )
        .route("/session/refresh", post(handler::refresh))
        .route("/session/logout", post(handler::logout))
        .route("/session", get(handler::session))
        .route("/jobs", post(handler::create_job).get(handler::list_jobs))
        .route("/jobs/{job_id}", get(handler::get_job))
        .route(
            "/jobs/{job_id}/assets/{asset_id}",
            put(handler::upload_asset).layer(DefaultBodyLimit::disable()),
        )
        .route("/jobs/{job_id}/complete", post(handler::complete_job))
        .route("/quota", get(handler::quota))
        .route(
            "/channel/test",
            post(handler::test_channel).layer(GovernorLayer::new(channel_test_limiter)),
        )
        .route("/extension/ws", get(handler::extension_ws))
        .route("/assets/{asset_id}", get(handler::download_asset))
        .with_state(state)
}

pub fn admin_routes(state: Arc<AppState>) -> ApiRouter {
    ApiRouter::new()
        .route(
            "/remote/licenses/{license_id}/quota",
            put(handler::admin_set_quota),
        )
        .with_state(state)
}
