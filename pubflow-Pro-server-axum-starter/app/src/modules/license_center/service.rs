use chrono::Utc;
use entity::{lease, license, license_event, license_replacement};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    Set, TransactionTrait,
};
use uuid::Uuid;

use crate::error::PubFlowError;
use crate::shared::FromState;
use crate::shared::plan::new_activation_code;
use crate::{AppState, ValidationError};

use super::dto::{
    LicenseLookupRequest, LicenseLookupResponse, SelfReplaceLicenseRequest,
    SelfReplaceLicenseResponse, SelfResetDevicesRequest, SelfResetDevicesResponse,
    SelfRevokeLicenseRequest, SelfRevokeLicenseResponse,
};

pub struct LicenseCenterService {
    db: DatabaseConnection,
}

const SELF_RESET_DEVICES_DAILY_LIMIT: u64 = 10;

impl FromState for LicenseCenterService {
    fn from_state(state: &AppState) -> Self {
        Self {
            db: state.db.clone(),
        }
    }
}

impl LicenseCenterService {
    pub async fn lookup(
        &self,
        req: LicenseLookupRequest,
    ) -> Result<LicenseLookupResponse, crate::AppError> {
        let license_model = self.find_license(&req.activation_code).await?;
        let active_install_count = lease::Entity::find()
            .filter(lease::Column::LicenseId.eq(license_model.id))
            .filter(lease::Column::IsRevoked.eq(false))
            .all(&self.db)
            .await?
            .into_iter()
            .map(|item| item.client_install_id.unwrap_or(item.machine_hash))
            .collect::<std::collections::BTreeSet<_>>()
            .len();

        Ok(LicenseLookupResponse {
            plan: license_model.plan.clone(),
            status: license_status(&license_model),
            max_devices: license_model.max_devices,
            device_migration_limit: license_model.device_migration_limit,
            device_migration_count: license_model.device_migration_count,
            active_install_count,
            expires_at: license_model
                .expires_at
                .map(|value| value.with_timezone(&Utc)),
            activated_at: license_model
                .activated_at
                .map(|value| value.with_timezone(&Utc)),
        })
    }

    pub async fn self_replace(
        &self,
        req: SelfReplaceLicenseRequest,
    ) -> Result<SelfReplaceLicenseResponse, crate::AppError> {
        let reason = normalize_reason(req.reason, "用户自助补发激活码");
        let now = Utc::now();
        let txn = self.db.begin().await?;
        let old = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(req.activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&txn)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;
        if old.is_revoked {
            return Err(ValidationError::custom("原激活码已注销，不能自助补发").into());
        }

        let new_activation_code = new_activation_code();
        let new_id = Uuid::new_v4();
        license::ActiveModel {
            id: Set(new_id),
            user_id: Set(old.user_id),
            activation_code: Set(new_activation_code.clone()),
            tier: Set(old.tier.clone()),
            plan: Set(old.plan.clone()),
            source_channel: Set(old.source_channel.clone()),
            batch_id: Set(old.batch_id),
            max_devices: Set(old.max_devices),
            remote_daily_job_limit: Set(old.remote_daily_job_limit),
            remote_daily_byte_limit: Set(old.remote_daily_byte_limit),
            device_migration_limit: Set(old.device_migration_limit),
            device_migration_count: Set(old.device_migration_count),
            last_migrated_at: Set(old.last_migrated_at),
            activated_at: Set(old.activated_at),
            expires_at: Set(old.expires_at),
            is_revoked: Set(false),
            deleted_at: Set(None),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&txn)
        .await?;

        let mut old_active: license::ActiveModel = old.clone().into();
        old_active.is_revoked = Set(true);
        old_active.updated_at = Set(now.into());
        old_active.update(&txn).await?;

        lease::Entity::update_many()
            .filter(lease::Column::LicenseId.eq(old.id))
            .filter(lease::Column::IsRevoked.eq(false))
            .set(lease::ActiveModel {
                is_revoked: Set(true),
                updated_at: Set(now.into()),
                ..Default::default()
            })
            .exec(&txn)
            .await?;

        license_replacement::ActiveModel {
            id: Set(Uuid::new_v4()),
            old_license_id: Set(old.id),
            new_license_id: Set(new_id),
            reason: Set(reason.clone()),
            operator: Set("self-service".to_string()),
            revoked_old: Set(true),
            created_at: Set(now.into()),
        }
        .insert(&txn)
        .await?;

        insert_license_event(
            &txn,
            old.id,
            old.activation_code,
            "self_replace",
            reason,
            old.expires_at,
        )
        .await?;
        txn.commit().await?;

        Ok(SelfReplaceLicenseResponse {
            new_activation_code,
            revoked_old: true,
        })
    }

