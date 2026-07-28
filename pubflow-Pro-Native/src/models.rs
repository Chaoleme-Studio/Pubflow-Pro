use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlatformId {
    Douyin,
    Xiaohongshu,
    WeixinChannels,
    Bilibili,
    Kuaishou,
    Weibo,
    Zhihu,
    Xigua,
    X,
    Youtube,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    Video,
    Image,
    Article,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    #[default]
    Public,
    Friends,
    Private,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishMode {
    #[default]
    FillOnly,
    AutoSubmit,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetInput {
    pub video_path: Option<String>,
    pub cover_path: Option<String>,
    #[serde(default)]
    pub image_paths: Vec<String>,
    pub music_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FillOptions {
    pub topic_interval_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobCreate {
    pub request_id: Option<String>,
    pub content_type: ContentType,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub article_content: Option<String>,
    #[serde(default)]
    pub topics: Vec<String>,
    #[serde(default)]
    pub campaign_ids: Vec<String>,
    pub platforms: Vec<PlatformId>,
    pub scheduled_at: Option<i64>,
    #[serde(default)]
    pub visibility: Visibility,
    #[serde(default)]
    pub original_declare: bool,
    #[serde(default)]
    pub platform_settings: BTreeMap<String, Value>,
    pub fill_options: Option<FillOptions>,
    #[serde(default)]
    pub publish_mode: PublishMode,
    #[serde(default)]
    pub assets: AssetInput,
}

impl JobCreate {
    pub fn validate_and_normalize(&mut self) -> Result<(), String> {
        self.title = self.title.trim().to_owned();
        if self.title.is_empty() || self.title.chars().count() > 200 {
            return Err("title 必须为 1-200 个字符".to_owned());
        }
        if self.description.chars().count() > 10_000 {
            return Err("description 不能超过 10000 个字符".to_owned());
        }
        if self.platforms.is_empty() {
            return Err("platforms 至少需要一个平台".to_owned());
        }
        let mut seen = HashSet::new();
        self.platforms.retain(|platform| seen.insert(*platform));
        self.topics = self
            .topics
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        self.campaign_ids = self
            .campaign_ids
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        match self.content_type {
            ContentType::Video if blank(&self.assets.video_path) => {
                return Err("video 内容必须提供 assets.videoPath".to_owned());
            }
            ContentType::Image if self.assets.image_paths.is_empty() => {
                return Err("image 内容必须提供至少一个 assets.imagePaths".to_owned());
            }
            ContentType::Article if blank(&self.article_content) => {
                return Err("article 内容必须提供 articleContent".to_owned());
            }
            _ => {}
        }
        Ok(())
    }
}

fn blank(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(|value| value.trim().is_empty())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub job_id: String,
    pub project_id: String,
    pub status: String,
    pub status_sequence: i64,
    pub project_path: String,
    pub platforms: Vec<PlatformId>,
    pub created_at: i64,
    pub updated_at: i64,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExtensionMessage {
    Hello(HelloPayload),
    Ping(PingPayload),
    ClaimJob(JobIdPayload),
    JobAccepted(JobSequencePayload),
    JobStatus(JobStatusPayload),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloPayload {
    pub extension_id: Option<String>,
    pub version: Option<String>,
    pub workspace_id: Option<String>,
    pub license_grant: Option<ExtensionLicenseGrant>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionLicenseGrant {
    pub tier: String,
    pub features: Vec<String>,
    pub valid_until: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingPayload {
    pub timestamp: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobIdPayload {
    pub job_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSequencePayload {
    pub job_id: String,
    pub status_sequence: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatusPayload {
    pub job_id: String,
    pub status: String,
    pub status_sequence: i64,
    pub error: Option<String>,
    #[serde(default)]
    pub task: Value,
}

pub fn terminal_job_status(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}
