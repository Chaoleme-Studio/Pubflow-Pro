use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FetchSelectorRequest {
    pub activation_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SelectorResponse {
    pub version: i32,
    pub encrypted_data: String,
    pub checksum: String,
    pub min_app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SelectorVersionResponse {
    pub version: i32,
    pub min_app_version: String,
    pub created_at: DateTime<Utc>,
    pub protocol_version: u8,
    pub protocol_key_version: i32,
    pub protocol_public_key: String,
    pub protocol_public_key_expires_at: DateTime<Utc>,
    pub protocol_signature_algorithm: Option<String>,
    pub protocol_signing_key_id: Option<String>,
    pub protocol_signed_payload: Option<String>,
    pub protocol_signature: Option<String>,
    pub server_time_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UploadSelectorRequest {
    pub version: i32,
    pub selectors: Value,
    pub min_app_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UploadSelectorResponse {
    pub id: String,
    pub version: i32,
    pub checksum: String,
}