    pub async fn self_revoke(
        &self,
        req: SelfRevokeLicenseRequest,
    ) -> Result<SelfRevokeLicenseResponse, crate::AppError> {
        let reason = normalize_reason(req.reason, "用户自助注销激活码");
        let now = Utc::now();
        let txn = self.db.begin().await?;
        let row = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(req.activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&txn)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;

        let mut active: license::ActiveModel = row.clone().into();
        active.is_revoked = Set(true);
        active.updated_at = Set(now.into());
        active.update(&txn).await?;

        lease::Entity::update_many()
            .filter(lease::Column::LicenseId.eq(row.id))
            .filter(lease::Column::IsRevoked.eq(false))
            .set(lease::ActiveModel {
                is_revoked: Set(true),
                updated_at: Set(now.into()),
                ..Default::default()
            })
            .exec(&txn)
            .await?;

        insert_license_event(
            &txn,
            row.id,
            row.activation_code,
            "self_revoke",
            reason,
            row.expires_at,
        )
        .await?;
        txn.commit().await?;

        Ok(SelfRevokeLicenseResponse { revoked: true })
    }

    pub async fn self_reset_devices(
        &self,
        req: SelfResetDevicesRequest,
    ) -> Result<SelfResetDevicesResponse, crate::AppError> {
        let reason = normalize_reason(req.reason, "用户自助解除旧设备占用");
        let now = Utc::now();
        let txn = self.db.begin().await?;
        let row = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(req.activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&txn)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;
        if row.is_revoked {
            return Err(ValidationError::custom("激活码已注销，不能解除设备占用").into());
        }
        if row
            .expires_at
            .is_some_and(|expires_at| expires_at.with_timezone(&Utc) < now)
        {
            return Err(ValidationError::custom("激活码已过期，不能解除设备占用").into());
        }
        let today_reset_count = count_self_reset_devices_today(&txn, row.id, now).await?;
        if today_reset_count >= SELF_RESET_DEVICES_DAILY_LIMIT {
            txn.rollback().await?;
            insert_license_event_with_status(
                &self.db,
                row.id,
                row.activation_code.clone(),
                "risk_flag",
                "warning",
                format!(
                    "self_reset_daily_limit_reached:count:{today_reset_count}:limit:{SELF_RESET_DEVICES_DAILY_LIMIT}"
                ),
                row.expires_at,
            )
            .await?;
            return Err(ValidationError::custom(
                "今日自助解绑次数已达上限，请明天再试或联系支持处理",
            )
            .into());
        }
        if row.device_migration_count >= row.device_migration_limit {
            txn.rollback().await?;
            insert_license_event_with_status(
                &self.db,
                row.id,
                row.activation_code.clone(),
                "risk_flag",
                "warning",
                format!(
                    "migration_limit_reached:self_reset:count:{}:limit:{}",
                    row.device_migration_count, row.device_migration_limit
                ),
                row.expires_at,
            )
            .await?;
            return Err(ValidationError::custom("设备迁移次数已用完，请联系支持处理").into());
        }

        let revoked = lease::Entity::update_many()
            .filter(lease::Column::LicenseId.eq(row.id))
            .filter(lease::Column::IsRevoked.eq(false))
            .set(lease::ActiveModel {
                is_revoked: Set(true),
                updated_at: Set(now.into()),
                ..Default::default()
            })
            .exec(&txn)
            .await?;
        let new_migration_count = if revoked.rows_affected > 0 {
            row.device_migration_count.saturating_add(1)
        } else {
            row.device_migration_count
        };
        if revoked.rows_affected > 0 {
            let mut active: license::ActiveModel = row.clone().into();
            active.device_migration_count = Set(new_migration_count);
            active.last_migrated_at = Set(Some(now.into()));
            active.updated_at = Set(now.into());
            active.update(&txn).await?;
        }

        insert_license_event(
            &txn,
            row.id,
            row.activation_code.clone(),
            "self_reset_devices",
            format!("{reason}:revoked_{}_leases", revoked.rows_affected),
            row.expires_at,
        )
        .await?;
        if revoked.rows_affected > 0
            && should_flag_frequent_migration(new_migration_count, row.device_migration_limit)
        {
            insert_license_event_with_status(
                &txn,
                row.id,
                row.activation_code.clone(),
                "risk_flag",
                "warning",
                format!(
                    "frequent_device_migration:self_reset:count:{new_migration_count}:limit:{}",
                    row.device_migration_limit
                ),
                row.expires_at,
            )
            .await?;
        }
        txn.commit().await?;

        Ok(SelfResetDevicesResponse {
            revoked_leases: revoked.rows_affected,
            device_migration_count: new_migration_count,
            device_migration_limit: row.device_migration_limit,
        })
    }

