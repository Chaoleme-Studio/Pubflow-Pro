use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{Duration, NaiveDate, TimeZone, Utc};
use entity::{lease, license, license_event};
use p256::ecdsa::{Signature, VerifyingKey, signature::Verifier};
use p256::pkcs8::DecodePublicKey;
use pubflow_core::selector_protocol::{
    ActivationProtocolResponsePayload, client_nonce_hex, decode_activation_request,
    encode_activation_response,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration as StdDuration, Instant};
use uuid::Uuid;

use crate::AppState;
use crate::error::PubFlowError;
use crate::shared::FromState;
use crate::shared::plan::duration_for_plan;

use super::dto::{
    ActivateLeaseRequest, ActivateLeaseResponse, DeactivateLeaseRequest, DeactivateLeaseResponse,
    DeviceChallengeRequest, DeviceChallengeResponse, DeviceProof, IssuePermitRequest,
    IssuePermitResponse, RenewLeaseRequest, RenewLeaseResponse, VerifyLeaseRequest,
    VerifyLeaseResponse,
};

const LEGACY_MACHINE_HASH_PLACEHOLDER: &str = "client-install-id";
const DEVICE_KEY_ALGORITHM: &str = "ECDSA_P256_SHA256";
const DEVICE_CHALLENGE_TTL_SECONDS: u64 = 300;
const PERMIT_TTL_SECONDS: i64 = 30 * 60;
const RATE_LIMIT_ACTIVATE_IP_PER_MINUTE: u32 = 10;
const RATE_LIMIT_ACTIVATION_CODE_PER_HOUR: u32 = 20;
const RATE_LIMIT_CHALLENGE_IP_PER_MINUTE: u32 = 20;
const RATE_LIMIT_CHALLENGE_DEVICE_PER_MINUTE: u32 = 30;
const RATE_LIMIT_VERIFY_LEASE_PER_MINUTE: u32 = 30;
const RATE_LIMIT_RENEW_DEVICE_PER_HOUR: u32 = 10;
const RATE_LIMIT_PERMIT_DEVICE_PER_MINUTE: u32 = 10;
const SECONDS_PER_MINUTE: u64 = 60;
const SECONDS_PER_HOUR: u64 = 3600;
const LICENSE_EVENT_RETENTION_DAYS: i64 = 90;
const DEVICE_KEY_ROLLOUT_YEAR: i32 = 2026;
const DEVICE_KEY_ROLLOUT_MONTH: u32 = 7;
const DEVICE_KEY_ROLLOUT_DAY: u32 = 4;
const LEGACY_UNBOUND_DEVICE_PROOF_COMPAT_DAYS: i64 = 30;

/// 根据 license tier 获取功能列表
fn features_for_tier(tier: &str) -> Vec<String> {
    match tier {
        "pro" => vec![
            "publish".to_string(),
            "batch".to_string(),
            "selector-updates".to_string(),
        ],
        "enterprise" => vec![
            "publish".to_string(),
            "batch".to_string(),
            "selector-updates".to_string(),
            "priority-support".to_string(),
            "custom-selectors".to_string(),
        ],
        _ => vec!["publish".to_string()],
    }
}

/// 续租宽限期（天）- lease 过期后仍可续租的时间
const RENEWAL_GRACE_DAYS: i64 = 7;
/// 订阅版 lease 最长有效期（天）。
///
/// 订阅商业控制依赖服务端续租点，不能再签发近似离线授权的长期 lease。
const MAX_SUBSCRIPTION_LEASE_DAYS: i64 = 31;

/// 根据 license 剩余天数计算 lease 有效期，并以 license 到期时间为上限
fn compute_lease_valid_until(
    now: chrono::DateTime<Utc>,
    license_expires_at: chrono::DateTime<Utc>,
) -> chrono::DateTime<Utc> {
    let valid_until = now + Duration::days(MAX_SUBSCRIPTION_LEASE_DAYS);
    if valid_until > license_expires_at {
        license_expires_at
    } else {
        valid_until
    }
}

fn license_expires_at_utc(license_model: &license::Model) -> Option<chrono::DateTime<Utc>> {
    license_model
        .expires_at
        .as_ref()
        .map(|value| value.with_timezone(&Utc))
}

/// 解析日期字符串为当天开始时间（00:00:00）
fn parse_date_start(date_str: &str) -> Option<chrono::DateTime<Utc>> {
    NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|dt| dt.and_utc())
}

/// 解析日期字符串为当天结束时间（23:59:59）
fn parse_date_end(date_str: &str) -> Option<chrono::DateTime<Utc>> {
    NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(23, 59, 59))
        .map(|dt| dt.and_utc())
}

pub struct LeaseService {
    db: DatabaseConnection,
    jwt_service: crate::shared::jwt::JwtService,
    redis: Option<deadpool_redis::Pool>,
    protocol_private_key: String,
    replay_window_seconds: i64,
    nonce_ttl_seconds: u64,
}

impl FromState for LeaseService {
    fn from_state(state: &AppState) -> Self {
        Self {
            db: state.db.clone(),
            jwt_service: state.jwt_service.clone(),
            redis: state.redis.clone(),
            protocol_private_key: state.config.selector_protocol_private_key.clone(),
            replay_window_seconds: state.config.selector_replay_window_seconds,
            nonce_ttl_seconds: state.config.selector_nonce_ttl_seconds,
        }
    }
}

