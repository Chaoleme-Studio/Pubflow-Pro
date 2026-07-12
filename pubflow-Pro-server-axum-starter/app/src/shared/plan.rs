use chrono::{Duration, Utc};
use rand::Rng;

use crate::ValidationError;

const DEVICE_MIGRATION_LIMIT_PER_30_DAYS: i64 = 5;
const MAX_DEVICE_MIGRATION_LIMIT: i64 = 100;

pub fn normalize_plan(plan: &str) -> Result<&'static str, ValidationError> {
    match plan {
        "monthly" => Ok("monthly"),
        "yearly" => Ok("yearly"),
        _ => Err(ValidationError::custom("plan 必须是 monthly 或 yearly")),
    }
}

pub fn expires_at_for_plan(plan: &str) -> Result<chrono::DateTime<Utc>, ValidationError> {
    Ok(Utc::now() + duration_for_plan(plan)?)
}

pub fn duration_for_plan(plan: &str) -> Result<Duration, ValidationError> {
    match plan {
        "monthly" => Ok(Duration::days(31)),
        "yearly" => Ok(Duration::days(365)),
        _ => Err(ValidationError::custom("plan 必须是 monthly 或 yearly")),
    }
}

/// 按订阅时长折算设备迁移/自助解绑额度。
///
/// 当前策略：每 30 天给 5 次，至少 5 次。这样月卡 5 次、年卡 60 次，
/// 避免长周期订阅仍只有月卡级别的恢复额度。
pub fn device_migration_limit_for_plan(plan: &str) -> Result<i32, ValidationError> {
    let days = duration_for_plan(plan)?.num_days();
    let periods = (days / 30).max(1);
    Ok((periods * DEVICE_MIGRATION_LIMIT_PER_30_DAYS).clamp(
        DEVICE_MIGRATION_LIMIT_PER_30_DAYS,
        MAX_DEVICE_MIGRATION_LIMIT,
    ) as i32)
}

pub fn new_activation_code() -> String {
    let mut rng = rand::rng();
    let suffix: String = (0..16)
        .map(|_| {
            let n = rng.random_range(0..36);
            if n < 10 {
                (b'0' + n as u8) as char
            } else {
                (b'A' + (n - 10) as u8) as char
            }
        })
        .collect();
    format!("PF-{}", suffix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_limit_scales_with_subscription_duration() {
        assert_eq!(device_migration_limit_for_plan("monthly").unwrap(), 5);
        assert_eq!(device_migration_limit_for_plan("yearly").unwrap(), 60);
    }
}
