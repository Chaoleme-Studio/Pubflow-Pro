use chrono::Utc;
use entity::{lease, license, license_event, selector};
use pubflow_core::{
    selector::{decrypt_selector_json, encrypt_selector_json_str},
    selector_protocol::{
        SelectorProtocolResponsePayload, VERSION as PFSP_VERSION, activation_code_hash,
        client_nonce_hex, decode_request, encode_response, server_public_key_hex,
    },
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, Order, QueryFilter, QueryOrder,
    Set, TransactionTrait,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::error::PubFlowError;
use crate::shared::FromState;
use crate::{AppState, ValidationError};

use super::dto::{SelectorVersionResponse, UploadSelectorRequest, UploadSelectorResponse};

// 保留功能：当前 v0.2 Pro 插件使用本地 selector，不再依赖服务端下发 CSS 选择器。
// 这个模块仅作为未来远程配置/版本库能力保留，不参与插件发布流程主链路。
pub struct SelectorService {
    db: DatabaseConnection,
    redis: Option<deadpool_redis::Pool>,
    jwt_service: crate::shared::jwt::JwtService,
    selector_secret: String,
    protocol_private_key: String,
    replay_window_seconds: i64,
    nonce_ttl_seconds: u64,
}

impl FromState for SelectorService {
    fn from_state(state: &AppState) -> Self {
        Self {
            db: state.db.clone(),
            redis: state.redis.clone(),
            jwt_service: state.jwt_service.clone(),
            selector_secret: state.config.selector_secret.clone(),
            protocol_private_key: state.config.selector_protocol_private_key.clone(),
            replay_window_seconds: state.config.selector_replay_window_seconds,
            nonce_ttl_seconds: state.config.selector_nonce_ttl_seconds,
        }
    }
}

impl SelectorService {
    fn lease_install_id(lease_model: &lease::Model) -> &str {
        lease_model
            .client_install_id
            .as_deref()
            .filter(|value| !value.is_empty())
            .unwrap_or(&lease_model.machine_hash)
    }

    pub async fn fetch_protocol(&self, body: &[u8]) -> Result<Vec<u8>, crate::AppError> {
        let decoded = decode_request(body, &self.protocol_private_key, "pfsp-v1")
            .map_err(|error| PubFlowError::SelectorProtocol(error.to_string()))?;
        self.validate_timestamp(decoded.timestamp_ms)?;

        let nonce_key = format!(
            "pfsp:{}:{}",
            decoded.payload.activation_code_hash,
            client_nonce_hex(&decoded.client_nonce)
        );
        if !self.reserve_nonce(&nonce_key).await {
            return Err(PubFlowError::SelectorProtocol("PFSP_REPLAY".to_string()).into());
        }

        let lease_model = self
            .lease_from_token(&decoded.payload.lease_token)
            .await
            .map_err(|error| {
                tracing::debug!(?error, "selector protocol lease validation failed");
                PubFlowError::SelectorProtocol("PFSP_LEASE_INVALID".to_string())
            })?;

        if Self::lease_install_id(&lease_model) != decoded.payload.client_install_id {
            self.log_selector_event_by_license_id(
                lease_model.license_id,
                "failed",
                Some("device_mismatch"),
                Some(decoded.payload.client_install_id.clone()),
                decoded.payload.extension_version.clone(),
            )
            .await;
            return Err(PubFlowError::SelectorProtocol("PFSP_DEVICE_MISMATCH".to_string()).into());
        }

        let license_model = license::Entity::find_by_id(lease_model.license_id)
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;

        if activation_code_hash(&license_model.activation_code)
            != decoded.payload.activation_code_hash
        {
            self.log_selector_event(
                &license_model,
                "failed",
                Some("activation_hash_mismatch"),
                Some(Self::lease_install_id(&lease_model).to_string()),
                decoded.payload.extension_version.clone(),
            )
            .await;
            return Err(PubFlowError::SelectorProtocol("PFSP_LEASE_INVALID".to_string()).into());
        }
        self.ensure_license_and_lease_active(
            &license_model,
            &lease_model,
            decoded.payload.extension_version.clone(),
        )
        .await?;

        let selector_model = latest_selector(&self.db).await?;
        let selector_plaintext = decrypt_selector_json(
            &selector_model.encrypted_data,
            &self.selector_secret,
            &format!("selector-version-{}", selector_model.version),
        )
        .map_err(|error| PubFlowError::Internal(error.to_string()))?;
        let client_selector_blob = encrypt_selector_json_str(
            &selector_plaintext,
            &decoded.payload.activation_code_hash,
            &license_model.activation_code,
        )
        .map_err(|error| PubFlowError::Internal(error.to_string()))?;
        let payload = SelectorProtocolResponsePayload {
            version: selector_model.version,
            encrypted_selector_blob: client_selector_blob,
            checksum: selector_model.checksum,
            min_app_version: selector_model.min_app_version,
            expires_at: license_model
                .expires_at
                .map(|value| value.with_timezone(&Utc).timestamp()),
            server_time: Utc::now().timestamp(),
        };
        self.log_selector_event(
            &license_model,
            "success",
            None,
            Some(Self::lease_install_id(&lease_model).to_string()),
            decoded.payload.extension_version.clone(),
        )
        .await;
        encode_response(&payload, &decoded.response_key())
            .map_err(|error| PubFlowError::SelectorProtocol(error.to_string()).into())
    }

    pub async fn version(&self) -> Result<SelectorVersionResponse, crate::AppError> {
        let selector_model = latest_selector(&self.db).await?;
        Ok(SelectorVersionResponse {
            version: selector_model.version,
            min_app_version: selector_model.min_app_version,
            created_at: selector_model.created_at.with_timezone(&Utc),
            protocol_version: PFSP_VERSION,
            protocol_public_key: server_public_key_hex(&self.protocol_private_key)
                .map_err(|_| PubFlowError::InvalidCryptoConfig)?,
            server_time_ms: Utc::now().timestamp_millis(),
        })
    }

    pub async fn upload(
        &self,
        req: UploadSelectorRequest,
    ) -> Result<UploadSelectorResponse, crate::AppError> {
        if req.version <= 0 {
            return Err(ValidationError::custom("version 必须大于 0").into());
        }
        validate_selector_payload(&req.selectors)?;

        let min_app_version = req.min_app_version.unwrap_or_else(|| "0.1.0".to_string());
        let selector_json = serde_json::to_string(&req.selectors)
            .map_err(|error| PubFlowError::Internal(error.to_string()))?;
        let encrypted_data = encrypt_selector_json_str(
            &selector_json,
            &self.selector_secret,
            &format!("selector-version-{}", req.version),
        )
        .map_err(|e| PubFlowError::Internal(e.to_string()))?;
        let checksum = checksum(&encrypted_data);

        // 使用事务确保 deactivate + insert 原子性
        let txn = self.db.begin().await?;

        // 批量停用旧版本，避免逐条更新
        selector::Entity::update_many()
            .filter(selector::Column::IsActive.eq(true))
            .set(selector::ActiveModel {
                is_active: Set(false),
                ..Default::default()
            })
            .exec(&txn)
            .await?;

        let inserted = selector::ActiveModel {
            id: Set(Uuid::new_v4()),
            version: Set(req.version),
            encrypted_data: Set(encrypted_data),
            checksum: Set(checksum),
            min_app_version: Set(min_app_version),
            is_active: Set(true),
            created_at: Set(Utc::now().into()),
        }
        .insert(&txn)
        .await?;

        txn.commit().await?;

        Ok(UploadSelectorResponse {
            id: inserted.id.to_string(),
            version: inserted.version,
            checksum: inserted.checksum,
        })
    }

    async fn log_selector_event(
        &self,
        license_model: &license::Model,
        status: &str,
        reason: Option<&str>,
        client_install_id: Option<String>,
        extension_version: Option<String>,
    ) {
        if let Err(error) = (license_event::ActiveModel {
            id: Set(Uuid::new_v4()),
            license_id: Set(Some(license_model.id)),
            lease_id: Set(None),
            activation_code: Set(Some(license_model.activation_code.clone())),
            event_type: Set("selector_fetch".to_string()),
            status: Set(status.to_string()),
            reason: Set(reason.map(ToOwned::to_owned)),
            ip_address: Set("unknown".to_string()),
            machine_hash: Set(None),
            client_install_id: Set(client_install_id),
            platform: Set(None),
            extension_version: Set(extension_version),
            user_agent: Set(None),
            expires_at: Set(license_model.expires_at),
            created_at: Set(Utc::now().into()),
        })
        .insert(&self.db)
        .await
        {
            tracing::warn!(?error, "failed to write selector fetch event");
        }
    }

    async fn log_selector_event_by_license_id(
        &self,
        license_id: uuid::Uuid,
        status: &str,
        reason: Option<&str>,
        client_install_id: Option<String>,
        extension_version: Option<String>,
    ) {
        if let Ok(Some(license_model)) = license::Entity::find_by_id(license_id).one(&self.db).await
        {
            self.log_selector_event(
                &license_model,
                status,
                reason,
                client_install_id,
                extension_version,
            )
            .await;
        }
    }

    async fn lease_from_token(&self, lease_token: &str) -> Result<lease::Model, crate::AppError> {
        self.jwt_service
            .verify_token_custom(lease_token)
            .map_err(|_| crate::error::AuthError::InvalidToken)?;
        lease::Entity::find()
            .filter(lease::Column::LeaseToken.eq(lease_token))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LeaseNotFound.into())
    }

    async fn ensure_license_and_lease_active(
        &self,
        license_model: &license::Model,
        lease_model: &lease::Model,
        extension_version: Option<String>,
    ) -> Result<(), crate::AppError> {
        let now = Utc::now();
        let client_install_id = Some(Self::lease_install_id(lease_model).to_string());
        if license_model.is_revoked {
            self.log_selector_event(
                license_model,
                "failed",
                Some("license_revoked"),
                client_install_id.clone(),
                extension_version.clone(),
            )
            .await;
            return Err(PubFlowError::LicenseRevoked.into());
        }
        if license_model
            .expires_at
            .is_some_and(|expires_at| expires_at.with_timezone(&Utc) < now)
        {
            self.log_selector_event(
                license_model,
                "failed",
                Some("license_expired"),
                client_install_id.clone(),
                extension_version.clone(),
            )
            .await;
            return Err(PubFlowError::LicenseExpired.into());
        }
        if lease_model.is_revoked || lease_model.valid_until.with_timezone(&Utc) < now {
            self.log_selector_event(
                license_model,
                "failed",
                Some("lease_not_found"),
                client_install_id.clone(),
                extension_version.clone(),
            )
            .await;
            return Err(PubFlowError::LeaseNotFound.into());
        }
        Ok(())
    }

    fn validate_timestamp(&self, timestamp_ms: i64) -> Result<(), crate::AppError> {
        let now_ms = Utc::now().timestamp_millis();
        let allowed_ms = self.replay_window_seconds.saturating_mul(1000);
        if (now_ms - timestamp_ms).abs() > allowed_ms {
            return Err(PubFlowError::SelectorProtocol("PFSP_BAD_TIMESTAMP".to_string()).into());
        }
        Ok(())
    }

    async fn reserve_nonce(&self, key: &str) -> bool {
        if let Some(redis) = &self.redis
            && let Ok(mut conn) = redis.get().await
        {
            use deadpool_redis::redis::AsyncCommands;
            let result: Result<Option<String>, _> = conn
                .set_options(
                    key,
                    "1",
                    deadpool_redis::redis::SetOptions::default()
                        .conditional_set(deadpool_redis::redis::ExistenceCheck::NX)
                        .with_expiration(deadpool_redis::redis::SetExpiry::EX(
                            self.nonce_ttl_seconds,
                        )),
                )
                .await;
            return matches!(result, Ok(Some(_)));
        }

        reserve_nonce_in_memory(key, self.nonce_ttl_seconds)
    }
}