impl LeaseService {
    fn request_install_id(
        client_install_id: Option<String>,
        legacy_machine_hash: Option<String>,
    ) -> Result<String, crate::AppError> {
        client_install_id
            .or(legacy_machine_hash)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                PubFlowError::Internal("client_install_id is required".to_string()).into()
            })
    }

    fn lease_install_id(lease_model: &lease::Model) -> &str {
        lease_model
            .client_install_id
            .as_deref()
            .filter(|value| !value.is_empty())
            .unwrap_or(&lease_model.machine_hash)
    }

    fn validate_timestamp(&self, timestamp_ms: i64) -> Result<(), crate::AppError> {
        let now_ms = Utc::now().timestamp_millis();
        let skew_ms = (now_ms - timestamp_ms).abs();
        if skew_ms > self.replay_window_seconds * 1000 {
            return Err(PubFlowError::SelectorProtocol("PFAP_BAD_TIMESTAMP".to_string()).into());
        }
        Ok(())
    }

    async fn reserve_nonce(&self, nonce_key: &str) -> bool {
        if let Some(redis) = &self.redis
            && let Ok(mut conn) = redis.get().await
        {
            use deadpool_redis::redis::AsyncCommands;
            let result: Result<Option<String>, _> = conn
                .set_options(
                    nonce_key,
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

        reserve_pfap_nonce_in_memory(nonce_key, self.nonce_ttl_seconds)
    }

    async fn ensure_business_rate_limit(
        &self,
        key: &str,
        max_requests: u32,
        window_seconds: u64,
    ) -> Result<(), crate::AppError> {
        if self
            .check_business_rate_limit(key, max_requests, window_seconds)
            .await
        {
            Ok(())
        } else {
            Err(PubFlowError::RateLimitExceeded.into())
        }
    }

    async fn check_business_rate_limit(
        &self,
        key: &str,
        max_requests: u32,
        window_seconds: u64,
    ) -> bool {
        if let Some(redis) = &self.redis
            && let Ok(mut conn) = redis.get().await
        {
            use deadpool_redis::redis::AsyncCommands;
            let count: Result<i64, _> = conn.incr(key, 1).await;
            if let Ok(count) = count {
                if count == 1 {
                    let _: Result<bool, _> = conn.expire(key, window_seconds as i64).await;
                }
                return count <= i64::from(max_requests);
            }
        }

        check_rate_limit_in_memory(key, max_requests, window_seconds)
    }

    async fn log_rate_limit_event(
        &self,
        event_type: &'static str,
        reason: &'static str,
        ip_address: &str,
        client_install_id: Option<String>,
        platform: Option<String>,
        extension_version: Option<String>,
    ) {
        self.log_event(LicenseEventInput {
            license_id: None,
            lease_id: None,
            activation_code: None,
            event_type,
            status: "failed",
            reason: Some(reason.to_string()),
            ip_address: ip_address.to_string(),
            machine_hash: None,
            client_install_id,
            platform,
            extension_version,
            user_agent: None,
            expires_at: None,
        })
        .await;
    }

    pub async fn issue_device_challenge(
        &self,
        req: DeviceChallengeRequest,
        ip_address: &str,
    ) -> Result<DeviceChallengeResponse, crate::AppError> {
        if let Err(error) = self
            .ensure_business_rate_limit(
                &rate_limit_key("lease:challenge:ip", ip_address),
                RATE_LIMIT_CHALLENGE_IP_PER_MINUTE,
                SECONDS_PER_MINUTE,
            )
            .await
        {
            self.log_rate_limit_event(
                "challenge",
                "rate_limit_ip",
                ip_address,
                req.client_install_id.clone(),
                None,
                None,
            )
            .await;
            return Err(error);
        }
        if let Some(device_key_id) = req.device_key_id.as_deref() {
            if let Err(error) = self
                .ensure_business_rate_limit(
                    &rate_limit_key("lease:challenge:device", device_key_id),
                    RATE_LIMIT_CHALLENGE_DEVICE_PER_MINUTE,
                    SECONDS_PER_MINUTE,
                )
                .await
            {
                self.log_rate_limit_event(
                    "challenge",
                    "rate_limit_device",
                    ip_address,
                    req.client_install_id.clone(),
                    None,
                    None,
                )
                .await;
                return Err(error);
            }
        }

        let now = Utc::now();
        let challenge_id = Uuid::new_v4().to_string();
        let challenge = device_challenge_value(&challenge_id, req.device_key_id.as_deref());
        let key = device_challenge_key(&challenge_id);
        self.store_device_challenge(&key, &challenge).await?;

        Ok(DeviceChallengeResponse {
            challenge_id,
            challenge,
            expires_at: now + Duration::seconds(DEVICE_CHALLENGE_TTL_SECONDS as i64),
            server_time: now,
        })
    }

    pub async fn issue_permit(
        &self,
        req: IssuePermitRequest,
    ) -> Result<IssuePermitResponse, crate::AppError> {
        let now = Utc::now();
        let client_install_id =
            Self::request_install_id(req.client_install_id.clone(), req.machine_hash.clone())?;
        if let Err(error) = self
            .ensure_business_rate_limit(
                &rate_limit_key("lease:permit:device", &client_install_id),
                RATE_LIMIT_PERMIT_DEVICE_PER_MINUTE,
                SECONDS_PER_MINUTE,
            )
            .await
        {
            self.log_rate_limit_event(
                "permit",
                "rate_limit_device",
                "unknown",
                Some(client_install_id.clone()),
                None,
                None,
            )
            .await;
            return Err(error);
        }
        if req.operation != "start_distribution" || req.task_hash.trim().is_empty() {
            return Err(
                PubFlowError::SelectorProtocol("PERMIT_REQUEST_INVALID".to_string()).into(),
            );
        }

        self.jwt_service
            .verify_token_custom(&req.lease_token)
            .map_err(|_| crate::error::AuthError::InvalidToken)?;
        let mut lease_model = lease::Entity::find()
            .filter(lease::Column::LeaseToken.eq(&req.lease_token))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LeaseNotFound)?;
        if lease_model.is_revoked || lease_model.valid_until.with_timezone(&Utc) < now {
            return Err(PubFlowError::LeaseNotFound.into());
        }
        if Self::lease_install_id(&lease_model) != client_install_id {
            return Err(PubFlowError::DeviceNotBound.into());
        }

        let license_model = license::Entity::find()
            .filter(license::Column::Id.eq(lease_model.license_id))
            .filter(license::Column::DeletedAt.is_null())
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;
        if license_model.is_revoked {
            return Err(PubFlowError::LicenseRevoked.into());
        }
        if license_model
            .expires_at
            .is_some_and(|expires_at| expires_at.with_timezone(&Utc) < now)
        {
            return Err(PubFlowError::LicenseExpired.into());
        }

        let proof = req.device_proof.as_ref().ok_or_else(|| {
            PubFlowError::SelectorProtocol("DEVICE_CHALLENGE_REQUIRED".to_string())
        })?;
        if let Some(updated_lease) = self
            .ensure_device_proof_for_lease(&lease_model, Some(proof))
            .await?
        {
            lease_model = updated_lease;
        }
        let device_key_id = lease_model.device_key_id.clone().unwrap_or_default();
        let permit_id = Uuid::new_v4().to_string();
        let expires_at = now + Duration::seconds(PERMIT_TTL_SECONDS);
        let claims = PermitClaims {
            permit_id: permit_id.clone(),
            lease_id: lease_model.id.to_string(),
            license_id: lease_model.license_id.to_string(),
            client_install_id,
            device_key_id,
            operation: req.operation,
            task_hash: req.task_hash,
            key_version: self.jwt_service.active_key_version(),
        };
        let permit_token = self
            .jwt_service
            .generate_token_with_claims(&claims, PERMIT_TTL_SECONDS)
            .map_err(|_| PubFlowError::Internal("Failed to generate permit token".to_string()))?;

        self.log_event(LicenseEventInput::from_license(
            &license_model,
            Some(lease_model.id),
            "permit",
            "success",
            Some(&format!("{}:{}", claims.operation, permit_id)),
            "unknown",
            None,
            Some(claims.client_install_id),
            Some(lease_model.platform),
            Some(lease_model.min_extension_version),
        ))
        .await;

        Ok(IssuePermitResponse {
            permit_token,
            permit_id,
            expires_at,
            server_time: now,
        })
    }

    async fn store_device_challenge(
        &self,
        key: &str,
        challenge: &str,
    ) -> Result<(), crate::AppError> {
        if let Some(redis) = &self.redis
            && let Ok(mut conn) = redis.get().await
        {
            use deadpool_redis::redis::AsyncCommands;
            let _: () = conn
                .set_ex(key, challenge, DEVICE_CHALLENGE_TTL_SECONDS)
                .await
                .map_err(|error| PubFlowError::Internal(error.to_string()))?;
            return Ok(());
        }

        store_device_challenge_in_memory(key, challenge, DEVICE_CHALLENGE_TTL_SECONDS);
        Ok(())
    }

    async fn consume_device_challenge(&self, key: &str) -> Result<Option<String>, crate::AppError> {
        if let Some(redis) = &self.redis
            && let Ok(mut conn) = redis.get().await
        {
            let value: Option<String> = deadpool_redis::redis::cmd("GETDEL")
                .arg(key)
                .query_async(&mut conn)
                .await
                .map_err(|error| PubFlowError::Internal(error.to_string()))?;
            return Ok(value);
        }

        Ok(consume_device_challenge_in_memory(key))
    }

    async fn verify_device_proof(
        &self,
        proof: &DeviceProof,
        stored_public_key_spki: Option<&str>,
    ) -> Result<VerifiedDeviceProof, crate::AppError> {
        if proof
            .algorithm
            .as_deref()
            .is_some_and(|value| value != DEVICE_KEY_ALGORITHM)
        {
            tracing::warn!(
                code = "DEVICE_PROOF_INVALID",
                proof_device_key_id = %proof.device_key_id,
                challenge_id = %proof.challenge_id,
                algorithm = ?proof.algorithm,
                "device proof rejected: unsupported algorithm"
            );
            return Err(PubFlowError::SelectorProtocol("DEVICE_PROOF_INVALID".to_string()).into());
        }

        let challenge_key = device_challenge_key(&proof.challenge_id);
        let expected_challenge = self
            .consume_device_challenge(&challenge_key)
            .await?
            .ok_or_else(|| {
                tracing::warn!(
                    code = "DEVICE_CHALLENGE_EXPIRED",
                    proof_device_key_id = %proof.device_key_id,
                    challenge_id = %proof.challenge_id,
                    "device proof rejected: challenge expired or consumed"
                );
                PubFlowError::SelectorProtocol("DEVICE_CHALLENGE_EXPIRED".to_string())
            })?;
        if expected_challenge != proof.challenge {
            tracing::warn!(
                code = "DEVICE_PROOF_INVALID",
                proof_device_key_id = %proof.device_key_id,
                challenge_id = %proof.challenge_id,
                "device proof rejected: challenge mismatch"
            );
            return Err(PubFlowError::SelectorProtocol("DEVICE_PROOF_INVALID".to_string()).into());
        }

        let public_key_spki = stored_public_key_spki
            .map(ToOwned::to_owned)
            .or_else(|| proof.public_key_spki_base64_url.clone())
            .ok_or_else(|| {
                tracing::warn!(
                    code = "DEVICE_PUBLIC_KEY_REQUIRED",
                    proof_device_key_id = %proof.device_key_id,
                    challenge_id = %proof.challenge_id,
                    stored_public_key = stored_public_key_spki.is_some(),
                    "device proof rejected: public key missing"
                );
                PubFlowError::SelectorProtocol("DEVICE_PUBLIC_KEY_REQUIRED".to_string())
            })?;
        let public_key_bytes = decode_base64url(&public_key_spki)?;
        let device_key_id = device_key_id_from_public_key(&public_key_bytes);
        if proof.device_key_id != device_key_id {
            tracing::warn!(
                code = "DEVICE_PROOF_INVALID",
                proof_device_key_id = %proof.device_key_id,
                computed_device_key_id = %device_key_id,
                challenge_id = %proof.challenge_id,
                "device proof rejected: key id mismatch"
            );
            return Err(PubFlowError::SelectorProtocol("DEVICE_PROOF_INVALID".to_string()).into());
        }

        let verifying_key = VerifyingKey::from_public_key_der(&public_key_bytes).map_err(|_| {
            tracing::warn!(
                code = "DEVICE_PROOF_INVALID",
                proof_device_key_id = %proof.device_key_id,
                challenge_id = %proof.challenge_id,
                "device proof rejected: invalid public key DER"
            );
            PubFlowError::SelectorProtocol("DEVICE_PROOF_INVALID".to_string())
        })?;
        verify_device_signature(proof, &verifying_key)?;

        Ok(VerifiedDeviceProof {
            device_key_id,
            public_key_spki,
        })
    }

    async fn ensure_device_proof_for_lease(
        &self,
        lease_model: &lease::Model,
        proof: Option<&DeviceProof>,
    ) -> Result<Option<lease::Model>, crate::AppError> {
        let Some(proof) = proof else {
            if lease_model.device_public_key_spki.is_some() {
                tracing::warn!(
                    code = "DEVICE_CHALLENGE_REQUIRED",
                    lease_id = %lease_model.id,
                    license_id = %lease_model.license_id,
                    device_key_id = ?lease_model.device_key_id,
                    "device proof required for bound lease"
                );
                return Err(PubFlowError::SelectorProtocol(
                    "DEVICE_CHALLENGE_REQUIRED".to_string(),
                )
                .into());
            }
            if is_legacy_unbound_lease_in_compat_window(lease_model, Utc::now()) {
                return Ok(None);
            }
            tracing::warn!(
                code = "DEVICE_CHALLENGE_REQUIRED",
                lease_id = %lease_model.id,
                license_id = %lease_model.license_id,
                "device proof required for unbound lease after device-key rollout"
            );
            return Err(
                PubFlowError::SelectorProtocol("DEVICE_CHALLENGE_REQUIRED".to_string()).into(),
            );
        };

        let verified = self
            .verify_device_proof(proof, lease_model.device_public_key_spki.as_deref())
            .await?;
        if let Some(existing_key_id) = &lease_model.device_key_id
            && existing_key_id != &verified.device_key_id
        {
            tracing::warn!(
                code = "DEVICE_PROOF_INVALID",
                lease_id = %lease_model.id,
                license_id = %lease_model.license_id,
                expected_device_key_id = %existing_key_id,
                proof_device_key_id = %proof.device_key_id,
                "device proof rejected: lease device mismatch"
            );
            return Err(PubFlowError::SelectorProtocol("DEVICE_PROOF_INVALID".to_string()).into());
        }
        if lease_model.device_public_key_spki.is_some() {
            return Ok(None);
        }

        let mut active_lease: lease::ActiveModel = lease_model.clone().into();
        active_lease.device_key_id = Set(Some(verified.device_key_id));
        active_lease.device_public_key_spki = Set(Some(verified.public_key_spki));
        active_lease.device_key_algorithm = Set(Some(DEVICE_KEY_ALGORITHM.to_string()));
        active_lease.updated_at = Set(Utc::now().into());
        Ok(Some(active_lease.update(&self.db).await?))
    }

    pub async fn activate_protocol(
        &self,
        body: &[u8],
        ip_address: &str,
    ) -> Result<Vec<u8>, crate::AppError> {
        let decoded = decode_activation_request(body, &self.protocol_private_key, "pfap-v1")
            .map_err(|error| PubFlowError::SelectorProtocol(error.to_string()))?;
        self.validate_timestamp(decoded.timestamp_ms)?;

        let nonce_key = format!(
            "pfap:{}:{}",
            decoded.payload.client_install_id,
            client_nonce_hex(&decoded.client_nonce)
        );
        if !self.reserve_nonce(&nonce_key).await {
            return Err(PubFlowError::SelectorProtocol("PFAP_REPLAY".to_string()).into());
        }

        let response = self
            .activate(
                ActivateLeaseRequest {
                    activation_code: decoded.payload.activation_code.clone(),
                    client_install_id: Some(decoded.payload.client_install_id.clone()),
                    machine_hash: None,
                    platform: decoded.payload.platform.clone(),
                    extension_version: decoded.payload.extension_version.clone(),
                    device_proof: None,
                },
                ip_address,
            )
            .await?;
        let payload = ActivationProtocolResponsePayload {
            lease_token: response.lease_token,
            lease_type: response.lease_type,
            tier: response.tier,
            features: response.features,
            valid_from: response.valid_from.timestamp(),
            valid_until: response.license_expires_at.timestamp(),
            license_expires_at: Some(response.license_expires_at.timestamp()),
            server_time: response.server_time.timestamp(),
        };
        encode_activation_response(&payload, &decoded.response_key())
            .map_err(|error| PubFlowError::SelectorProtocol(error.to_string()).into())
    }

    /// 激活 lease（订阅模式）
    pub async fn activate(
        &self,
        req: ActivateLeaseRequest,
        ip_address: &str,
    ) -> Result<ActivateLeaseResponse, crate::AppError> {
        let now = Utc::now();
        let client_install_id =
            Self::request_install_id(req.client_install_id.clone(), req.machine_hash.clone())?;
        if let Err(error) = self
            .ensure_business_rate_limit(
                &rate_limit_key("lease:activate:ip", ip_address),
                RATE_LIMIT_ACTIVATE_IP_PER_MINUTE,
                SECONDS_PER_MINUTE,
            )
            .await
        {
            self.log_event(LicenseEventInput {
                license_id: None,
                lease_id: None,
                activation_code: Some(req.activation_code.clone()),
                event_type: "activate",
                status: "failed",
                reason: Some("rate_limit_ip".to_string()),
                ip_address: ip_address.to_string(),
                machine_hash: None,
                client_install_id: Some(client_install_id.clone()),
                platform: Some(req.platform.clone()),
                extension_version: req.extension_version.clone(),
                user_agent: None,
                expires_at: None,
            })
            .await;
            return Err(error);
        }
        if let Err(error) = self
            .ensure_business_rate_limit(
                &rate_limit_key("lease:activate:code", &req.activation_code),
                RATE_LIMIT_ACTIVATION_CODE_PER_HOUR,
                SECONDS_PER_HOUR,
            )
            .await
        {
            self.log_event(LicenseEventInput {
                license_id: None,
                lease_id: None,
                activation_code: Some(req.activation_code.clone()),
                event_type: "activate",
                status: "failed",
                reason: Some("rate_limit_activation_code".to_string()),
                ip_address: ip_address.to_string(),
                machine_hash: None,
                client_install_id: Some(client_install_id.clone()),
                platform: Some(req.platform.clone()),
                extension_version: req.extension_version.clone(),
                user_agent: None,
                expires_at: None,
            })
            .await;
            return Err(error);
        }

        // 1. 查找 license
        let mut license_model = match license::Entity::find()
            .filter(license::Column::ActivationCode.eq(&req.activation_code))
            .filter(license::Column::DeletedAt.is_null())
            .one(&self.db)
            .await?
        {
            Some(model) => model,
            None => {
                self.log_event(LicenseEventInput {
                    license_id: None,
                    lease_id: None,
                    activation_code: Some(req.activation_code.clone()),
                    event_type: "activate",
                    status: "failed",
                    reason: Some("license_not_found".to_string()),
                    ip_address: ip_address.to_string(),
                    machine_hash: None,
                    client_install_id: Some(client_install_id.clone()),
                    platform: Some(req.platform.clone()),
                    extension_version: req.extension_version.clone(),
                    user_agent: None,
                    expires_at: None,
                })
                .await;
                return Err(PubFlowError::LicenseNotFound.into());
            }
        };

        // 2. 检查 license 状态
        if license_model.is_revoked {
            self.log_event(LicenseEventInput::from_license(
                &license_model,
                None,
                "activate",
                "failed",
                Some("license_revoked"),
                ip_address,
                None,
                Some(client_install_id.clone()),
                Some(req.platform.clone()),
                req.extension_version.clone(),
            ))
            .await;
            return Err(PubFlowError::LicenseRevoked.into());
        }
        if license_model
            .expires_at
            .is_some_and(|expires_at| expires_at.with_timezone(&Utc) < now)
        {
            self.log_event(LicenseEventInput::from_license(
                &license_model,
                None,
                "activate",
                "failed",
                Some("license_expired"),
                ip_address,
                None,
                Some(client_install_id.clone()),
                Some(req.platform.clone()),
                req.extension_version.clone(),
            ))
            .await;
            return Err(PubFlowError::LicenseExpired.into());
        }

        // 3. 在事务中检查设备数限制并插入 lease，防止 TOCTOU 竞态
        let txn = self.db.begin().await?;
        if license_model.activated_at.is_none() || license_model.expires_at.is_none() {
            let expires_at = now + duration_for_plan(&license_model.plan)?;
            let mut active_license: license::ActiveModel = license_model.clone().into();
            active_license.activated_at = Set(Some(now.into()));
            active_license.expires_at = Set(Some(expires_at.into()));
            active_license.updated_at = Set(now.into());
            license_model = active_license.update(&txn).await?;
        }
        let license_expires_at = license_model
            .expires_at
            .map(|value| value.with_timezone(&Utc))
            .ok_or_else(|| {
                PubFlowError::Internal("license expires_at missing after activation".to_string())
            })?;

        let all_leases = lease::Entity::find()
            .filter(lease::Column::LicenseId.eq(license_model.id))
            .filter(lease::Column::IsRevoked.eq(false))
            .all(&txn)
            .await?;
        let unique_installs: HashSet<String> = all_leases
            .iter()
            .map(Self::lease_install_id)
            .map(ToOwned::to_owned)
            .collect();
        let mut migrated_install_id: Option<String> = None;
        let mut migrated_lease_count = 0u64;
        let mut same_install_reactivated_count = 0u64;
        let mut same_install_rebind_consumed_migration = false;
        let stored_key_for_activation_proof = req.device_proof.as_ref().and_then(|proof| {
            matching_same_install_public_key(&all_leases, &client_install_id, &proof.device_key_id)
        });
        let verified_device = match req.device_proof.as_ref() {
            Some(proof) => Some(
                self.verify_device_proof(proof, stored_key_for_activation_proof.as_deref())
                    .await?,
            ),
            None => None,
        };
        if !unique_installs.contains(&client_install_id)
            && unique_installs.len() as i32 >= license_model.max_devices
        {
            if license_model.device_migration_count >= license_model.device_migration_limit {
                txn.rollback().await?;
                self.log_event(LicenseEventInput::from_license(
                    &license_model,
                    None,
                    "activate",
                    "failed",
                    Some("device_limit_reached"),
                    ip_address,
                    None,
                    Some(client_install_id.clone()),
                    Some(req.platform.clone()),
                    req.extension_version.clone(),
                ))
                .await;
                self.log_device_migration_risk(
                    &license_model,
                    None,
                    "migration_limit_reached:auto",
                    ip_address,
                    Some(client_install_id.clone()),
                    Some(req.platform.clone()),
                    req.extension_version.clone(),
                )
                .await;
                return Err(PubFlowError::DeviceLimitReached.into());
            }

            let Some(install_to_revoke) = oldest_active_install_id(&all_leases, &client_install_id)
            else {
                txn.rollback().await?;
                return Err(PubFlowError::DeviceLimitReached.into());
            };
            let revoked = lease::Entity::update_many()
                .filter(lease::Column::LicenseId.eq(license_model.id))
                .filter(lease::Column::IsRevoked.eq(false))
                .filter(
                    Condition::any()
                        .add(lease::Column::ClientInstallId.eq(&install_to_revoke))
                        .add(lease::Column::MachineHash.eq(&install_to_revoke)),
                )
                .set(lease::ActiveModel {
                    is_revoked: Set(true),
                    updated_at: Set(now.into()),
                    ..Default::default()
                })
                .exec(&txn)
                .await?;
            if revoked.rows_affected == 0 {
                txn.rollback().await?;
                return Err(PubFlowError::DeviceLimitReached.into());
            }

            let mut active_license: license::ActiveModel = license_model.clone().into();
            active_license.device_migration_count =
                Set(license_model.device_migration_count.saturating_add(1));
            active_license.last_migrated_at = Set(Some(now.into()));
            active_license.updated_at = Set(now.into());
            license_model = active_license.update(&txn).await?;
            migrated_install_id = Some(install_to_revoke);
            migrated_lease_count = revoked.rows_affected;
        }
        if unique_installs.contains(&client_install_id) {
            let same_install_has_bound_key =
                active_install_has_bound_device_key(&all_leases, &client_install_id);
            let proved_existing_same_install_key = verified_device.as_ref().is_some_and(|device| {
                active_install_has_device_key(
                    &all_leases,
                    &client_install_id,
                    &device.device_key_id,
                )
            });
            if same_install_has_bound_key && !proved_existing_same_install_key {
                if license_model.device_migration_count >= license_model.device_migration_limit {
                    txn.rollback().await?;
                    self.log_event(LicenseEventInput::from_license(
                        &license_model,
                        None,
                        "activate",
                        "failed",
                        Some("same_install_device_key_rebind_limit_reached"),
                        ip_address,
                        None,
                        Some(client_install_id.clone()),
                        Some(req.platform.clone()),
                        req.extension_version.clone(),
                    ))
                    .await;
                    self.log_device_migration_risk(
                        &license_model,
                        None,
                        "migration_limit_reached:same_install_key_rebind",
                        ip_address,
                        Some(client_install_id.clone()),
                        Some(req.platform.clone()),
                        req.extension_version.clone(),
                    )
                    .await;
                    return Err(PubFlowError::DeviceLimitReached.into());
                }

                let mut active_license: license::ActiveModel = license_model.clone().into();
                active_license.device_migration_count =
                    Set(license_model.device_migration_count.saturating_add(1));
                active_license.last_migrated_at = Set(Some(now.into()));
                active_license.updated_at = Set(now.into());
                license_model = active_license.update(&txn).await?;
                same_install_rebind_consumed_migration = true;
            }

            let revoked = lease::Entity::update_many()
                .filter(lease::Column::LicenseId.eq(license_model.id))
                .filter(lease::Column::IsRevoked.eq(false))
                .filter(
                    Condition::any()
                        .add(lease::Column::ClientInstallId.eq(&client_install_id))
                        .add(lease::Column::MachineHash.eq(&client_install_id)),
                )
                .set(lease::ActiveModel {
                    is_revoked: Set(true),
                    updated_at: Set(now.into()),
                    ..Default::default()
                })
                .exec(&txn)
                .await?;
            same_install_reactivated_count = revoked.rows_affected;
        }

        // 4. 生成 lease
        let valid_from = now;
        let valid_until = compute_lease_valid_until(now, license_expires_at);
        let features = features_for_tier(&license_model.tier);
        let tier = license_model.tier.clone();
        let min_ext_version = req
            .extension_version
            .clone()
            .unwrap_or_else(|| "0.1.0".to_string());

        // 5. 生成 lease token（JWT 格式，包含所有 claims）
        let lease_claims = LeaseClaims {
            lease_id: Uuid::new_v4().to_string(),
            license_id: license_model.id.to_string(),
            client_install_id: client_install_id.clone(),
            machine_hash: None,
            lease_type: "subscription".to_string(),
            tier: tier.clone(),
            features: features.clone(),
            valid_from: valid_from.timestamp(),
            valid_until: valid_until.timestamp(),
            min_extension_version: min_ext_version.clone(),
            policy_version: 1,
            key_version: self.jwt_service.active_key_version(),
        };

        let lease_token = self
            .jwt_service
            .generate_token_with_claims(&lease_claims, (valid_until - now).num_seconds())
            .map_err(|_| PubFlowError::Internal("Failed to generate lease token".to_string()))?;

        // 6. 保存 lease 记录
        let new_lease = lease::ActiveModel {
            id: Set(Uuid::new_v4()),
            license_id: Set(license_model.id),
            lease_type: Set("subscription".to_string()),
            tier: Set(tier),
            features: Set(serde_json::to_string(&features).unwrap_or_else(|_| "[]".to_string())),
            lease_token: Set(lease_token.clone()),
            valid_from: Set(valid_from.into()),
            valid_until: Set(valid_until.into()),
            min_extension_version: Set(min_ext_version),
            policy_version: Set(1),
            is_revoked: Set(false),
            ip_address: Set(ip_address.to_string()),
            machine_hash: Set(LEGACY_MACHINE_HASH_PLACEHOLDER.to_string()),
            client_install_id: Set(Some(client_install_id.clone())),
            device_key_id: Set(verified_device
                .as_ref()
                .map(|device| device.device_key_id.clone())),
            device_public_key_spki: Set(verified_device
                .as_ref()
                .map(|device| device.public_key_spki.clone())),
            device_key_algorithm: Set(verified_device
                .as_ref()
                .map(|_| DEVICE_KEY_ALGORITHM.to_string())),
            platform: Set(req.platform.clone()),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&txn)
        .await?;

        txn.commit().await?;
        if let Some(revoked_install_id) = migrated_install_id {
            self.log_event(LicenseEventInput::from_license(
                &license_model,
                Some(new_lease.id),
                "device_migrate",
                "success",
                Some(&format!(
                    "auto_revoke_old_install:{revoked_install_id}:{migrated_lease_count}"
                )),
                ip_address,
                None,
                Some(client_install_id.clone()),
                Some(new_lease.platform.clone()),
                req.extension_version.clone(),
            ))
            .await;
            if should_flag_frequent_migration(
                license_model.device_migration_count,
                license_model.device_migration_limit,
            ) {
                self.log_device_migration_risk(
                    &license_model,
                    Some(new_lease.id),
                    &format!(
                        "frequent_device_migration:auto:revoked_install:{revoked_install_id}:count:{}:limit:{}",
                        license_model.device_migration_count,
                        license_model.device_migration_limit
                    ),
                    ip_address,
                    Some(client_install_id.clone()),
                    Some(new_lease.platform.clone()),
                    req.extension_version.clone(),
                )
                .await;
            }
        }
        if same_install_reactivated_count > 0 {
            self.log_event(LicenseEventInput::from_license(
                &license_model,
                Some(new_lease.id),
                "device_rebind",
                "success",
                Some(&format!(
                    "same_install_reactivation:{same_install_reactivated_count}:migration_consumed:{same_install_rebind_consumed_migration}"
                )),
                ip_address,
                None,
                Some(client_install_id.clone()),
                Some(new_lease.platform.clone()),
                req.extension_version.clone(),
            ))
            .await;
            if same_install_rebind_consumed_migration
                && should_flag_frequent_migration(
                    license_model.device_migration_count,
                    license_model.device_migration_limit,
                )
            {
                self.log_device_migration_risk(
                    &license_model,
                    Some(new_lease.id),
                    &format!(
                        "frequent_device_migration:same_install_key_rebind:count:{}:limit:{}",
                        license_model.device_migration_count, license_model.device_migration_limit
                    ),
                    ip_address,
                    Some(client_install_id.clone()),
                    Some(new_lease.platform.clone()),
                    req.extension_version.clone(),
                )
                .await;
            }
        }

        self.log_event(LicenseEventInput::from_license(
            &license_model,
            Some(new_lease.id),
            "activate",
            "success",
            None,
            ip_address,
            None,
            Some(client_install_id),
            Some(new_lease.platform.clone()),
            req.extension_version.clone(),
        ))
        .await;

        Ok(ActivateLeaseResponse {
            lease_token,
            lease_type: new_lease.lease_type,
            tier: new_lease.tier,
            features,
            valid_from,
            valid_until,
            license_expires_at,
            server_time: now,
        })
    }

    /// 验证 lease
    pub async fn verify(
        &self,
        req: VerifyLeaseRequest,
    ) -> Result<VerifyLeaseResponse, crate::AppError> {
        let now = Utc::now();
        let client_install_id =
            Self::request_install_id(req.client_install_id.clone(), req.machine_hash.clone())?;
        if let Err(error) = self
            .ensure_business_rate_limit(
                &rate_limit_key("lease:verify:lease", &req.lease_token),
                RATE_LIMIT_VERIFY_LEASE_PER_MINUTE,
                SECONDS_PER_MINUTE,
            )
            .await
        {
            self.log_rate_limit_event(
                "verify",
                "rate_limit_lease",
                "unknown",
                Some(client_install_id.clone()),
                None,
                None,
            )
            .await;
            return Err(error);
        }

        // 1. 验证 lease token 有效性（JWT 验签 + 过期检查）
        let _claims = self
            .jwt_service
            .verify_token_custom(&req.lease_token)
            .map_err(|_| crate::error::AuthError::InvalidToken)?;

        // 2. 从数据库查询 lease 记录
        let mut lease_model = lease::Entity::find()
            .filter(lease::Column::LeaseToken.eq(&req.lease_token))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LeaseNotFound)?;

        // 3. 检查 lease 状态
        if lease_model.is_revoked {
            let event_lease = lease_model.clone();
            let response = VerifyLeaseResponse {
                valid: false,
                status: "revoked".to_string(),
                lease_type: lease_model.lease_type,
                tier: lease_model.tier,
                features: serde_json::from_str(&lease_model.features).unwrap_or_default(),
                valid_until: lease_model.valid_until.with_timezone(&Utc),
                license_expires_at: None,
                server_time: now,
                expires_in_seconds: 0,
            };
            self.log_event_for_lease(
                "verify",
                "failed",
                &client_install_id,
                Some("lease_revoked"),
                &event_lease,
            )
            .await;
            return Ok(response);
        }

        // 4. 检查安装实例匹配
        if Self::lease_install_id(&lease_model) != client_install_id {
            let event_lease = lease_model.clone();
            let response = VerifyLeaseResponse {
                valid: false,
                status: "device_mismatch".to_string(),
                lease_type: lease_model.lease_type,
                tier: lease_model.tier,
                features: serde_json::from_str(&lease_model.features).unwrap_or_default(),
                valid_until: lease_model.valid_until.with_timezone(&Utc),
                license_expires_at: None,
                server_time: now,
                expires_in_seconds: 0,
            };
            self.log_event_for_lease(
                "verify",
                "failed",
                &client_install_id,
                Some("device_mismatch"),
                &event_lease,
            )
            .await;
            return Ok(response);
        }

        // 5. 检查过期
        let valid_until = lease_model.valid_until.with_timezone(&Utc);
        if valid_until < now {
            let event_lease = lease_model.clone();
            let response = VerifyLeaseResponse {
                valid: false,
                status: "expired".to_string(),
                lease_type: lease_model.lease_type,
                tier: lease_model.tier,
                features: serde_json::from_str(&lease_model.features).unwrap_or_default(),
                valid_until,
                license_expires_at: None,
                server_time: now,
                expires_in_seconds: 0,
            };
            self.log_event_for_lease(
                "verify",
                "failed",
                &client_install_id,
                Some("lease_expired"),
                &event_lease,
            )
            .await;
            return Ok(response);
        }

        let Some(license_model) = license::Entity::find()
            .filter(license::Column::Id.eq(lease_model.license_id))
            .filter(license::Column::DeletedAt.is_null())
            .one(&self.db)
            .await?
        else {
            let event_lease = lease_model.clone();
            let response = VerifyLeaseResponse {
                valid: false,
                status: "revoked".to_string(),
                lease_type: lease_model.lease_type,
                tier: lease_model.tier,
                features: serde_json::from_str(&lease_model.features).unwrap_or_default(),
                valid_until,
                license_expires_at: None,
                server_time: now,
                expires_in_seconds: 0,
            };
            self.log_event_for_lease(
                "verify",
                "failed",
                &client_install_id,
                Some("license_not_found"),
                &event_lease,
            )
            .await;
            return Ok(response);
        };
        if license_model.is_revoked {
            let event_lease = lease_model.clone();
            let response = VerifyLeaseResponse {
                valid: false,
                status: "revoked".to_string(),
                lease_type: lease_model.lease_type,
                tier: lease_model.tier,
                features: serde_json::from_str(&lease_model.features).unwrap_or_default(),
                valid_until,
                license_expires_at: license_expires_at_utc(&license_model),
                server_time: now,
                expires_in_seconds: 0,
            };
            self.log_event_for_lease(
                "verify",
                "failed",
                &client_install_id,
                Some("license_revoked"),
                &event_lease,
            )
            .await;
            return Ok(response);
        }
        if license_model
            .expires_at
            .is_some_and(|expires_at| expires_at.with_timezone(&Utc) < now)
        {
            let event_lease = lease_model.clone();
            let response = VerifyLeaseResponse {
                valid: false,
                status: "expired".to_string(),
                lease_type: lease_model.lease_type,
                tier: lease_model.tier,
                features: serde_json::from_str(&lease_model.features).unwrap_or_default(),
                valid_until,
                license_expires_at: license_expires_at_utc(&license_model),
                server_time: now,
                expires_in_seconds: 0,
            };
            self.log_event_for_lease(
                "verify",
                "failed",
                &client_install_id,
                Some("license_expired"),
                &event_lease,
            )
            .await;
            return Ok(response);
        }

        if let Some(updated_lease) = self
            .ensure_device_proof_for_lease(&lease_model, req.device_proof.as_ref())
            .await?
        {
            lease_model = updated_lease;
        }

        // 6. 更新 lease 的更新时间
        let features: Vec<String> = serde_json::from_str(&lease_model.features).unwrap_or_default();
        let lease_type = lease_model.lease_type.clone();
        let tier = lease_model.tier.clone();
        let mut active_lease: lease::ActiveModel = lease_model.into();
        active_lease.updated_at = Set(now.into());
        let updated_lease = active_lease.update(&self.db).await?;

        let expires_in_seconds = (valid_until - now).num_seconds();

        let response = VerifyLeaseResponse {
            valid: true,
            status: "active".to_string(),
            lease_type,
            tier,
            features,
            valid_until,
            license_expires_at: license_expires_at_utc(&license_model),
            server_time: now,
            expires_in_seconds,
        };
        self.log_event_for_lease(
            "verify",
            "success",
            &client_install_id,
            None,
            &updated_lease,
        )
        .await;
        Ok(response)
    }

    /// 续租 lease
    pub async fn renew(
        &self,
        req: RenewLeaseRequest,
    ) -> Result<RenewLeaseResponse, crate::AppError> {
        let now = Utc::now();
        let client_install_id =
            Self::request_install_id(req.client_install_id.clone(), req.machine_hash.clone())?;
        if let Err(error) = self
            .ensure_business_rate_limit(
                &rate_limit_key("lease:renew:device", &client_install_id),
                RATE_LIMIT_RENEW_DEVICE_PER_HOUR,
                SECONDS_PER_HOUR,
            )
            .await
        {
            self.log_rate_limit_event(
                "renew",
                "rate_limit_device",
                "unknown",
                Some(client_install_id.clone()),
                None,
                None,
            )
            .await;
            return Err(error);
        }

        // 1. 查找当前 lease
        let mut lease_model = lease::Entity::find()
            .filter(lease::Column::LeaseToken.eq(&req.lease_token))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LeaseNotFound)?;

        // 2. 检查是否在续租宽限期内
        let valid_until = lease_model.valid_until.with_timezone(&Utc);
        let grace_deadline = valid_until + Duration::days(RENEWAL_GRACE_DAYS);

        if now > grace_deadline {
            return Err(PubFlowError::InvalidOrderState.into());
        }

        // 3. 检查安装实例匹配
        if Self::lease_install_id(&lease_model) != client_install_id {
            return Err(PubFlowError::DeviceNotBound.into());
        }

        // 4. 检查 license 是否仍然有效
        let license_model = license::Entity::find()
            .filter(license::Column::Id.eq(lease_model.license_id))
            .filter(license::Column::DeletedAt.is_null())
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;

        if license_model.is_revoked {
            return Err(PubFlowError::LicenseRevoked.into());
        }
        let Some(license_expires_at) = license_model
            .expires_at
            .map(|value| value.with_timezone(&Utc))
        else {
            return Err(PubFlowError::LicenseExpired.into());
        };
        if license_expires_at < now {
            return Err(PubFlowError::LicenseExpired.into());
        }

        if let Some(updated_lease) = self
            .ensure_device_proof_for_lease(&lease_model, req.device_proof.as_ref())
            .await?
        {
            lease_model = updated_lease;
        }

        // 5. 生成新的 lease
        let new_valid_from = now;
        let new_valid_until = compute_lease_valid_until(now, license_expires_at);
        let features: Vec<String> = serde_json::from_str(&lease_model.features).unwrap_or_default();

        let lease_claims = LeaseClaims {
            lease_id: lease_model.id.to_string(),
            license_id: lease_model.license_id.to_string(),
            client_install_id: client_install_id.clone(),
            machine_hash: None,
            lease_type: lease_model.lease_type.clone(),
            tier: lease_model.tier.clone(),
            features: features.clone(),
            valid_from: new_valid_from.timestamp(),
            valid_until: new_valid_until.timestamp(),
            min_extension_version: lease_model.min_extension_version.clone(),
            policy_version: lease_model.policy_version,
            key_version: self.jwt_service.active_key_version(),
        };

        let new_lease_token = self
            .jwt_service
            .generate_token_with_claims(&lease_claims, (new_valid_until - now).num_seconds())
            .map_err(|_| PubFlowError::Internal("Failed to generate lease token".to_string()))?;

        // 6. 更新 lease 记录
        let mut active_lease: lease::ActiveModel = lease_model.into();
        active_lease.lease_token = Set(new_lease_token.clone());
        active_lease.valid_from = Set(new_valid_from.into());
        active_lease.valid_until = Set(new_valid_until.into());
        active_lease.updated_at = Set(now.into());
        let updated = active_lease.update(&self.db).await?;
        self.log_event(LicenseEventInput::from_license(
            &license_model,
            Some(updated.id),
            "renew",
            "success",
            None,
            "unknown",
            None,
            Some(client_install_id),
            Some(updated.platform.clone()),
            Some(updated.min_extension_version.clone()),
        ))
        .await;

        Ok(RenewLeaseResponse {
            lease_token: new_lease_token,
            valid_until: new_valid_until,
            license_expires_at,
            server_time: now,
        })
    }

    /// 解绑设备
    pub async fn deactivate(
        &self,
        req: DeactivateLeaseRequest,
    ) -> Result<DeactivateLeaseResponse, crate::AppError> {
        let now = Utc::now();
        let client_install_id =
            Self::request_install_id(req.client_install_id.clone(), req.machine_hash.clone())?;

        // 1. 查找 license
        let license_model = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(&req.activation_code))
            .filter(license::Column::DeletedAt.is_null())
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;

        // 2. 批量吊销该安装实例关联的所有 lease（单条 UPDATE 语句）
        let result = lease::Entity::update_many()
            .filter(lease::Column::LicenseId.eq(license_model.id))
            .filter(lease::Column::ClientInstallId.eq(&client_install_id))
            .filter(lease::Column::IsRevoked.eq(false))
            .set(lease::ActiveModel {
                is_revoked: Set(true),
                updated_at: Set(now.into()),
                ..Default::default()
            })
            .exec(&self.db)
            .await?;
        self.log_event(LicenseEventInput::from_license(
            &license_model,
            None,
            "deactivate",
            "success",
            Some(&format!("revoked_{}_leases", result.rows_affected)),
            "unknown",
            None,
            Some(client_install_id),
            None,
            None,
        ))
        .await;

        Ok(DeactivateLeaseResponse { deactivated: true })
    }

    /// 管理员查询 lease 记录
    pub async fn admin_list_leases(
        &self,
        from: Option<String>,
        to: Option<String>,
    ) -> Result<Vec<super::dto::AdminLeaseItem>, crate::AppError> {
        self.cleanup_old_events().await;
        let mut query =
            license_event::Entity::find().order_by_desc(license_event::Column::CreatedAt);

        if let Some(from_str) = &from {
            if let Some(dt) = parse_date_start(from_str) {
                query = query.filter(license_event::Column::CreatedAt.gte(dt));
            }
        }
        if let Some(to_str) = &to {
            if let Some(dt) = parse_date_end(to_str) {
                query = query.filter(license_event::Column::CreatedAt.lte(dt));
            }
        }

        let events = query.all(&self.db).await?;

        let mut items = Vec::new();
        for event in events {
            items.push(super::dto::AdminLeaseItem {
                id: event.id.to_string(),
                activation_code: event.activation_code.unwrap_or_default(),
                client_install_id: event
                    .client_install_id
                    .clone()
                    .or_else(|| event.machine_hash.clone())
                    .unwrap_or_default(),
                machine_hash: event.machine_hash.unwrap_or_default(),
                platform: event.platform.unwrap_or_default(),
                ip_address: event.ip_address,
                event_type: event.event_type,
                status: event.status,
                reason: event.reason,
                operator: event.operator,
                target_id: event.target_id,
                expires_at: event.expires_at.map(|value| value.to_rfc3339()),
                created_at: event.created_at.to_rfc3339(),
            });
        }

        Ok(items)
    }

    /// 管理员查询 DAU 统计
    pub async fn admin_dau_stats(
        &self,
        from: Option<String>,
        to: Option<String>,
    ) -> Result<Vec<super::dto::DauStat>, crate::AppError> {
        let from_date = from
            .and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok())
            .unwrap_or_else(|| (Utc::now() - Duration::days(30)).date_naive());
        let to_date = to
            .and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok())
            .unwrap_or_else(|| Utc::now().date_naive());

        let from_dt = from_date
            .and_hms_opt(0, 0, 0)
            .expect("midnight is always valid")
            .and_utc();
        let to_dt = to_date
            .and_hms_opt(23, 59, 59)
            .expect("23:59:59 is always valid")
            .and_utc();

        // 查询时间范围内的授权事件
        let events = license_event::Entity::find()
            .filter(license_event::Column::CreatedAt.gte(from_dt))
            .filter(license_event::Column::CreatedAt.lte(to_dt))
            .order_by_asc(license_event::Column::CreatedAt)
            .all(&self.db)
            .await?;

        // 按日期聚合
        let mut stats: std::collections::BTreeMap<
            String,
            (i64, std::collections::HashSet<String>),
        > = std::collections::BTreeMap::new();

        for event in &events {
            let date_str = event.created_at.format("%Y-%m-%d").to_string();
            let entry = stats
                .entry(date_str)
                .or_insert((0, std::collections::HashSet::new()));
            if event.event_type == "activate" && event.status == "success" {
                entry.0 += 1;
            }
            if let Some(client_install_id) = event
                .client_install_id
                .as_ref()
                .or(event.machine_hash.as_ref())
                && matches!(
                    event.event_type.as_str(),
                    "activate"
                        | "verify"
                        | "renew"
                        | "selector_fetch"
                        | "device_migrate"
                        | "device_rebind"
                        | "permit"
                )
            {
                entry.1.insert(client_install_id.clone());
            }
        }

        // 填充缺失日期
        let mut result = Vec::new();
        let mut current = from_date;
        while current <= to_date {
            let date_str = current.format("%Y-%m-%d").to_string();
            let (activations, devices) = stats
                .get(&date_str)
                .cloned()
                .unwrap_or((0, std::collections::HashSet::new()));
            result.push(super::dto::DauStat {
                date: date_str,
                activations,
                verifications: devices.len() as i64,
            });
            current += Duration::days(1);
        }

        Ok(result)
    }

    async fn log_event_for_lease(
        &self,
        event_type: &'static str,
        status: &'static str,
        client_install_id: &str,
        reason: Option<&str>,
        lease_model: &lease::Model,
    ) {
        let license_model = license::Entity::find_by_id(lease_model.license_id)
            .one(&self.db)
            .await
            .ok()
            .flatten();
        let Some(license_model) = license_model else {
            return;
        };
        self.log_event(LicenseEventInput::from_license(
            &license_model,
            Some(lease_model.id),
            event_type,
            status,
            reason,
            &lease_model.ip_address,
            None,
            Some(client_install_id.to_string()),
            Some(lease_model.platform.clone()),
            Some(lease_model.min_extension_version.clone()),
        ))
        .await;
    }

    async fn log_device_migration_risk(
        &self,
        license_model: &license::Model,
        lease_id: Option<Uuid>,
        reason: &str,
        ip_address: &str,
        client_install_id: Option<String>,
        platform: Option<String>,
        extension_version: Option<String>,
    ) {
        self.log_event(LicenseEventInput::from_license(
            license_model,
            lease_id,
            "risk_flag",
            "warning",
            Some(reason),
            ip_address,
            None,
            client_install_id,
            platform,
            extension_version,
        ))
        .await;
    }

    async fn log_event(&self, input: LicenseEventInput) {
        if let Err(error) = (license_event::ActiveModel {
            id: Set(Uuid::new_v4()),
            license_id: Set(input.license_id),
            lease_id: Set(input.lease_id),
            activation_code: Set(input.activation_code),
            event_type: Set(input.event_type.to_string()),
            status: Set(input.status.to_string()),
            reason: Set(input.reason),
            ip_address: Set(input.ip_address),
            machine_hash: Set(input.machine_hash),
            client_install_id: Set(input.client_install_id),
            platform: Set(input.platform),
            extension_version: Set(input.extension_version),
            user_agent: Set(input.user_agent),
            operator: Set(None),
            target_id: Set(None),
            expires_at: Set(input.expires_at),
            created_at: Set(Utc::now().into()),
        })
        .insert(&self.db)
        .await
        {
            tracing::warn!(?error, "failed to write license event");
        }
    }

    async fn cleanup_old_events(&self) {
        let cutoff = Utc::now() - Duration::days(LICENSE_EVENT_RETENTION_DAYS);
        if let Err(error) = license_event::Entity::delete_many()
            .filter(license_event::Column::CreatedAt.lt(cutoff))
            .exec(&self.db)
            .await
        {
            tracing::warn!(?error, "failed to cleanup old license events");
        }
    }
}

