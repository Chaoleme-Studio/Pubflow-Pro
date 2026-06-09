use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AdminLoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AdminLoginResponse {
    pub token: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct GenerateLicenseRequest {
    pub plan: String,
    pub quantity: Option<u32>,
    pub max_devices: Option<i32>,
    pub batch_name: Option<String>,
    pub sales_channel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LicenseItem {
    pub id: String,
    pub activation_code: String,
    pub tier: String,
    pub plan: String,
    pub status: String,
    pub source_channel: String,
    pub batch_id: Option<String>,
    pub batch_name: Option<String>,
    pub user_id: Option<i32>,
    pub max_devices: i32,
    pub is_revoked: bool,
    pub machine_hashes: Vec<String>,
    pub order_no: Option<String>,
    pub order_channel: Option<String>,
    pub amount_cents: Option<i32>,
    pub paid_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub activated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LicenseSummary {
    pub total: i64,
    pub pending: i64,
    pub active: i64,
    pub revenue_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LicenseListResponse {
    pub items: Vec<LicenseItem>,
    pub summary: LicenseSummary,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct GenerateLicenseResponse {
    pub items: Vec<LicenseItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RevokeLicenseRequest {
    pub activation_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RevokeLicenseResponse {
    pub revoked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ListLicenseQuery {
    pub keyword: Option<String>,
    pub activation_code: Option<String>,
    pub tier: Option<String>,
    pub plan: Option<String>,
    pub machine_hash: Option<String>,
    pub is_revoked: Option<bool>,
    pub created_from: Option<String>,
    pub created_to: Option<String>,
    pub paid_from: Option<String>,
    pub paid_to: Option<String>,
    pub expires_from: Option<String>,
    pub expires_to: Option<String>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UserOperationItem {
    pub id: i32,
    pub username: String,
    pub email: String,
    pub status: String,
    pub plan: Option<String>,
    pub source: Option<String>,
    pub machine_hashes: Vec<String>,
    pub license_count: usize,
    pub order_no: Option<String>,
    pub amount_cents: Option<i32>,
    pub paid_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ListUserQuery {
    pub keyword: Option<String>,
    pub plan: Option<String>,
    pub machine_hash: Option<String>,
    pub status: Option<String>,
    pub paid_from: Option<String>,
    pub paid_to: Option<String>,
    pub expires_from: Option<String>,
    pub expires_to: Option<String>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct OrderOperationItem {
    pub id: String,
    pub order_no: String,
    pub plan: String,
    pub channel: String,
    pub status: String,
    pub machine_hash: Option<String>,
    pub activation_code: Option<String>,
    pub amount_cents: i32,
    pub paid_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ListOrderQuery {
    pub keyword: Option<String>,
    pub plan: Option<String>,
    pub machine_hash: Option<String>,
    pub status: Option<String>,
    pub paid_from: Option<String>,
    pub paid_to: Option<String>,
    pub expires_from: Option<String>,
    pub expires_to: Option<String>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}
