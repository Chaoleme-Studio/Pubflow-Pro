use crate::AppState;
use aide::axum::ApiRouter;
use aide::axum::routing::{get_with, post_with};
use std::sync::Arc;
use tower_governor::{GovernorLayer, governor::GovernorConfigBuilder};

mod alipay;
pub mod dto;
mod handler;
pub mod service;

pub fn routes(state: Arc<AppState>) -> ApiRouter {
    let create_order_limiter = GovernorConfigBuilder::default()
        .per_second(3)
        .burst_size(6)
        .use_headers()
        .finish()
        .unwrap();

    ApiRouter::new()
        .api_route(
            "/orders",
            post_with(handler::create_order, handler::create_order_docs)
                .layer(GovernorLayer::new(create_order_limiter)),
        )
        .api_route(
            "/orders/{order_no}",
            get_with(handler::status, handler::status_docs),
        )
        .api_route(
            "/notify/wechat",
            post_with(handler::wechat_notify, handler::wechat_notify_docs),
        )
        .api_route(
            "/notify/alipay",
            post_with(handler::alipay_notify, handler::alipay_notify_docs),
        )
        .with_state(state)
}

pub fn admin_routes(state: Arc<AppState>) -> ApiRouter {
    ApiRouter::new()
        .api_route(
            "/payment/confirm",
            post_with(handler::confirm_paid, handler::confirm_paid_docs),
        )
        .with_state(state)
}
