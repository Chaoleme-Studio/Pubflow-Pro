use crate::AppState;
use aide::axum::ApiRouter;
use aide::axum::routing::{get_with, post_with};
use std::sync::Arc;
use tower_governor::{GovernorLayer, governor::GovernorConfigBuilder};

pub mod dto;
mod handler;
pub mod service;

pub fn public_routes(state: Arc<AppState>) -> ApiRouter {
    let admin_login_limiter = GovernorConfigBuilder::default()
        .per_second(1)
        .burst_size(5)
        .use_headers()
        .finish()
        .unwrap();

    ApiRouter::new()
        .api_route(
            "/login",
            post_with(handler::login, handler::login_docs)
                .layer(GovernorLayer::new(admin_login_limiter)),
        )
        .with_state(state)
}

pub fn routes(state: Arc<AppState>) -> ApiRouter {
    ApiRouter::new()
        .api_route(
            "/licenses/generate",
            post_with(handler::generate_licenses, handler::generate_licenses_docs),
        )
        .api_route(
            "/licenses/revoke",
            post_with(handler::revoke_license, handler::revoke_license_docs),
        )
        .api_route(
            "/licenses/replace",
            post_with(handler::replace_license, handler::replace_license_docs),
        )
        .api_route(
            "/licenses/limits",
            post_with(
                handler::update_license_limits,
                handler::update_license_limits_docs,
            ),
        )
        .api_route(
            "/licenses",
            get_with(handler::list_licenses, handler::list_licenses_docs),
        )
        .api_route(
            "/product/catalog",
            get_with(
                handler::product_catalog_config,
                handler::product_catalog_config_docs,
            )
            .post_with(
                handler::save_product_catalog_config,
                handler::save_product_catalog_config_docs,
            ),
        )
        .api_route(
            "/versions",
            get_with(handler::list_app_versions, handler::list_app_versions_docs).post_with(
                handler::create_app_version,
                handler::create_app_version_docs,
            ),
        )
        .api_route(
            "/versions/{id}",
            get_with(handler::get_app_version, handler::get_app_version_docs)
                .put_with(
                    handler::update_app_version,
                    handler::update_app_version_docs,
                )
                .delete_with(
                    handler::delete_app_version,
                    handler::delete_app_version_docs,
                ),
        )
        .api_route(
            "/users",
            get_with(handler::list_users, handler::list_users_docs),
        )
        .api_route(
            "/orders",
            get_with(handler::list_orders, handler::list_orders_docs),
        )
        .with_state(state)
}
