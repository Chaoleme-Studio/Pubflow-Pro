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
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DownloadItem {
    pub platform: String,
    pub name: String,
    pub chip: String,
    pub file_name: String,
    pub href: String,
}
