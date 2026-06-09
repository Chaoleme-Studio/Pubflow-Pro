use axum::{extract::Request, middleware::Next, response::Response};
use tracing::warn;

use crate::{AppState, error::AppError};
use std::sync::Arc;

/// 当前登录用户标识
#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub user_id: i32,
}

/// 认证中间件 - 验证 JWT token
pub async fn require_auth(
    state: axum::extract::State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    // 从 Authorization header 中提取 token
    let auth_header = request
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok());

    let token = match auth_header {
        Some(header) if header.starts_with("Bearer ") => &header[7..],
        _ => {
            warn!("Missing or invalid Authorization header");
            return Err(AppError::Auth(crate::error::AuthError::InvalidToken));
        }
    };

    // 验证 token
    let user_id = state.jwt_service.extract_user_id(token).map_err(|_| {
        warn!("Invalid or expired token");
        AppError::Auth(crate::error::AuthError::InvalidToken)
    })?;

    // 将当前用户注入到请求扩展中
    request.extensions_mut().insert(CurrentUser { user_id });

    Ok(next.run(request).await)
}

/// 管理端认证中间件 - 验证 Admin Bearer token
///
/// Admin token 使用 JWT 格式，包含过期时间验证
pub async fn require_admin(
    state: axum::extract::State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let auth_header = request
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok());

    let token = match auth_header {
        Some(header) if header.starts_with("Bearer ") => &header[7..],
        _ => {
            warn!("Missing admin Authorization header");
            return Err(AppError::Auth(crate::error::AuthError::InvalidToken));
        }
    };

    // 验证 Admin token（使用 JWT 验证，包含过期时间检查）
    let claims = state.jwt_service.verify_token(token).map_err(|e| {
        warn!("Invalid or expired admin token: {}", e);
        AppError::Auth(crate::error::AuthError::InvalidToken)
    })?;

    // 检查 token 是否是 admin token（通过 claims 中的特定标识）
    // admin token 的 sub 字段固定为 -1
    if claims.claims.sub != -1 {
        warn!("Token is not an admin token");
        return Err(AppError::Auth(crate::error::AuthError::InvalidToken));
    }

    Ok(next.run(request).await)
}
