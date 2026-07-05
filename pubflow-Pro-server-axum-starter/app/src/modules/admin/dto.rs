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
    pub device_migration_limit: i32,
    pub device_migration_count: i32,
    pub last_migrated_at: Option<DateTime<Utc>>,
    pub is_revoked: bool,
    pub client_install_ids: Vec<String>,
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
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RevokeLicenseResponse {
    pub revoked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DeleteLicenseRequest {
    pub activation_code: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DeleteLicenseResponse {
    pub deleted: bool,
    pub revoked_leases: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FreezeLicenseRequest {
    pub activation_code: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FreezeLicenseResponse {
    pub frozen: bool,
    pub revoked_leases: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UnfreezeLicenseRequest {
    pub activation_code: String,
    pub reason: Option<String>,
    pub reset_migration_count: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UnfreezeLicenseResponse {
    pub unfrozen: bool,
    pub device_migration_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UnbindLicenseDeviceRequest {
    pub activation_code: String,
    pub client_install_id: String,
    pub reason: Option<String>,
    pub consume_migration: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UnbindLicenseDeviceResponse {
    pub revoked_leases: u64,
    pub device_migration_count: i32,
    pub device_migration_limit: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AdminPlanConfig {
    pub id: String,
    pub name: String,
    pub unit: Option<String>,
    pub note: Option<String>,
    pub original_amount_cents: i32,
    pub discount_amount_cents: Option<i32>,
    pub discount_start_at: Option<DateTime<Utc>>,
    pub discount_end_at: Option<DateTime<Utc>>,
    pub discount_enabled: bool,
    pub is_active: bool,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AdminDownloadConfig {
    pub code: String,
    pub platform: String,
    pub name: String,
    pub chip: Option<String>,
    pub file_name: Option<String>,
    pub href: String,
    pub is_active: bool,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AdminProductCatalogConfig {
    pub plans: Vec<AdminPlanConfig>,
    pub downloads: Vec<AdminDownloadConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AdminAppVersionQuery {
    pub platform: Option<String>,
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AdminAppVersionItem {
    pub id: String,
    pub platform: String,
    pub version: String,
    pub min_app_version: Option<String>,
    pub download_url: String,
    pub download_url_mirror: Option<String>,
    pub release_notes: Option<String>,
    pub force_update: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AdminAppVersionListResponse {
    pub items: Vec<AdminAppVersionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct CreateAppVersionRequest {
    pub platform: String,
    pub version: String,
    pub min_app_version: Option<String>,
    pub download_url: String,
    pub download_url_mirror: Option<String>,
    pub release_notes: Option<String>,
    pub force_update: Option<bool>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UpdateAppVersionRequest {
    pub platform: Option<String>,
    pub version: String,
    pub min_app_version: Option<String>,
    pub download_url: String,
    pub download_url_mirror: Option<String>,
    pub release_notes: Option<String>,
    pub force_update: Option<bool>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DeleteAppVersionResponse {
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ReplaceLicenseRequest {
    pub activation_code: String,
    pub reason: String,
    pub revoke_old: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ReplaceLicenseResponse {
    pub old_license_id: String,
    pub new_license_id: String,
    pub new_activation_code: String,
    pub revoked_old: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UpdateLicenseLimitsRequest {
    pub activation_code: String,
    pub max_devices: i32,
    pub device_migration_limit: i32,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UpdateLicenseLimitsResponse {
    pub item: LicenseItem,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ListLicenseQuery {
    pub keyword: Option<String>,
    pub activation_code: Option<String>,
    pub tier: Option<String>,
    pub plan: Option<String>,
    pub client_install_id: Option<String>,
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
    pub client_install_ids: Vec<String>,
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
    pub client_install_id: Option<String>,
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
