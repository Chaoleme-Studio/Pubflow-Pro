use chrono::{Duration, NaiveDate, Utc};
use entity::{lease, license, license_event};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, Set,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::PubFlowError;
use crate::shared::FromState;
use crate::shared::plan::duration_for_plan;

use super::dto::{
    ActivateLeaseRequest, ActivateLeaseResponse, DeactivateLeaseRequest, DeactivateLeaseResponse,
    RenewLeaseRequest, RenewLeaseResponse, VerifyLeaseRequest, VerifyLeaseResponse,
};

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

/// 根据 license 剩余天数计算 lease 有效期，并以 license 到期时间为上限
fn compute_lease_valid_until(
    now: chrono::DateTime<Utc>,
    license_expires_at: chrono::DateTime<Utc>,
) -> chrono::DateTime<Utc> {
    let license_remaining_days = (license_expires_at - now).num_days();
    let lease_days = if license_remaining_days > 60 { 365 } else { 30 };
    let valid_until = now + Duration::days(lease_days);
    if valid_until > license_expires_at {
        license_expires_at
    } else {
        valid_until
    }
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
}

impl FromState for LeaseService {
    fn from_state(state: &AppState) -> Self {
        Self {
            db: state.db.clone(),
            jwt_service: state.jwt_service.clone(),
        }
    }
}

impl LeaseService {
    /// 激活 lease（订阅模式）
    pub async fn activate(
        &self,
        req: ActivateLeaseRequest,
        ip_address: &str,
    ) -> Result<ActivateLeaseResponse, crate::AppError> {
        let now = Utc::now();

        // 1. 查找 license
        let mut license_model = match license::Entity::find()
            .filter(license::Column::ActivationCode.eq(&req.activation_code))
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
                    machine_hash: Some(req.machine_hash.clone()),
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
                Some(req.machine_hash.clone()),
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
                Some(req.machine_hash.clone()),
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
        let unique_machines: std::collections::HashSet<String> =
            all_leases.iter().map(|l| l.machine_hash.clone()).collect();
        if !unique_machines.contains(&req.machine_hash)
            && unique_machines.len() as i32 >= license_model.max_devices
        {
            txn.rollback().await?;
            self.log_event(LicenseEventInput::from_license(
                &license_model,
                None,
                "activate",
                "failed",
                Some("device_limit_reached"),
                ip_address,
                Some(req.machine_hash.clone()),
                Some(req.platform.clone()),
                req.extension_version.clone(),
            ))
            .await;
            return Err(PubFlowError::DeviceLimitReached.into());
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
            machine_hash: req.machine_hash.clone(),
            lease_type: "subscription".to_string(),
            tier: tier.clone(),
            features: features.clone(),
            valid_from: valid_from.timestamp(),
            valid_until: valid_until.timestamp(),
            min_extension_version: min_ext_version.clone(),
            policy_version: 1,
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
            machine_hash: Set(req.machine_hash.clone()),
            platform: Set(req.platform.clone()),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&txn)
        .await?;

        txn.commit().await?;
        self.log_event(LicenseEventInput::from_license(
            &license_model,
            Some(new_lease.id),
            "activate",
            "success",
            None,
            ip_address,
            Some(new_lease.machine_hash.clone()),
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
            server_time: now,
        })
    }