struct LicenseEventInput {
    license_id: Option<Uuid>,
    lease_id: Option<Uuid>,
    activation_code: Option<String>,
    event_type: &'static str,
    status: &'static str,
    reason: Option<String>,
    ip_address: String,
    machine_hash: Option<String>,
    client_install_id: Option<String>,
    platform: Option<String>,
    extension_version: Option<String>,
    user_agent: Option<String>,
    expires_at: Option<chrono::DateTime<chrono::FixedOffset>>,
}

impl LicenseEventInput {
    fn from_license(
        license_model: &license::Model,
        lease_id: Option<Uuid>,
        event_type: &'static str,
        status: &'static str,
        reason: Option<&str>,
        ip_address: &str,
        machine_hash: Option<String>,
        client_install_id: Option<String>,
        platform: Option<String>,
        extension_version: Option<String>,
    ) -> Self {
        Self {
            license_id: Some(license_model.id),
            lease_id,
            activation_code: Some(license_model.activation_code.clone()),
            event_type,
            status,
            reason: reason.map(ToOwned::to_owned),
            ip_address: ip_address.to_string(),
            machine_hash,
            client_install_id,
            platform,
            extension_version,
            user_agent: None,
            expires_at: license_model.expires_at,
        }
    }
}

/// Lease JWT Claims
#[derive(Debug, Clone, Serialize, Deserialize)]
struct LeaseClaims {
    pub lease_id: String,
    pub license_id: String,
    pub client_install_id: String,
    pub machine_hash: Option<String>,
    pub lease_type: String,
    pub tier: String,
    pub features: Vec<String>,
    pub valid_from: i64,
    pub valid_until: i64,
    pub min_extension_version: String,
    pub policy_version: i32,
    pub key_version: i32,
}

