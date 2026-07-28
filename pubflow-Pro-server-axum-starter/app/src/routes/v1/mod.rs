//! V1 版本 API 路由
//!
//! 包含 V1 版本所有的 API 端点。

use crate::{
    AppState, admin, download, lease, license_center, product, purchase, remote_publish, selector,
    user,
};
use aide::axum::ApiRouter;
use std::sync::Arc;

/// 构建 V1 版本的 API 路由
///
/// 聚合所有 V1 版本的业务模块路由。目前包括：
/// - /user - 用户管理相关的端点
/// - /lease - Lease 授权相关的端点
///
/// # 参数
/// * `state` - 应用状态，包含数据库连接等资源
///
/// # 返回
/// 返回配置好的 V1 API 路由器
pub fn routes(state: Arc<AppState>) -> ApiRouter {
    ApiRouter::new()
        .nest_api_service("/user", user::routes(state.clone()))
        .nest_api_service("/lease", lease::routes(state.clone()))
        .nest_api_service("/license", license_center::routes(state.clone()))
        .nest_api_service("/product", product::routes(state.clone()))
        .nest_api_service("/selector", selector::routes(state.clone()))
        .nest_api_service("/purchase", purchase::routes(state.clone()))
        .nest_api_service("/remote", remote_publish::routes(state.clone()))
        .api_route(
            "/downloads/{filename}",
            aide::axum::routing::get_with(
                download::handler::download_file,
                download::handler::download_file_docs,
            ),
        )
        .nest_api_service(
            "/admin",
            admin::public_routes(state.clone()).merge(
                admin::routes(state.clone())
                    .merge(selector::admin_routes(state.clone()))
                    .merge(purchase::admin_routes(state.clone()))
                    .merge(lease::admin_routes(state.clone()))
                    .merge(remote_publish::admin_routes(state.clone()))
                    .route_layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        crate::core::middleware::auth::require_admin,
                    )),
            ),
        )
        .with_state(state)
}
