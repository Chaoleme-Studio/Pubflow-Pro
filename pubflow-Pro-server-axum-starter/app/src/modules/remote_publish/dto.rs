use chrono::{DateTime, NaiveDate, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub activation_code: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub license_expires_at: Option<DateTime<Utc>>,
    pub access_expires_at: DateTime<Utc>,
    pub refresh_expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetDescriptor {
    pub role: String,
    pub file_name: String,
    pub content_type: Option<String>,
    pub size: i64,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FillOptions {
    pub topic_interval_ms: Option<u64>,
}

fn default_visibility() -> String {
    "public".to_string()
}
fn default_publish_mode() -> String {
    "fill_only".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateJobRequest {
    pub request_id: String,
    pub content_type: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub article_content: Option<String>,
    #[serde(default)]
    pub topics: Vec<String>,
    #[serde(default)]
    pub campaign_ids: Vec<String>,
    pub platforms: Vec<String>,
    pub scheduled_at: Option<i64>,
    #[serde(default = "default_visibility")]
    pub visibility: String,
    #[serde(default)]
    pub original_declare: bool,
    #[serde(default)]
    pub platform_settings: serde_json::Map<String, Value>,
    pub fill_options: Option<FillOptions>,
    #[serde(default)]
    pub assets: Vec<AssetDescriptor>,
    #[serde(default = "default_publish_mode")]
    pub publish_mode: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetView {
    pub asset_id: String,
    pub role: String,
    pub file_name: String,
    pub content_type: Option<String>,
    pub size: i64,
    pub sha256: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub job_id: String,
    pub project_id: String,
    pub request_id: String,
    pub content_type: String,
    pub title: String,
    pub platforms: Vec<String>,
    pub publish_mode: String,
    pub status: String,
    pub status_sequence: i64,
    pub declared_bytes: i64,
    pub assets: Vec<AssetView>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobListView {
    pub items: Vec<JobView>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QuotaView {
    pub date: NaiveDate,
    pub job_limit: i32,
    pub jobs_used: i32,
    pub jobs_remaining: i32,
    pub byte_limit: i64,
    pub bytes_used: i64,
    pub bytes_remaining: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTestView {
    pub connected: bool,
    pub latency_ms: u64,
    pub tested_at: DateTime<Utc>,
    pub extension_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatusMessage {
    pub job_id: String,
    pub status: String,
    pub status_sequence: i64,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminQuotaOverrideRequest {
    pub job_limit: Option<i32>,
    pub byte_limit: Option<i64>,
}