/// 短期关键操作票据 Claims。
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PermitClaims {
    pub permit_id: String,
    pub lease_id: String,
    pub license_id: String,
    pub client_install_id: String,
    pub device_key_id: String,
    pub operation: String,
    pub task_hash: String,
    pub key_version: i32,
}

struct VerifiedDeviceProof {
    device_key_id: String,
    public_key_spki: String,
}

fn device_challenge_key(challenge_id: &str) -> String {
    format!("device-challenge:{challenge_id}")
}

fn device_challenge_value(challenge_id: &str, device_key_id: Option<&str>) -> String {
    let random_bytes: [u8; 32] = rand::random();
    format!(
        "pubflow-device-v1:{}:{}:{}",
        challenge_id,
        device_key_id.unwrap_or("new-device"),
        URL_SAFE_NO_PAD.encode(random_bytes)
    )
}

fn decode_base64url(value: &str) -> Result<Vec<u8>, crate::AppError> {
    URL_SAFE_NO_PAD
        .decode(value.trim())
        .map_err(|_| PubFlowError::SelectorProtocol("DEVICE_PROOF_INVALID".to_string()).into())
}

fn device_key_id_from_public_key(public_key_spki: &[u8]) -> String {
    let digest = Sha256::digest(public_key_spki);
    format!("p256:{}", URL_SAFE_NO_PAD.encode(digest))
}

