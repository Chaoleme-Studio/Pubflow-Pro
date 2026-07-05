use crate::AppState;
use aide::axum::ApiRouter;
use aide::axum::routing::{get_with, post_with};
use std::sync::Arc;
use tower_governor::{GovernorLayer, governor::GovernorConfigBuilder};

pub mod dto;
mod handler;
pub mod service;

pub fn routes(state: Arc<AppState>) -> ApiRouter {
    // 激活限流器（严格）
    let activate_limiter = GovernorConfigBuilder::default()
        .per_second(10)
        .burst_size(10)
        .use_headers()
        .finish()
        .unwrap();
    let activate_protocol_limiter = GovernorConfigBuilder::default()
        .per_second(10)
        .burst_size(10)
        .use_headers()
        .finish()
        .unwrap();

    // 验证限流器（宽松）
    let verify_limiter = GovernorConfigBuilder::default()
        .per_second(10)
        .burst_size(20)
        .use_headers()
        .finish()
        .unwrap();
    let challenge_limiter = GovernorConfigBuilder::default()
        .per_second(10)
        .burst_size(20)
        .use_headers()
        .finish()
        .unwrap();
    let permit_limiter = GovernorConfigBuilder::default()
        .per_second(10)
        .burst_size(10)
        .use_headers()
        .finish()
        .unwrap();

    // 续租限流器
    let renew_limiter = GovernorConfigBuilder::default()
        .per_second(10)
        .burst_size(10)
        .use_headers()
        .finish()
        .unwrap();

    // 解绑限流器
    let deactivate_limiter = GovernorConfigBuilder::default()
        .per_second(10)
        .burst_size(10)
        .use_headers()
        .finish()
        .unwrap();

    ApiRouter::new()
        .api_route(
            "/activate",
            post_with(handler::activate, handler::activate_docs)
                .layer(GovernorLayer::new(activate_limiter)),
        )
        .api_route(
            "/activate-protocol",
            post_with(handler::activate_protocol, handler::activate_protocol_docs)
                .layer(GovernorLayer::new(activate_protocol_limiter)),
        )
        .api_route(
            "/challenge",
            post_with(handler::challenge, handler::challenge_docs)
                .layer(GovernorLayer::new(challenge_limiter)),
        )
        .api_route(
            "/permit",
            post_with(handler::permit, handler::permit_docs)
                .layer(GovernorLayer::new(permit_limiter)),
        )
        .api_route(
            "/verify",
            post_with(handler::verify, handler::verify_docs)
                .layer(GovernorLayer::new(verify_limiter)),
        )
        .api_route(
            "/renew",
            post_with(handler::renew, handler::renew_docs).layer(GovernorLayer::new(renew_limiter)),
        )
        .api_route(
            "/deactivate",
            post_with(handler::deactivate, handler::deactivate_docs)
                .layer(GovernorLayer::new(deactivate_limiter)),
        )
        .with_state(state)
}

pub fn admin_routes(state: Arc<AppState>) -> ApiRouter {
    ApiRouter::new()
        .api_route(
            "/leases",
            get_with(handler::admin_list, handler::admin_list_docs),
        )
        .api_route(
            "/leases/dau",
            get_with(handler::admin_dau, handler::admin_dau_docs),
        )
        .with_state(state)
}