    async fn find_license(&self, activation_code: &str) -> Result<license::Model, crate::AppError> {
        license::Entity::find()
            .filter(license::Column::ActivationCode.eq(activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&self.db)
            .await?
            .ok_or_else(|| PubFlowError::LicenseNotFound.into())
    }
}

async fn insert_license_event<C>(
    db: &C,
    license_id: Uuid,
    activation_code: String,
    event_type: &'static str,
    reason: String,
    expires_at: Option<chrono::DateTime<chrono::FixedOffset>>,
) -> Result<(), sea_orm::DbErr>
where
    C: sea_orm::ConnectionTrait,
{
    insert_license_event_with_status(
        db,
        license_id,
        activation_code,
        event_type,
        "success",
        reason,
        expires_at,
    )
    .await
}

async fn insert_license_event_with_status<C>(
    db: &C,
    license_id: Uuid,
    activation_code: String,
    event_type: &'static str,
    status: &'static str,
    reason: String,
    expires_at: Option<chrono::DateTime<chrono::FixedOffset>>,
) -> Result<(), sea_orm::DbErr>
where
    C: sea_orm::ConnectionTrait,
{
    license_event::ActiveModel {
        id: Set(Uuid::new_v4()),
        license_id: Set(Some(license_id)),
        lease_id: Set(None),
        activation_code: Set(Some(activation_code)),
        event_type: Set(event_type.to_string()),
        status: Set(status.to_string()),
        reason: Set(Some(reason)),
        ip_address: Set("self-service".to_string()),
        machine_hash: Set(None),
        client_install_id: Set(None),
        platform: Set(Some("web".to_string())),
        extension_version: Set(None),
        user_agent: Set(None),
        operator: Set(None),
        target_id: Set(None),
        expires_at: Set(expires_at),
        created_at: Set(Utc::now().into()),
    }
    .insert(db)
    .await?;
    Ok(())
}

fn should_flag_frequent_migration(count: i32, limit: i32) -> bool {
    count >= 2 || count >= limit
}

async fn count_self_reset_devices_today<C>(
    db: &C,
    license_id: Uuid,
    now: chrono::DateTime<Utc>,
) -> Result<u64, sea_orm::DbErr>
where
    C: sea_orm::ConnectionTrait,
{
    let day_start = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("midnight is always valid")
        .and_utc();
    license_event::Entity::find()
        .filter(license_event::Column::LicenseId.eq(license_id))
        .filter(license_event::Column::EventType.eq("self_reset_devices"))
        .filter(license_event::Column::Status.eq("success"))
        .filter(license_event::Column::CreatedAt.gte(day_start))
        .count(db)
        .await
}

fn normalize_reason(reason: Option<String>, fallback: &str) -> String {
    reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn license_status(row: &license::Model) -> String {
    if row.is_revoked {
        return "revoked".to_string();
    }
    match row.expires_at {
        Some(expires_at) if expires_at.with_timezone(&Utc) < Utc::now() => "expired".to_string(),
        Some(_) => "active".to_string(),
        None => "pending".to_string(),
    }
}