fn verify_device_signature(
    proof: &DeviceProof,
    verifying_key: &VerifyingKey,
) -> Result<(), crate::AppError> {
    let signature_bytes = decode_base64url(&proof.signature_base64_url)?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| {
        tracing::warn!(
            code = "DEVICE_PROOF_INVALID",
            proof_device_key_id = %proof.device_key_id,
            challenge_id = %proof.challenge_id,
            "device proof rejected: invalid signature encoding"
        );
        PubFlowError::SelectorProtocol("DEVICE_PROOF_INVALID".to_string())
    })?;
    verifying_key
        .verify(proof.challenge.as_bytes(), &signature)
        .map_err(|_| {
            tracing::warn!(
                code = "DEVICE_PROOF_INVALID",
                proof_device_key_id = %proof.device_key_id,
                challenge_id = %proof.challenge_id,
                "device proof rejected: signature verification failed"
            );
            PubFlowError::SelectorProtocol("DEVICE_PROOF_INVALID".to_string()).into()
        })
}

fn rate_limit_key(namespace: &str, value: &str) -> String {
    let digest = Sha256::digest(value.trim().as_bytes());
    format!("{namespace}:{}", URL_SAFE_NO_PAD.encode(digest))
}

fn should_flag_frequent_migration(count: i32, limit: i32) -> bool {
    count >= 2 || count >= limit
}