fn reserve_nonce_in_memory(key: &str, ttl_seconds: u64) -> bool {
    static NONCES: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    let now = Instant::now();
    let ttl = Duration::from_secs(ttl_seconds);
    let mut nonces = NONCES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .expect("nonce map mutex poisoned");
    nonces.retain(|_, expires_at| *expires_at > now);
    if nonces.contains_key(key) {
        return false;
    }
    nonces.insert(key.to_string(), now + ttl);
    true
}

async fn latest_selector(db: &DatabaseConnection) -> Result<selector::Model, crate::AppError> {
    selector::Entity::find()
        .filter(selector::Column::IsActive.eq(true))
        .order_by(selector::Column::Version, Order::Desc)
        .one(db)
        .await?
        .ok_or_else(|| PubFlowError::SelectorNotFound.into())
}

fn checksum(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

fn validate_selector_payload(selectors: &serde_json::Value) -> Result<(), crate::AppError> {
    let platforms = selectors
        .as_object()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| ValidationError::custom("selectors 必须是非空平台配置对象"))?;

    for value in platforms.values() {
        if !looks_like_complete_platform_selector(value) {
            return Err(ValidationError::custom(
                "Selector 版本格式不可用，请上传完整平台 Selector JSON".to_string(),
            )
            .into());
        }
    }

    Ok(())
}

