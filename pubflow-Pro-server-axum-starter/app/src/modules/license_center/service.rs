use chrono::Utc;
use entity::{lease, license, license_event, license_replacement};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use uuid::Uuid;

use crate::error::PubFlowError;
use crate::shared::FromState;
use crate::shared::plan::new_activation_code;
use crate::{AppState, ValidationError};

use super::dto::{
    LicenseLookupRequest, LicenseLookupResponse, SelfReplaceLicenseRequest,
    SelfReplaceLicenseResponse, SelfRevokeLicenseRequest, SelfRevokeLicenseResponse,
};

pub struct LicenseCenterService {
    db: DatabaseConnection,
}

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
            device_migration_limit: Set(old.device_migration_limit),
            device_migration_count: Set(old.device_migration_count),
            last_migrated_at: Set(old.last_migrated_at),
            activated_at: Set(old.activated_at),
            expires_at: Set(old.expires_at),
            is_revoked: Set(false),
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

    async fn find_license(&self, activation_code: &str) -> Result<license::Model, crate::AppError> {
        license::Entity::find()
            .filter(license::Column::ActivationCode.eq(activation_code.trim()))
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
    license_event::ActiveModel {
        id: Set(Uuid::new_v4()),
        license_id: Set(Some(license_id)),
        lease_id: Set(None),
        activation_code: Set(Some(activation_code)),
        event_type: Set(event_type.to_string()),
        status: Set("success".to_string()),
        reason: Set(Some(reason)),
        ip_address: Set("self-service".to_string()),
        machine_hash: Set(None),
        client_install_id: Set(None),
        platform: Set(Some("web".to_string())),
        extension_version: Set(None),
        user_agent: Set(None),
        expires_at: Set(expires_at),
        created_at: Set(Utc::now().into()),
    }
    .insert(db)
    .await?;
    Ok(())
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