fn oldest_active_install_id(
    leases: &[lease::Model],
    new_client_install_id: &str,
) -> Option<String> {
    let mut oldest_by_install: HashMap<String, chrono::DateTime<chrono::FixedOffset>> =
        HashMap::new();
    for lease_model in leases {
        let install_id = LeaseService::lease_install_id(lease_model);
        if install_id == new_client_install_id {
            continue;
        }
        let created_at = lease_model.created_at;
        oldest_by_install
            .entry(install_id.to_string())
            .and_modify(|current| {
                if created_at < *current {
                    *current = created_at;
                }
            })
            .or_insert(created_at);
    }
    oldest_by_install
        .into_iter()
        .min_by_key(|(_, created_at)| *created_at)
        .map(|(install_id, _)| install_id)
}

fn matching_same_install_public_key(
    leases: &[lease::Model],
    client_install_id: &str,
    device_key_id: &str,
) -> Option<String> {
    leases
        .iter()
        .find(|lease_model| {
            LeaseService::lease_install_id(lease_model) == client_install_id
                && lease_model.device_key_id.as_deref() == Some(device_key_id)
        })
        .and_then(|lease_model| lease_model.device_public_key_spki.clone())
}

fn active_install_has_bound_device_key(leases: &[lease::Model], client_install_id: &str) -> bool {
    leases.iter().any(|lease_model| {
        LeaseService::lease_install_id(lease_model) == client_install_id
            && lease_model
                .device_public_key_spki
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
    })
}

fn active_install_has_device_key(
    leases: &[lease::Model],
    client_install_id: &str,
    device_key_id: &str,
) -> bool {
    leases.iter().any(|lease_model| {
        LeaseService::lease_install_id(lease_model) == client_install_id
            && lease_model.device_key_id.as_deref() == Some(device_key_id)
    })
}

fn is_legacy_unbound_lease_in_compat_window(
    lease_model: &lease::Model,
    now: chrono::DateTime<Utc>,
) -> bool {
    let rollout_at = device_key_rollout_at();
    lease_model.created_at.with_timezone(&Utc) < rollout_at
        && now < rollout_at + Duration::days(LEGACY_UNBOUND_DEVICE_PROOF_COMPAT_DAYS)
}

fn device_key_rollout_at() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(
        DEVICE_KEY_ROLLOUT_YEAR,
        DEVICE_KEY_ROLLOUT_MONTH,
        DEVICE_KEY_ROLLOUT_DAY,
        0,
        0,
        0,
    )
    .single()
    .expect("valid device key rollout date")
}

#[cfg(test)]
mod tests {
    use super::*;
    use entity::license_batch;
    use p256::ecdsa::{SigningKey, signature::Signer};
    use p256::pkcs8::EncodePublicKey;
    use sea_orm::{ConnectionTrait, Database, DatabaseBackend, Schema};

    #[test]
    fn subscription_lease_is_capped_to_31_days() {
        let now = Utc::now();
        let license_expires_at = now + Duration::days(365);

        let valid_until = compute_lease_valid_until(now, license_expires_at);

        assert_eq!(
            valid_until,
            now + Duration::days(MAX_SUBSCRIPTION_LEASE_DAYS)
        );
    }

    #[test]
    fn subscription_lease_never_exceeds_license_expiry() {
        let now = Utc::now();
        let license_expires_at = now + Duration::days(9);

        let valid_until = compute_lease_valid_until(now, license_expires_at);

        assert_eq!(valid_until, license_expires_at);
    }

    #[test]
    fn business_rate_limit_blocks_after_threshold() {
        let key = format!("test:{}", Uuid::new_v4());

        assert!(check_rate_limit_in_memory(&key, 2, 60));
        assert!(check_rate_limit_in_memory(&key, 2, 60));
        assert!(!check_rate_limit_in_memory(&key, 2, 60));
    }

    #[test]
    fn rate_limit_key_hashes_sensitive_values() {
        let raw_value = "PF-SECRET-ACTIVATION-CODE";
        let key = rate_limit_key("lease:activate:code", raw_value);

        assert!(key.starts_with("lease:activate:code:"));
        assert!(!key.contains(raw_value));
    }

    #[test]
    fn unbound_legacy_lease_allows_short_compat_window_only() {
        let rollout_at = device_key_rollout_at();
        let legacy = lease_model_with_created_at(rollout_at - Duration::days(1));
        let new_unbound = lease_model_with_created_at(rollout_at + Duration::minutes(1));

        assert!(is_legacy_unbound_lease_in_compat_window(
            &legacy,
            rollout_at + Duration::days(1),
        ));
        assert!(!is_legacy_unbound_lease_in_compat_window(
            &legacy,
            rollout_at + Duration::days(LEGACY_UNBOUND_DEVICE_PROOF_COMPAT_DAYS + 1),
        ));
        assert!(!is_legacy_unbound_lease_in_compat_window(
            &new_unbound,
            rollout_at + Duration::days(1),
        ));
    }

    #[test]
    fn same_install_key_helpers_only_match_bound_key_for_install() {
        let mut bound = lease_model_with_created_at(Utc::now());
        bound.client_install_id = Some("install:one".to_string());
        bound.device_key_id = Some("p256:key-one".to_string());
        bound.device_public_key_spki = Some("spki-one".to_string());
        let mut other_install = lease_model_with_created_at(Utc::now());
        other_install.client_install_id = Some("install:two".to_string());
        other_install.device_key_id = Some("p256:key-two".to_string());
        other_install.device_public_key_spki = Some("spki-two".to_string());
        let leases = vec![bound, other_install];

        assert!(active_install_has_bound_device_key(&leases, "install:one"));
        assert!(active_install_has_device_key(
            &leases,
            "install:one",
            "p256:key-one"
        ));
        assert_eq!(
            matching_same_install_public_key(&leases, "install:one", "p256:key-one").as_deref(),
            Some("spki-one")
        );
        assert_eq!(
            matching_same_install_public_key(&leases, "install:one", "p256:key-two"),
            None
        );
    }

    #[test]
    fn device_challenge_memory_store_consumes_once() {
        let key = format!("device-challenge:test:{}", Uuid::new_v4());
        store_device_challenge_in_memory(&key, "challenge-payload", 60);

        assert_eq!(
            consume_device_challenge_in_memory(&key).as_deref(),
            Some("challenge-payload")
        );
        assert_eq!(consume_device_challenge_in_memory(&key), None);
    }

    #[test]
    fn pfap_nonce_memory_reservation_rejects_replay() {
        let key = format!("pfap:test:{}", Uuid::new_v4());

        assert!(reserve_pfap_nonce_in_memory(&key, 60));
        assert!(!reserve_pfap_nonce_in_memory(&key, 60));
    }

    #[test]
    fn permit_ttl_is_thirty_minutes() {
        assert_eq!(PERMIT_TTL_SECONDS, 30 * 60);
    }

    #[test]
    fn p256_device_signature_verifies_and_rejects_tampering() {
        let signing_key = SigningKey::from_slice(&[7u8; 32]).expect("valid test signing key");
        let verifying_key = signing_key.verifying_key();
        let public_key_spki = verifying_key
            .to_public_key_der()
            .expect("spki der")
            .as_bytes()
            .to_vec();
        let challenge = "pubflow-device-v1:test-challenge:p256:test-key:nonce";
        let signature: Signature = signing_key.sign(challenge.as_bytes());
        let proof = DeviceProof {
            device_key_id: device_key_id_from_public_key(&public_key_spki),
            public_key_spki_base64_url: Some(URL_SAFE_NO_PAD.encode(&public_key_spki)),
            challenge_id: "test-challenge".to_string(),
            challenge: challenge.to_string(),
            signature_base64_url: URL_SAFE_NO_PAD.encode(signature.to_bytes()),
            algorithm: Some(DEVICE_KEY_ALGORITHM.to_string()),
            signature_format: Some("webcrypto-p1363".to_string()),
        };

        assert!(verify_device_signature(&proof, verifying_key).is_ok());

        let mut tampered = proof;
        tampered.challenge = "tampered-challenge".to_string();
        assert!(verify_device_signature(&tampered, verifying_key).is_err());
    }

