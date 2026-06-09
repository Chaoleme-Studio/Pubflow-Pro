use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;

use super::section::ConfigSection;

/// 敏感信息配置
///
/// 包含应用的敏感信息，如密钥和令牌，应妥善保管。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
#[derive(Default)]
pub struct SecretsConfig {
    /// JWT 签名密钥（必需，至少 32 字符）
    pub jwt_secret: String,

    /// Redis 连接 URL（可选）
    pub redis_url: Option<String>,

    /// Selector AES 派生主密钥
    pub selector_secret: String,

    /// 机器码哈希盐
    pub machine_salt: String,

    /// 管理端 Bearer Token
    pub admin_token: String,

    /// 管理端登录账号
    pub admin_username: String,

    /// 管理端登录密码（明文，仅用于首次启动时生成哈希）
    pub admin_password: String,

    /// 管理端登录密码哈希（Argon2 格式，优先使用）
    pub admin_password_hash: String,
}

impl ConfigSection for SecretsConfig {
    fn section_name(&self) -> &str {
        "secrets"
    }

    fn load_from_value(&mut self, value: &Value) -> Result<(), String> {
        if let Some(obj) = value.as_object() {
            if let Some(secret) = obj.get("jwt_secret").and_then(|v| v.as_str()) {
                self.jwt_secret = secret.to_string();
            }
            if let Some(redis) = obj.get("redis_url").and_then(|v| v.as_str()) {
                self.redis_url = Some(redis.to_string());
            }
            if let Some(secret) = obj.get("selector_secret").and_then(|v| v.as_str()) {
                self.selector_secret = secret.to_string();
            }
            if let Some(salt) = obj.get("machine_salt").and_then(|v| v.as_str()) {
                self.machine_salt = salt.to_string();
            }
            if let Some(token) = obj.get("admin_token").and_then(|v| v.as_str()) {
                self.admin_token = token.to_string();
            }
            if let Some(username) = obj.get("admin_username").and_then(|v| v.as_str()) {
                self.admin_username = username.to_string();
            }
            if let Some(password) = obj.get("admin_password").and_then(|v| v.as_str()) {
                self.admin_password = password.to_string();
            }
            if let Some(hash) = obj.get("admin_password_hash").and_then(|v| v.as_str()) {
                self.admin_password_hash = hash.to_string();
            }
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), String> {
        if self.jwt_secret.is_empty() {
            return Err("JWT 密钥是必需的，但未提供".to_string());
        }
        if self.jwt_secret.len() < 32 {
            return Err("JWT 密钥长度必须至少 32 个字符".to_string());
        }
        if self.selector_secret.len() < 32 {
            return Err("Selector 主密钥长度必须至少 32 个字符".to_string());
        }
        if self.machine_salt.len() < 16 {
            return Err("机器码盐长度必须至少 16 个字符".to_string());
        }
        if self.admin_token.len() < 32 {
            return Err("Admin Token 长度必须至少 32 个字符".to_string());
        }
        if self.admin_username.trim().is_empty() {
            return Err("Admin 用户名是必需的，但未提供".to_string());
        }
        if self.admin_password.len() < 8 {
            return Err("Admin 密码长度必须至少 8 个字符".to_string());
        }
        Ok(())
    }

    fn required_env_vars(&self) -> Vec<&str> {
        vec![
            "JWT_SECRET",
            "SELECTOR_SECRET",
            "MACHINE_SALT",
            "ADMIN_TOKEN",
            "ADMIN_USERNAME",
            "ADMIN_PASSWORD",
        ]
    }

    fn apply_env_overrides(&mut self) -> Result<(), String> {
        if let Ok(secret) = env::var("JWT_SECRET") {
            self.jwt_secret = secret;
        }
        if let Ok(redis) = env::var("REDIS_URL") {
            self.redis_url = Some(redis);
        }
        if let Ok(secret) = env::var("SELECTOR_SECRET") {
            self.selector_secret = secret;
        }
        if let Ok(salt) = env::var("MACHINE_SALT") {
            self.machine_salt = salt;
        }
        if let Ok(token) = env::var("ADMIN_TOKEN") {
            self.admin_token = token;
        }
        if let Ok(username) = env::var("ADMIN_USERNAME") {
            self.admin_username = username;
        }
        if let Ok(password) = env::var("ADMIN_PASSWORD") {
            self.admin_password = password;
        }
        if let Ok(hash) = env::var("ADMIN_PASSWORD_HASH") {
            self.admin_password_hash = hash;
        }
        Ok(())
    }
}
