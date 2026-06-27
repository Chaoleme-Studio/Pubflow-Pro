//! 业务功能模块
//!
//! 包含应用的各项业务功能实现，如用户管理等。

/// PubFlow 后台管理模块
pub mod admin;
/// API 文档路由
mod docs;
/// PubFlow Lease 授权模块
pub mod lease;
/// PubFlow 前台激活码自助服务模块
pub mod license_center;
/// 404 处理
mod not_found;
/// PubFlow 前台产品配置模块
pub mod product;
/// PubFlow 购买订单模块
pub mod purchase;
/// PubFlow Selector 模块
pub mod selector;
/// 用户管理模块（注册、登录、获取用户信息）
pub mod user;

pub use docs::*;
pub use not_found::*;