    #[tokio::test]
    async fn lease_online_control_flow_covers_activate_verify_renew_and_permit() {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("sqlite memory db");
        create_test_schema(&db).await;
        let now = Utc::now();
        let activation_code = format!("PF-TEST-{}", Uuid::new_v4());

        license::ActiveModel {
            id: Set(Uuid::new_v4()),
            user_id: Set(None),
            activation_code: Set(activation_code.clone()),
            tier: Set("pro".to_string()),
            plan: Set("monthly".to_string()),
            source_channel: Set("test".to_string()),
            batch_id: Set(None),
            max_devices: Set(1),
            device_migration_limit: Set(3),
            device_migration_count: Set(0),
            last_migrated_at: Set(None),
            activated_at: Set(None),
            expires_at: Set(None),
            is_revoked: Set(false),
            deleted_at: Set(None),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&db)
        .await
        .expect("insert license");

        let service = LeaseService {
            db,
            jwt_service: crate::shared::jwt::JwtService::new("test-jwt-secret".to_string()),
            redis: None,
            protocol_private_key: "00".repeat(32),
            replay_window_seconds: 300,
            nonce_ttl_seconds: 300,
        };
        let signing_key = SigningKey::from_slice(&[9u8; 32]).expect("valid signing key");
        let public_key_spki = signing_key
            .verifying_key()
            .to_public_key_der()
            .expect("spki der")
            .as_bytes()
            .to_vec();
        let device_key_id = device_key_id_from_public_key(&public_key_spki);
        let client_install_id = "install-integration-1".to_string();

        let activate_proof = issue_test_device_proof(
            &service,
            &signing_key,
            &public_key_spki,
            &device_key_id,
            &client_install_id,
            None,
        )
        .await;
        let activated = service
            .activate(
                ActivateLeaseRequest {
                    activation_code: activation_code.clone(),
                    client_install_id: Some(client_install_id.clone()),
                    machine_hash: None,
                    platform: "macos".to_string(),
                    extension_version: Some("0.1.0".to_string()),
                    device_proof: Some(activate_proof),
                },
                "127.0.0.1",
            )
            .await
            .expect("activate lease");
        assert!(activated.valid_until <= activated.server_time + Duration::days(31));
        assert_eq!(activated.license_expires_at, activated.valid_until);

        let verify_proof = issue_test_device_proof(
            &service,
            &signing_key,
            &public_key_spki,
            &device_key_id,
            &client_install_id,
            Some(activated.lease_token.clone()),
        )
        .await;
        let verified = service
            .verify(VerifyLeaseRequest {
                lease_token: activated.lease_token.clone(),
                client_install_id: Some(client_install_id.clone()),
                machine_hash: None,
                device_proof: Some(verify_proof),
            })
            .await
            .expect("verify lease");
        assert!(verified.valid);
        assert_eq!(verified.status, "active");

        let renew_proof = issue_test_device_proof(
            &service,
            &signing_key,
            &public_key_spki,
            &device_key_id,
            &client_install_id,
            Some(activated.lease_token.clone()),
        )
        .await;
        let renewed = service
            .renew(RenewLeaseRequest {
                lease_token: activated.lease_token,
                client_install_id: Some(client_install_id.clone()),
                machine_hash: None,
                device_proof: Some(renew_proof),
            })
            .await
            .expect("renew lease");

        let permit_without_proof = service
            .issue_permit(IssuePermitRequest {
                lease_token: renewed.lease_token.clone(),
                client_install_id: Some(client_install_id.clone()),
                machine_hash: None,
                operation: "start_distribution".to_string(),
                task_hash: "sha256:test-task".to_string(),
                device_proof: None,
            })
            .await
            .expect_err("permit must require device proof");
        assert!(format!("{permit_without_proof:?}").contains("DEVICE_CHALLENGE_REQUIRED"));

        let permit_proof = issue_test_device_proof(
            &service,
            &signing_key,
            &public_key_spki,
            &device_key_id,
            &client_install_id,
            Some(renewed.lease_token.clone()),
        )
        .await;
        let permit = service
            .issue_permit(IssuePermitRequest {
                lease_token: renewed.lease_token,
                client_install_id: Some(client_install_id),
                machine_hash: None,
                operation: "start_distribution".to_string(),
                task_hash: "sha256:test-task".to_string(),
                device_proof: Some(permit_proof),
            })
            .await
            .expect("issue permit");
        assert!(!permit.permit_token.is_empty());
        assert!(permit.expires_at <= permit.server_time + Duration::seconds(PERMIT_TTL_SECONDS));
    }

    #[tokio::test]
    async fn same_install_device_key_loss_reactivation_consumes_migration_quota() {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("sqlite memory db");
        create_test_schema(&db).await;
        let now = Utc::now();
        let activation_code = format!("PF-TEST-{}", Uuid::new_v4());
        let license_id = Uuid::new_v4();

        license::ActiveModel {
            id: Set(license_id),
            user_id: Set(None),
            activation_code: Set(activation_code.clone()),
            tier: Set("pro".to_string()),
            plan: Set("monthly".to_string()),
            source_channel: Set("test".to_string()),
            batch_id: Set(None),
            max_devices: Set(1),
            device_migration_limit: Set(3),
            device_migration_count: Set(0),
            last_migrated_at: Set(None),
            activated_at: Set(None),
            expires_at: Set(None),
            is_revoked: Set(false),
            deleted_at: Set(None),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&db)
        .await
        .expect("insert license");

        let service = LeaseService {
            db: db.clone(),
            jwt_service: crate::shared::jwt::JwtService::new("test-jwt-secret".to_string()),
            redis: None,
            protocol_private_key: "00".repeat(32),
            replay_window_seconds: 300,
            nonce_ttl_seconds: 300,
        };
        let client_install_id = "install-storage-copied-without-indexeddb".to_string();

        let first_key = SigningKey::from_slice(&[11u8; 32]).expect("valid signing key");
        let first_public_key_spki = first_key
            .verifying_key()
            .to_public_key_der()
            .expect("spki der")
            .as_bytes()
            .to_vec();
        let first_device_key_id = device_key_id_from_public_key(&first_public_key_spki);
        let first_proof = issue_test_device_proof(
            &service,
            &first_key,
            &first_public_key_spki,
            &first_device_key_id,
            &client_install_id,
            None,
        )
        .await;
        let first_activation = service
            .activate(
                ActivateLeaseRequest {
                    activation_code: activation_code.clone(),
                    client_install_id: Some(client_install_id.clone()),
                    machine_hash: None,
                    platform: "macos".to_string(),
                    extension_version: Some("0.1.0".to_string()),
                    device_proof: Some(first_proof),
                },
                "127.0.0.1",
            )
            .await
            .expect("first activate");
        let first_license_model = license::Entity::find_by_id(license_id)
            .one(&db)
            .await
            .expect("find license after first activation")
            .expect("license exists after first activation");
        let first_license_expires_at =
            license_expires_at_utc(&first_license_model).expect("license expiry set");
        assert_eq!(
            first_activation.license_expires_at,
            first_license_expires_at
        );

        let second_key = SigningKey::from_slice(&[12u8; 32]).expect("valid signing key");
        let second_public_key_spki = second_key
            .verifying_key()
            .to_public_key_der()
            .expect("spki der")
            .as_bytes()
            .to_vec();
        let second_device_key_id = device_key_id_from_public_key(&second_public_key_spki);
        let second_proof = issue_test_device_proof(
            &service,
            &second_key,
            &second_public_key_spki,
            &second_device_key_id,
            &client_install_id,
            None,
        )
        .await;
        let second_activation = service
            .activate(
                ActivateLeaseRequest {
                    activation_code,
                    client_install_id: Some(client_install_id.clone()),
                    machine_hash: None,
                    platform: "macos".to_string(),
                    extension_version: Some("0.1.0".to_string()),
                    device_proof: Some(second_proof),
                },
                "127.0.0.1",
            )
            .await
            .expect("reactivate after browser private key loss");
        assert_eq!(
            second_activation.license_expires_at,
            first_license_expires_at
        );

        let license_model = license::Entity::find_by_id(license_id)
            .one(&db)
            .await
            .expect("find license")
            .expect("license exists");
        assert_eq!(license_model.device_migration_count, 1);
        assert_eq!(
            license_expires_at_utc(&license_model),
            Some(first_license_expires_at)
        );

        let active_leases = lease::Entity::find()
            .filter(lease::Column::LicenseId.eq(license_id))
            .filter(lease::Column::IsRevoked.eq(false))
            .all(&db)
            .await
            .expect("find active leases");
        assert_eq!(active_leases.len(), 1);
        assert_eq!(
            active_leases[0].device_key_id.as_deref(),
            Some(second_device_key_id.as_str())
        );
        assert_ne!(
            active_leases[0].device_key_id.as_deref(),
            Some(first_device_key_id.as_str())
        );
    }

