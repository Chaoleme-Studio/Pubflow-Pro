use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;

use super::section::ConfigSection;

/// 数据库配置
///
/// 包含数据库连接信息和连接池配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DatabaseConfig {
    /// 数据库连接 URL（必需）
    pub url: String,
    /// 连接池最大连接数（默认：10）
    pub max_connections: u32,
    /// 连接池超时时间，单位秒（默认：30）
    pub pool_timeout: u64,
    /// 最小空闲连接数（默认：2）
    pub min_connections: u32,
    /// 连接空闲超时，单位秒（默认：300）
    pub idle_timeout: u64,
    /// 连接最大生命周期，单位秒（默认：1800）
    pub max_lifetime: u64,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: String::new(),
            max_connections: 10,
            pool_timeout: 30,
            min_connections: 2,
            idle_timeout: 300,
            max_lifetime: 1800,
        }
    }
}

impl ConfigSection for DatabaseConfig {
    fn section_name(&self) -> &str {
        "database"
    }

    fn load_from_value(&mut self, value: &Value) -> Result<(), String> {
        if let Some(obj) = value.as_object() {
            if let Some(url) = obj.get("url").and_then(|v| v.as_str()) {
                self.url = url.to_string();
            }
            if let Some(max_conn) = obj.get("max_connections").and_then(|v| v.as_u64()) {
                self.max_connections = max_conn as u32;
            }
            if let Some(timeout) = obj.get("pool_timeout").and_then(|v| v.as_u64()) {
                self.pool_timeout = timeout;
            }
            if let Some(min_conn) = obj.get("min_connections").and_then(|v| v.as_u64()) {
                self.min_connections = min_conn as u32;
            }
            if let Some(idle) = obj.get("idle_timeout").and_then(|v| v.as_u64()) {
                self.idle_timeout = idle;
            }
            if let Some(lifetime) = obj.get("max_lifetime").and_then(|v| v.as_u64()) {
                self.max_lifetime = lifetime;
            }
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), String> {
        if self.url.is_empty() {
            return Err("数据库 URL 是必需的，但未提供".to_string());
        }
        if self.max_connections == 0 {
            return Err("数据库最大连接数必须大于 0".to_string());
        }
        Ok(())
    }

    fn required_env_vars(&self) -> Vec<&str> {
        vec!["DATABASE_URL"]
    }

    fn apply_env_overrides(&mut self) -> Result<(), String> {
        if let Ok(url) = env::var("DATABASE_URL") {
            self.url = url;
        }
        Ok(())
    }
}
