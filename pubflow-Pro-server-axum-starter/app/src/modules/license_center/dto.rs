use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LicenseLookupRequest {
    pub activation_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LicenseLookupResponse {
    pub plan: String,
    pub status: String,
    pub max_devices: i32,
    pub device_migration_limit: i32,
    pub device_migration_count: i32,
    pub active_install_count: usize,
    pub expires_at: Option<DateTime<Utc>>,
    pub activated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SelfReplaceLicenseRequest {
    pub activation_code: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SelfReplaceLicenseResponse {
    pub new_activation_code: String,
    pub revoked_old: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SelfRevokeLicenseRequest {
    pub activation_code: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SelfRevokeLicenseResponse {
    pub revoked: bool,
}