    #[tokio::test]
    async fn same_activation_code_multi_device_consumes_and_enforces_migration_limit() {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("sqlite memory db");
        create_test_schema(&db).await;
        let now = Utc::now();
        let activation_code = format!("PF-TEST-{}", Uuid::new_v4());
        let license_id = Uuid::new_v4();

        license::ActiveModel {
            id: Set(license_id),
            user_id: Set(None),
            activation_code: Set(activation_code.clone()),
            tier: Set("pro".to_string()),
            plan: Set("monthly".to_string()),
            source_channel: Set("test".to_string()),
            batch_id: Set(None),
            max_devices: Set(1),
            device_migration_limit: Set(1),
            device_migration_count: Set(0),
            last_migrated_at: Set(None),
            activated_at: Set(None),
            expires_at: Set(None),
            is_revoked: Set(false),
            deleted_at: Set(None),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&db)
        .await
        .expect("insert license");

        let service = LeaseService {
            db: db.clone(),
            jwt_service: crate::shared::jwt::JwtService::new("test-jwt-secret".to_string()),
            redis: None,
            protocol_private_key: "00".repeat(32),
            replay_window_seconds: 300,
            nonce_ttl_seconds: 300,
        };

        let first_install_id = "install-multi-device-1".to_string();
        let first_key = SigningKey::from_slice(&[21u8; 32]).expect("valid signing key");
        let first_public_key_spki = first_key
            .verifying_key()
            .to_public_key_der()
            .expect("spki der")
            .as_bytes()
            .to_vec();
        let first_device_key_id = device_key_id_from_public_key(&first_public_key_spki);
        let first_proof = issue_test_device_proof(
            &service,
            &first_key,
            &first_public_key_spki,
            &first_device_key_id,
            &first_install_id,
            None,
        )
        .await;
        service
            .activate(
                ActivateLeaseRequest {
                    activation_code: activation_code.clone(),
                    client_install_id: Some(first_install_id.clone()),
                    machine_hash: None,
                    platform: "macos".to_string(),
                    extension_version: Some("0.1.0".to_string()),
                    device_proof: Some(first_proof),
                },
                "127.0.0.1",
            )
            .await
            .expect("activate first device");

        let second_install_id = "install-multi-device-2".to_string();
        let second_key = SigningKey::from_slice(&[22u8; 32]).expect("valid signing key");
        let second_public_key_spki = second_key
            .verifying_key()
            .to_public_key_der()
            .expect("spki der")
            .as_bytes()
            .to_vec();
        let second_device_key_id = device_key_id_from_public_key(&second_public_key_spki);
        let second_proof = issue_test_device_proof(
            &service,
            &second_key,
            &second_public_key_spki,
            &second_device_key_id,
            &second_install_id,
            None,
        )
        .await;
        service
            .activate(
                ActivateLeaseRequest {
                    activation_code: activation_code.clone(),
                    client_install_id: Some(second_install_id.clone()),
                    machine_hash: None,
                    platform: "macos".to_string(),
                    extension_version: Some("0.1.0".to_string()),
                    device_proof: Some(second_proof),
                },
                "127.0.0.1",
            )
            .await
            .expect("second device consumes one migration");

        let after_migration = license::Entity::find_by_id(license_id)
            .one(&db)
            .await
            .expect("find license")
            .expect("license exists");
        assert_eq!(after_migration.device_migration_count, 1);
        let active_after_migration = lease::Entity::find()
            .filter(lease::Column::LicenseId.eq(license_id))
            .filter(lease::Column::IsRevoked.eq(false))
            .all(&db)
            .await
            .expect("find active leases");
        assert_eq!(active_after_migration.len(), 1);
        assert_eq!(
            active_after_migration[0].client_install_id.as_deref(),
            Some(second_install_id.as_str())
        );

        let third_install_id = "install-multi-device-3".to_string();
        let third_key = SigningKey::from_slice(&[23u8; 32]).expect("valid signing key");
        let third_public_key_spki = third_key
            .verifying_key()
            .to_public_key_der()
            .expect("spki der")
            .as_bytes()
            .to_vec();
        let third_device_key_id = device_key_id_from_public_key(&third_public_key_spki);
        let third_proof = issue_test_device_proof(
            &service,
            &third_key,
            &third_public_key_spki,
            &third_device_key_id,
            &third_install_id,
            None,
        )
        .await;
        service
            .activate(
                ActivateLeaseRequest {
                    activation_code,
                    client_install_id: Some(third_install_id),
                    machine_hash: None,
                    platform: "macos".to_string(),
                    extension_version: Some("0.1.0".to_string()),
                    device_proof: Some(third_proof),
                },
                "127.0.0.1",
            )
            .await
            .expect_err("third device must be blocked after migration limit");

        let active_after_limit = lease::Entity::find()
            .filter(lease::Column::LicenseId.eq(license_id))
            .filter(lease::Column::IsRevoked.eq(false))
            .all(&db)
            .await
            .expect("find active leases after limit");
        assert_eq!(active_after_limit.len(), 1);
        assert_eq!(
            active_after_limit[0].client_install_id.as_deref(),
            Some(second_install_id.as_str())
        );
    }

    #[tokio::test]
    async fn unbound_post_rollout_lease_rejects_verify_and_renew_without_proof() {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("sqlite memory db");
        create_test_schema(&db).await;
        let now = Utc::now();
        let license_id = Uuid::new_v4();
        let lease_id = Uuid::new_v4();
        let client_install_id = "install-unbound-post-rollout".to_string();
        let activation_code = format!("PF-TEST-{}", Uuid::new_v4());

        license::ActiveModel {
            id: Set(license_id),
            user_id: Set(None),
            activation_code: Set(activation_code),
            tier: Set("pro".to_string()),
            plan: Set("monthly".to_string()),
            source_channel: Set("test".to_string()),
            batch_id: Set(None),
            max_devices: Set(1),
            device_migration_limit: Set(3),
            device_migration_count: Set(0),
            last_migrated_at: Set(None),
            activated_at: Set(Some(now.into())),
            expires_at: Set(Some((now + Duration::days(365)).into())),
            is_revoked: Set(false),
            deleted_at: Set(None),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&db)
        .await
        .expect("insert license");

        let service = LeaseService {
            db: db.clone(),
            jwt_service: crate::shared::jwt::JwtService::new("test-jwt-secret".to_string()),
            redis: None,
            protocol_private_key: "00".repeat(32),
            replay_window_seconds: 300,
            nonce_ttl_seconds: 300,
        };
        let valid_until = now + Duration::days(30);
        let lease_token = service
            .jwt_service
            .generate_token_with_claims(
                &LeaseClaims {
                    lease_id: lease_id.to_string(),
                    license_id: license_id.to_string(),
                    client_install_id: client_install_id.clone(),
                    machine_hash: None,
                    lease_type: "subscription".to_string(),
                    tier: "pro".to_string(),
                    features: vec!["publish".to_string()],
                    valid_from: now.timestamp(),
                    valid_until: valid_until.timestamp(),
                    min_extension_version: "0.1.0".to_string(),
                    policy_version: 1,
                    key_version: service.jwt_service.active_key_version(),
                },
                (valid_until - now).num_seconds(),
            )
            .expect("lease token");
        let created_after_rollout = device_key_rollout_at() + Duration::days(1);
        lease::ActiveModel {
            id: Set(lease_id),
            license_id: Set(license_id),
            lease_type: Set("subscription".to_string()),
            tier: Set("pro".to_string()),
            features: Set(r#"["publish"]"#.to_string()),
            lease_token: Set(lease_token.clone()),
            valid_from: Set(now.into()),
            valid_until: Set(valid_until.into()),
            min_extension_version: Set("0.1.0".to_string()),
            policy_version: Set(1),
            is_revoked: Set(false),
            ip_address: Set("127.0.0.1".to_string()),
            machine_hash: Set(client_install_id.clone()),
            client_install_id: Set(Some(client_install_id.clone())),
            device_key_id: Set(None),
            device_public_key_spki: Set(None),
            device_key_algorithm: Set(None),
            platform: Set("macos".to_string()),
            created_at: Set(created_after_rollout.into()),
            updated_at: Set(created_after_rollout.into()),
        }
        .insert(&db)
        .await
        .expect("insert unbound lease");

        let verify_without_proof = service
            .verify(VerifyLeaseRequest {
                lease_token: lease_token.clone(),
                client_install_id: Some(client_install_id.clone()),
                machine_hash: None,
                device_proof: None,
            })
            .await
            .expect_err("post-rollout unbound lease verify must require proof");
        assert!(format!("{verify_without_proof:?}").contains("DEVICE_CHALLENGE_REQUIRED"));

        let renew_without_proof = service
            .renew(RenewLeaseRequest {
                lease_token,
                client_install_id: Some(client_install_id),
                machine_hash: None,
                device_proof: None,
            })
            .await
            .expect_err("post-rollout unbound lease renew must require proof");
        assert!(format!("{renew_without_proof:?}").contains("DEVICE_CHALLENGE_REQUIRED"));
    }

    async fn issue_test_device_proof(
        service: &LeaseService,
        signing_key: &SigningKey,
        public_key_spki: &[u8],
        device_key_id: &str,
        client_install_id: &str,
        lease_token: Option<String>,
    ) -> DeviceProof {
        let challenge = service
            .issue_device_challenge(
                DeviceChallengeRequest {
                    lease_token,
                    client_install_id: Some(client_install_id.to_string()),
                    device_key_id: Some(device_key_id.to_string()),
                    purpose: Some("test".to_string()),
                },
                "127.0.0.1",
            )
            .await
            .expect("issue device challenge");
        let signature: Signature = signing_key.sign(challenge.challenge.as_bytes());
        DeviceProof {
            device_key_id: device_key_id.to_string(),
            public_key_spki_base64_url: Some(URL_SAFE_NO_PAD.encode(public_key_spki)),
            challenge_id: challenge.challenge_id,
            challenge: challenge.challenge,
            signature_base64_url: URL_SAFE_NO_PAD.encode(signature.to_bytes()),
            algorithm: Some(DEVICE_KEY_ALGORITHM.to_string()),
            signature_format: Some("webcrypto-p1363".to_string()),
        }
    }

    async fn create_test_schema(db: &DatabaseConnection) {
        let builder = db.get_database_backend();
        let schema = Schema::new(DatabaseBackend::Sqlite);
        for statement in [
            builder.build(&schema.create_table_from_entity(license_batch::Entity)),
            builder.build(&schema.create_table_from_entity(license::Entity)),
            builder.build(&schema.create_table_from_entity(lease::Entity)),
            builder.build(&schema.create_table_from_entity(license_event::Entity)),
        ] {
            db.execute(statement).await.expect("create test table");
        }
    }

    fn lease_model_with_created_at(created_at: chrono::DateTime<Utc>) -> lease::Model {
        lease::Model {
            id: Uuid::new_v4(),
            license_id: Uuid::new_v4(),
            lease_type: "subscription".to_string(),
            tier: "pro".to_string(),
            features: "[]".to_string(),
            lease_token: Uuid::new_v4().to_string(),
            valid_from: created_at.into(),
            valid_until: (created_at + Duration::days(30)).into(),
            min_extension_version: "0.1.0".to_string(),
            policy_version: 1,
            is_revoked: false,
            ip_address: "127.0.0.1".to_string(),
            machine_hash: "client-install-id".to_string(),
            client_install_id: Some("install:test".to_string()),
            device_key_id: None,
            device_public_key_spki: None,
            device_key_algorithm: None,
            platform: "macos".to_string(),
            created_at: created_at.into(),
            updated_at: created_at.into(),
        }
    }
}

fn reserve_pfap_nonce_in_memory(key: &str, ttl_seconds: u64) -> bool {
    static NONCES: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    let now = Instant::now();
    let ttl = StdDuration::from_secs(ttl_seconds);
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

fn store_device_challenge_in_memory(key: &str, challenge: &str, ttl_seconds: u64) {
    let now = Instant::now();
    let ttl = StdDuration::from_secs(ttl_seconds);
    let mut challenges = device_challenges_in_memory()
        .lock()
        .expect("device challenge map mutex poisoned");
    challenges.retain(|_, (_, expires_at)| *expires_at > now);
    challenges.insert(key.to_string(), (challenge.to_string(), now + ttl));
}

fn consume_device_challenge_in_memory(key: &str) -> Option<String> {
    let now = Instant::now();
    let mut challenges = device_challenges_in_memory()
        .lock()
        .expect("device challenge map mutex poisoned");
    challenges.retain(|_, (_, expires_at)| *expires_at > now);
    challenges.remove(key).map(|(challenge, _)| challenge)
}

fn device_challenges_in_memory() -> &'static Mutex<HashMap<String, (String, Instant)>> {
    static CHALLENGES: OnceLock<Mutex<HashMap<String, (String, Instant)>>> = OnceLock::new();
    CHALLENGES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn check_rate_limit_in_memory(key: &str, max_requests: u32, window_seconds: u64) -> bool {
    static RATE_LIMITS: OnceLock<Mutex<HashMap<String, (u32, Instant)>>> = OnceLock::new();
    let now = Instant::now();
    let ttl = StdDuration::from_secs(window_seconds);
    let mut limits = RATE_LIMITS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .expect("rate limit map mutex poisoned");
    limits.retain(|_, (_, expires_at)| *expires_at > now);
    let entry = limits.entry(key.to_string()).or_insert((0, now + ttl));
    if entry.1 <= now {
        *entry = (0, now + ttl);
    }
    entry.0 = entry.0.saturating_add(1);
    entry.0 <= max_requests
}
