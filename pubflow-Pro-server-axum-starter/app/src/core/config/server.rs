use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::section::ConfigSection;

/// 服务器配置
///
/// 包含 HTTP 服务器的绑定地址、端口和请求超时时间等配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    /// 服务器绑定地址（默认：127.0.0.1）
    pub host: String,

    /// 服务器监听端口（默认：3001）
    pub port: u16,

    /// 请求超时时间，单位秒（默认：30）
    pub timeout: u64,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 3001,
            timeout: 30,
        }
    }
}

impl ConfigSection for ServerConfig {
    fn section_name(&self) -> &str {
        "server"
    }

    fn load_from_value(&mut self, value: &Value) -> Result<(), String> {
        if let Some(obj) = value.as_object() {
            if let Some(host) = obj.get("host").and_then(|v| v.as_str()) {
                self.host = host.to_string();
            }
            if let Some(port) = obj.get("port").and_then(|v| v.as_u64()) {
                self.port = port as u16;
            }
            if let Some(timeout) = obj.get("timeout").and_then(|v| v.as_u64()) {
                self.timeout = timeout;
            }
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), String> {
        if self.port == 0 {
            return Err("服务器端口不能为 0".to_string());
        }
        if self.timeout == 0 {
            return Err("服务器超时时间必须大于 0".to_string());
        }
        Ok(())
    }
}
