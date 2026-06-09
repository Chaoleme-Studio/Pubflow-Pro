use chrono::{Duration, Utc};
use rand::Rng;

use crate::ValidationError;

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
