use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// 用户注册请求
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RegisterRequest {
    /// 用户名（3-20字符）
    pub username: String,

    /// 邮箱地址
    pub email: String,

    /// 密码（8字符以上）
    pub password: String,

    /// 确认密码
    pub password_confirm: String,
}

/// 用户注册响应
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RegisterResponse {
    /// 用户ID
    pub id: i32,

    /// 用户名
    pub username: String,

    /// 邮箱
    pub email: String,
}

/// 用户登录请求
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LoginRequest {
    /// 用户名或邮箱
    pub username_or_email: String,

    /// 密码
    pub password: String,
}

/// 用户登录响应
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LoginResponse {
    /// 用户ID
    pub id: i32,

    /// 用户名
    pub username: String,

    /// 邮箱
    pub email: String,

    /// JWT Token
    pub token: String,

    /// Token 过期时间（秒）
    pub expires_in: i64,
}
