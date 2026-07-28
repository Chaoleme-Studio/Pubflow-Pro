use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;

use super::section::ConfigSection;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RemotePublishConfig {
    pub storage_path: String,
    pub daily_job_limit: i32,
    pub daily_byte_limit: i64,
    pub aggregate_transfer_bytes_per_second: u64,
    pub max_concurrent_transfers: usize,
    pub access_ttl_seconds: i64,
    pub refresh_ttl_seconds: i64,
    pub asset_ticket_ttl_seconds: i64,
    pub unclaimed_retention_hours: i64,
    pub job_retention_days: i64,
    pub secure_cookies: bool,
}

impl Default for RemotePublishConfig {
    fn default() -> Self {
        Self {
            storage_path: "./data/remote-publish".to_string(),
            daily_job_limit: 3,
            daily_byte_limit: 100 * 1024 * 1024,
            aggregate_transfer_bytes_per_second: 192 * 1024,
            max_concurrent_transfers: 4,
            access_ttl_seconds: 15 * 60,
            refresh_ttl_seconds: 30 * 24 * 60 * 60,
            asset_ticket_ttl_seconds: 10 * 60,
            unclaimed_retention_hours: 72,
            job_retention_days: 30,
            secure_cookies: true,
        }
    }
}

impl ConfigSection for RemotePublishConfig {
    fn section_name(&self) -> &str {
        "remote_publish"
    }

    fn load_from_value(&mut self, _value: &Value) -> Result<(), String> {
        Ok(())
    }

    fn validate(&self) -> Result<(), String> {
        if self.storage_path.trim().is_empty() {
            return Err("storage_path 不能为空".to_string());
        }
        if self.daily_job_limit <= 0 || self.daily_byte_limit <= 0 {
            return Err("每日远程发布限额必须大于 0".to_string());
        }
        if self.aggregate_transfer_bytes_per_second == 0 || self.max_concurrent_transfers == 0 {
            return Err("远程素材传输限制必须大于 0".to_string());
        }
        if self.access_ttl_seconds < 60 || self.refresh_ttl_seconds <= self.access_ttl_seconds {
            return Err("远程会话 TTL 配置无效".to_string());
        }
        if self.asset_ticket_ttl_seconds <= 0
            || self.unclaimed_retention_hours <= 0
            || self.job_retention_days <= 0
        {
            return Err("远程素材票据与任务保留期必须大于 0".to_string());
        }
        Ok(())
    }

    fn apply_env_overrides(&mut self) -> Result<(), String> {
        if let Ok(value) = env::var("REMOTE_PUBLISH_STORAGE_PATH") {
            self.storage_path = value;
        }
        parse_env("REMOTE_PUBLISH_DAILY_JOB_LIMIT", &mut self.daily_job_limit)?;
        parse_env(
            "REMOTE_PUBLISH_DAILY_BYTE_LIMIT",
            &mut self.daily_byte_limit,
        )?;
        parse_env(
            "REMOTE_PUBLISH_AGGREGATE_TRANSFER_BYTES_PER_SECOND",
            &mut self.aggregate_transfer_bytes_per_second,
        )?;
        parse_env(
            "REMOTE_PUBLISH_MAX_CONCURRENT_TRANSFERS",
            &mut self.max_concurrent_transfers,
        )?;
        parse_env(
            "REMOTE_PUBLISH_ACCESS_TTL_SECONDS",
            &mut self.access_ttl_seconds,
        )?;
        parse_env(
            "REMOTE_PUBLISH_REFRESH_TTL_SECONDS",
            &mut self.refresh_ttl_seconds,
        )?;
        parse_env(
            "REMOTE_PUBLISH_ASSET_TICKET_TTL_SECONDS",
            &mut self.asset_ticket_ttl_seconds,
        )?;
        parse_env(
            "REMOTE_PUBLISH_UNCLAIMED_RETENTION_HOURS",
            &mut self.unclaimed_retention_hours,
        )?;
        parse_env(
            "REMOTE_PUBLISH_JOB_RETENTION_DAYS",
            &mut self.job_retention_days,
        )?;
        if let Ok(value) = env::var("REMOTE_PUBLISH_SECURE_COOKIES") {
            self.secure_cookies = value
                .parse()
                .map_err(|_| "REMOTE_PUBLISH_SECURE_COOKIES 必须为 true/false".to_string())?;
        }
        Ok(())
    }
}

fn parse_env<T>(name: &str, target: &mut T) -> Result<(), String>
where
    T: std::str::FromStr,
{
    if let Ok(value) = env::var(name) {
        *target = value.parse().map_err(|_| format!("{name} 格式无效"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::RemotePublishConfig;

    #[test]
    fn default_daily_byte_limit_is_exactly_100_mib() {
        assert_eq!(
            RemotePublishConfig::default().daily_byte_limit,
            100 * 1024 * 1024
        );
    }
}