    /// 验证 lease
    pub async fn verify(
        &self,
        req: VerifyLeaseRequest,
    ) -> Result<VerifyLeaseResponse, crate::AppError> {
        let now = Utc::now();

        // 1. 验证 lease token 有效性（JWT 验签 + 过期检查）
        let _claims = self
            .jwt_service
            .verify_token_custom(&req.lease_token)
            .map_err(|_| crate::error::AuthError::InvalidToken)?;

        // 2. 从数据库查询 lease 记录
        let lease_model = lease::Entity::find()
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
                server_time: now,
                expires_in_seconds: 0,
            };
            self.log_event_for_lease(
                "verify",
                "failed",
                &req.machine_hash,
                Some("lease_revoked"),
                &event_lease,
            )
            .await;
            return Ok(response);
        }

        // 4. 检查设备匹配（直接比较 lease 表中的 machine_hash）
        if lease_model.machine_hash != req.machine_hash {
            let event_lease = lease_model.clone();
            let response = VerifyLeaseResponse {
                valid: false,
                status: "device_mismatch".to_string(),
                lease_type: lease_model.lease_type,
                tier: lease_model.tier,
                features: serde_json::from_str(&lease_model.features).unwrap_or_default(),
                valid_until: lease_model.valid_until.with_timezone(&Utc),
                server_time: now,
                expires_in_seconds: 0,
            };
            self.log_event_for_lease(
                "verify",
                "failed",
                &req.machine_hash,
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
                server_time: now,
                expires_in_seconds: 0,
            };
            self.log_event_for_lease(
                "verify",
                "failed",
                &req.machine_hash,
                Some("lease_expired"),
                &event_lease,
            )
            .await;
            return Ok(response);
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
            server_time: now,
            expires_in_seconds,
        };
        self.log_event_for_lease("verify", "success", &req.machine_hash, None, &updated_lease)
            .await;
        Ok(response)
    }

    /// 续租 lease
    pub async fn renew(
        &self,
        req: RenewLeaseRequest,
    ) -> Result<RenewLeaseResponse, crate::AppError> {
        let now = Utc::now();

        // 1. 查找当前 lease
        let lease_model = lease::Entity::find()
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

        // 3. 检查设备匹配（直接比较 lease 表中的 machine_hash）
        if lease_model.machine_hash != req.machine_hash {
            return Err(PubFlowError::DeviceNotBound.into());
        }

        // 4. 检查 license 是否仍然有效
        let license_model = license::Entity::find_by_id(lease_model.license_id)
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

        // 5. 生成新的 lease
        let new_valid_from = now;
        let new_valid_until = compute_lease_valid_until(now, license_expires_at);
        let features: Vec<String> = serde_json::from_str(&lease_model.features).unwrap_or_default();

        let lease_claims = LeaseClaims {
            lease_id: lease_model.id.to_string(),
            license_id: lease_model.license_id.to_string(),
            machine_hash: lease_model.machine_hash.clone(),
            lease_type: lease_model.lease_type.clone(),
            tier: lease_model.tier.clone(),
            features: features.clone(),
            valid_from: new_valid_from.timestamp(),
            valid_until: new_valid_until.timestamp(),
            min_extension_version: lease_model.min_extension_version.clone(),
            policy_version: lease_model.policy_version,
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
            Some(updated.machine_hash.clone()),
            Some(updated.platform.clone()),
            Some(updated.min_extension_version.clone()),
        ))
        .await;

        Ok(RenewLeaseResponse {
            lease_token: new_lease_token,
            valid_until: new_valid_until,
            server_time: now,
        })
    }

    /// 解绑设备
    pub async fn deactivate(
        &self,
        req: DeactivateLeaseRequest,
    ) -> Result<DeactivateLeaseResponse, crate::AppError> {
        let now = Utc::now();

        // 1. 查找 license
        let license_model = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(&req.activation_code))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;

        // 2. 批量吊销该机器码关联的所有 lease（单条 UPDATE 语句）
        let result = lease::Entity::update_many()
            .filter(lease::Column::LicenseId.eq(license_model.id))
            .filter(lease::Column::MachineHash.eq(&req.machine_hash))
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
            Some(req.machine_hash.clone()),
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
                machine_hash: event.machine_hash.unwrap_or_default(),
                platform: event.platform.unwrap_or_default(),
                ip_address: event.ip_address,
                event_type: event.event_type,
                status: event.status,
                reason: event.reason,
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
            if let Some(machine_hash) = &event.machine_hash
                && matches!(
                    event.event_type.as_str(),
                    "activate" | "verify" | "renew" | "selector_fetch"
                )
            {
                entry.1.insert(machine_hash.clone());
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
        machine_hash: &str,
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
            Some(machine_hash.to_string()),
            Some(lease_model.platform.clone()),
            Some(lease_model.min_extension_version.clone()),
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
            platform: Set(input.platform),
            extension_version: Set(input.extension_version),
            user_agent: Set(input.user_agent),
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
        let cutoff = Utc::now() - Duration::days(180);
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
    pub machine_hash: String,
    pub lease_type: String,
    pub tier: String,
    pub features: Vec<String>,
    pub valid_from: i64,
    pub valid_until: i64,
    pub min_extension_version: String,
    pub policy_version: i32,
}
