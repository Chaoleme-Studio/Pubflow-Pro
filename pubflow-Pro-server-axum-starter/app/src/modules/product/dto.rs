use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ProductCatalogResponse {
    pub plans: Vec<PlanItem>,
    pub downloads: Vec<DownloadItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PlanItem {
    pub id: String,
    pub name: String,
    pub price: String,
    pub unit: String,
    pub note: String,
    pub amount_cents: i32,
    pub original_amount_cents: Option<i32>,
    pub discount_amount_cents: Option<i32>,
    pub discount_start_at: Option<DateTime<Utc>>,
    pub discount_end_at: Option<DateTime<Utc>>,
    pub discount_enabled: bool,
    pub is_discount_active: bool,
    pub savings_cents: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DownloadItem {
    pub platform: String,
    pub name: String,
    pub chip: String,
    pub file_name: String,
    pub href: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ProductVersionQuery {
    pub platform: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ProductVersionListQuery {
    pub platform: Option<String>,
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ProductVersionResponse {
    pub id: String,
    pub platform: String,
    pub version: String,
    pub latest_version: String,
    pub min_version: String,
    pub min_app_version: Option<String>,
    pub download_url: String,
    pub download_url_mirror: Option<String>,
    pub release_notes: String,
    pub force_update: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ProductVersionListResponse {
    pub items: Vec<ProductVersionResponse>,
}
