use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;

use super::section::ConfigSection;

/// 服务器配置
///
/// 包含 HTTP 服务器的绑定地址、端口和请求超时时间等配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    /// 服务器绑定地址（默认：127.0.0.1）
    pub host: String,

    /// 服务器监听端口（默认：5189）
    pub port: u16,

    /// 请求超时时间，单位秒（默认：30）
    pub timeout: u64,

    /// 每个真实客户端 IP 的 HTTP 平均请求数/秒（默认：20）
    pub http_rate_limit_requests_per_second: u32,

    /// 每个真实客户端 IP 允许的 HTTP 突发请求数（默认：100）
    pub http_rate_limit_burst: u32,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 5189,
            timeout: 30,
            http_rate_limit_requests_per_second: 20,
            http_rate_limit_burst: 100,
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
            if let Some(value) = obj
                .get("http_rate_limit_requests_per_second")
                .and_then(|v| v.as_u64())
            {
                self.http_rate_limit_requests_per_second = u32::try_from(value)
                    .map_err(|_| "http_rate_limit_requests_per_second 超出 u32".to_string())?;
            }
            if let Some(value) = obj.get("http_rate_limit_burst").and_then(|v| v.as_u64()) {
                self.http_rate_limit_burst = u32::try_from(value)
                    .map_err(|_| "http_rate_limit_burst 超出 u32".to_string())?;
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
        if self.http_rate_limit_requests_per_second == 0 || self.http_rate_limit_burst == 0 {
            return Err("HTTP 限流参数必须大于 0".to_string());
        }
        if self.http_rate_limit_requests_per_second > 1_000_000_000 {
            return Err("HTTP 每秒请求数不能超过 1000000000".to_string());
        }
        Ok(())
    }

    fn apply_env_overrides(&mut self) -> Result<(), String> {
        if let Ok(host) = env::var("APP_SERVER_HOST").or_else(|_| env::var("SERVER_HOST")) {
            let host = host.trim();
            if !host.is_empty() {
                self.host = host.to_string();
            }
        }
        if let Ok(port) = env::var("APP_SERVER_PORT").or_else(|_| env::var("SERVER_PORT")) {
            let port = port.trim();
            if !port.is_empty() {
                self.port = port
                    .parse::<u16>()
                    .map_err(|error| format!("服务器端口环境变量无效：{error}"))?;
            }
        }
        if let Ok(timeout) = env::var("APP_SERVER_TIMEOUT").or_else(|_| env::var("SERVER_TIMEOUT"))
        {
            let timeout = timeout.trim();
            if !timeout.is_empty() {
                self.timeout = timeout
                    .parse::<u64>()
                    .map_err(|error| format!("服务器超时环境变量无效：{error}"))?;
            }
        }
        parse_env(
            "APP_HTTP_RATE_LIMIT_REQUESTS_PER_SECOND",
            &mut self.http_rate_limit_requests_per_second,
        )?;
        parse_env("APP_HTTP_RATE_LIMIT_BURST", &mut self.http_rate_limit_burst)?;
        Ok(())
    }
}

fn parse_env<T>(name: &str, target: &mut T) -> Result<(), String>
where
    T: std::str::FromStr,
{
    if let Ok(value) = env::var(name) {
        let value = value.trim();
        if !value.is_empty() {
            *target = value.parse().map_err(|_| format!("{name} 格式无效"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::ServerConfig;

    #[test]
    fn default_http_rate_limit_allows_shared_ip_bursts() {
        let config = ServerConfig::default();
        assert_eq!(config.http_rate_limit_requests_per_second, 20);
        assert_eq!(config.http_rate_limit_burst, 100);
    }
}
