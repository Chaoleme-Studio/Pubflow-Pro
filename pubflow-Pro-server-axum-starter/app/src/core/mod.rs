//! 应用核心功能模块
//!
//! 包含配置、日志、中间件、应用状态等核心功能。

pub mod config;
mod cors;
mod logging;
pub mod middleware;
pub mod response;
pub mod state;

/// 应用全局配置
pub use config::AppConfig;
/// CORS 跨域配置构建函数
pub use cors::build_cors_layer;
/// 旧日志文件清理函数
pub use logging::cleanup_old_logs;
/// 标准 API 响应格式
pub use response::{API_VERSION, ApiResponse, Domain, ErrorDetail};
/// 应用状态（包含数据库、Redis等）
pub use state::AppState;
