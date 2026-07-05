use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;

use super::section::ConfigSection;

/// 敏感信息配置
///
/// 包含应用的敏感信息，如密钥和令牌，应妥善保管。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SecretsConfig {
    /// JWT 签名密钥（必需，至少 32 字符）
    pub jwt_secret: String,

    /// 当前 JWT 签名密钥版本，新签发 token 会写入 header.kid 和业务 claims。
    pub jwt_key_version: i32,

    /// 旧 JWT 签名密钥，格式：`version:secret,version:secret`，用于 grace period 内验旧 token。
    pub jwt_previous_secrets: String,

    /// Redis 连接 URL（可选）
    pub redis_url: Option<String>,

    /// Selector AES 派生主密钥
    pub selector_secret: String,

    /// Selector 二进制协议服务端私钥（32 字节 hex）
    pub selector_protocol_private_key: String,

    /// Selector/PFAP/PFSP 协议公钥版本号
    pub selector_protocol_key_version: i32,

    /// Selector 协议元数据签名私钥（P-256 scalar，32 字节 hex）
    pub selector_protocol_signing_private_key: String,

    /// Selector 协议请求时间窗口（秒）
    pub selector_replay_window_seconds: i64,

    /// Selector 协议 nonce 去重 TTL（秒）
    pub selector_nonce_ttl_seconds: u64,

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

impl Default for SecretsConfig {
    fn default() -> Self {
        Self {
            jwt_secret: String::new(),
            jwt_key_version: 1,
            jwt_previous_secrets: String::new(),
            redis_url: None,
            selector_secret: String::new(),
            selector_protocol_private_key: String::new(),
            selector_protocol_key_version: 1,
            selector_protocol_signing_private_key: String::new(),
            selector_replay_window_seconds: 120,
            selector_nonce_ttl_seconds: 600,
            machine_salt: String::new(),
            admin_token: String::new(),
            admin_username: String::new(),
            admin_password: String::new(),
            admin_password_hash: String::new(),
        }
    }
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
            if let Some(version) = obj.get("jwt_key_version").and_then(|v| v.as_i64()) {
                self.jwt_key_version = version as i32;
            }
            if let Some(secrets) = obj.get("jwt_previous_secrets").and_then(|v| v.as_str()) {
                self.jwt_previous_secrets = secrets.to_string();
            }
            if let Some(redis) = obj.get("redis_url").and_then(|v| v.as_str()) {
                self.redis_url = Some(redis.to_string());
            }
            if let Some(secret) = obj.get("selector_secret").and_then(|v| v.as_str()) {
                self.selector_secret = secret.to_string();
            }
            if let Some(secret) = obj
                .get("selector_protocol_private_key")
                .and_then(|v| v.as_str())
            {
                self.selector_protocol_private_key = secret.to_string();
            }
            if let Some(version) = obj
                .get("selector_protocol_key_version")
                .and_then(|v| v.as_i64())
            {
                self.selector_protocol_key_version = version as i32;
            }
            if let Some(secret) = obj
                .get("selector_protocol_signing_private_key")
                .and_then(|v| v.as_str())
            {
                self.selector_protocol_signing_private_key = secret.to_string();
            }
            if let Some(seconds) = obj
                .get("selector_replay_window_seconds")
                .and_then(|v| v.as_i64())
            {
                self.selector_replay_window_seconds = seconds;
            }
            if let Some(seconds) = obj
                .get("selector_nonce_ttl_seconds")
                .and_then(|v| v.as_u64())
            {
                self.selector_nonce_ttl_seconds = seconds;
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
        if self.jwt_key_version <= 0 {
            return Err("JWT 密钥版本必须大于 0".to_string());
        }
        for (version, secret) in parse_jwt_previous_secrets(&self.jwt_previous_secrets)? {
            if version == self.jwt_key_version {
                return Err("旧 JWT 密钥版本不能等于当前 JWT 密钥版本".to_string());
            }
            if secret.len() < 32 {
                return Err("旧 JWT 密钥长度必须至少 32 个字符".to_string());
            }
        }
        if self.selector_secret.len() < 32 {
            return Err("Selector 主密钥长度必须至少 32 个字符".to_string());
        }
        if !self.selector_protocol_private_key.is_empty()
            && (self.selector_protocol_private_key.len() != 64
                || hex::decode(&self.selector_protocol_private_key).is_err())
        {
            return Err("Selector 协议私钥必须是 32 字节 hex".to_string());
        }
        if self.selector_protocol_key_version <= 0 {
            return Err("Selector 协议密钥版本必须大于 0".to_string());
        }
        if !self.selector_protocol_signing_private_key.is_empty()
            && (self.selector_protocol_signing_private_key.len() != 64
                || hex::decode(&self.selector_protocol_signing_private_key).is_err())
        {
            return Err("Selector 协议元数据签名私钥必须是 32 字节 hex".to_string());
        }
        if self.selector_replay_window_seconds <= 0 {
            return Err("Selector 协议时间窗口必须大于 0".to_string());
        }
        if self.selector_nonce_ttl_seconds < 60 {
            return Err("Selector 协议 nonce TTL 必须至少 60 秒".to_string());
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
        if let Ok(version) = env::var("JWT_KEY_VERSION")
            && let Ok(parsed) = version.parse()
        {
            self.jwt_key_version = parsed;
        }
        if let Ok(secrets) = env::var("JWT_PREVIOUS_SECRETS") {
            self.jwt_previous_secrets = secrets;
        }
        if let Ok(redis) = env::var("REDIS_URL") {
            self.redis_url = Some(redis);
        }
        if let Ok(secret) = env::var("SELECTOR_SECRET") {
            self.selector_secret = secret;
        }
        if let Ok(secret) = env::var("SELECTOR_PROTOCOL_PRIVATE_KEY") {
            self.selector_protocol_private_key = secret;
        }
        if let Ok(version) = env::var("SELECTOR_PROTOCOL_KEY_VERSION")
            && let Ok(parsed) = version.parse()
        {
            self.selector_protocol_key_version = parsed;
        }
        if let Ok(secret) = env::var("SELECTOR_PROTOCOL_SIGNING_PRIVATE_KEY") {
            self.selector_protocol_signing_private_key = secret;
        }
        if let Ok(seconds) = env::var("SELECTOR_REPLAY_WINDOW_SECONDS")
            && let Ok(parsed) = seconds.parse()
        {
            self.selector_replay_window_seconds = parsed;
        }
        if let Ok(seconds) = env::var("SELECTOR_NONCE_TTL_SECONDS")
            && let Ok(parsed) = seconds.parse()
        {
            self.selector_nonce_ttl_seconds = parsed;
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

pub fn parse_jwt_previous_secrets(value: &str) -> Result<Vec<(i32, String)>, String> {
    let mut result = Vec::new();
    for entry in value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        let (version, secret) = entry
            .split_once(':')
            .ok_or_else(|| "JWT_PREVIOUS_SECRETS 格式必须是 version:secret".to_string())?;
        let version = version
            .parse::<i32>()
            .map_err(|_| "JWT_PREVIOUS_SECRETS version 必须是整数".to_string())?;
        if version <= 0 {
            return Err("JWT_PREVIOUS_SECRETS version 必须大于 0".to_string());
        }
        result.push((version, secret.to_string()));
    }
    Ok(result)
}