fn looks_like_complete_platform_selector(value: &serde_json::Value) -> bool {
    let Some(platform) = value.as_object() else {
        return false;
    };
    platform.get("平台标识").is_some()
        && platform.get("名称").is_some()
        && platform.get("匹配域名").is_some()
        && platform.get("上传").is_some()
        && platform.get("字段").is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn selector_upload_rejects_legacy_flat_payload() {
        let payload = json!({
            "douyin": {
                "title_input": "#title-input",
                "desc_input": "#desc-input"
            }
        });

        let error = validate_selector_payload(&payload).unwrap_err().to_string();

        assert!(error.contains("Selector 版本格式不可用"));
    }

    #[test]
    fn selector_upload_accepts_platform_selector_payload() {
        let payload = json!({
            "douyin": {
                "平台标识": "douyin",
                "名称": "抖音创作者",
                "图标": "DY",
                "发布页地址": "https://creator.douyin.com/creator-micro/content/upload",
                "匹配域名": ["creator.douyin.com"],
                "就绪选择器": "input",
                "上传": {
                    "上传容器": ".upload",
                    "文件输入框": ["input[type=file]"],
                    "上传完成标记": ".done",
                    "编辑器就绪标记": "input"
                },
                "字段": {
                    "标题": "input",
                    "简介": "textarea"
                }
            }
        });

        validate_selector_payload(&payload).unwrap();
    }
}
