use chrono::Utc;
use entity::{lease, license, license_event, selector};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, Order, QueryFilter, QueryOrder,
    Set, TransactionTrait,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::PubFlowError;
use crate::shared::FromState;
use crate::{AppState, ValidationError};

use super::dto::{
    FetchSelectorRequest, SelectorResponse, SelectorVersionResponse, UploadSelectorRequest,
    UploadSelectorResponse,
};

pub struct SelectorService {
    db: DatabaseConnection,
    selector_secret: String,
}

impl FromState for SelectorService {
    fn from_state(state: &AppState) -> Self {
        Self {
            db: state.db.clone(),
            selector_secret: state.config.selector_secret.clone(),
        }
    }
}

impl SelectorService {
    pub async fn fetch(
        &self,
        req: FetchSelectorRequest,
    ) -> Result<SelectorResponse, crate::AppError> {
        let license_model = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(&req.activation_code))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;

        if license_model.is_revoked {
            self.log_selector_event(&license_model, "failed", Some("license_revoked"), None)
                .await;
            return Err(PubFlowError::LicenseRevoked.into());
        }
        if license_model
            .expires_at
            .is_some_and(|expires_at| expires_at.with_timezone(&Utc) < Utc::now())
        {
            self.log_selector_event(&license_model, "failed", Some("license_expired"), None)
                .await;
            return Err(PubFlowError::LicenseExpired.into());
        }

        // 检查是否有有效的 lease（非吊销且未过期）
        let active_lease = lease::Entity::find()
            .filter(lease::Column::LicenseId.eq(license_model.id))
            .filter(lease::Column::IsRevoked.eq(false))
            .filter(lease::Column::ValidUntil.gte(Utc::now()))
            .one(&self.db)
            .await?;
        if active_lease.is_none() {
            self.log_selector_event(&license_model, "failed", Some("lease_not_found"), None)
                .await;
            return Err(PubFlowError::LeaseNotFound.into());
        }

        let selector_model = latest_selector(&self.db).await?;
        self.log_selector_event(
            &license_model,
            "success",
            None,
            active_lease.as_ref().map(|item| item.machine_hash.clone()),
        )
        .await;
        Ok(SelectorResponse {
            version: selector_model.version,
            encrypted_data: selector_model.encrypted_data,
            checksum: selector_model.checksum,
            min_app_version: selector_model.min_app_version,
        })
    }

    pub async fn version(&self) -> Result<SelectorVersionResponse, crate::AppError> {
        let selector_model = latest_selector(&self.db).await?;
        Ok(SelectorVersionResponse {
            version: selector_model.version,
            min_app_version: selector_model.min_app_version,
            created_at: selector_model.created_at.with_timezone(&Utc),
        })
    }

    pub async fn upload(
        &self,
        req: UploadSelectorRequest,
    ) -> Result<UploadSelectorResponse, crate::AppError> {
        if req.version <= 0 {
            return Err(ValidationError::custom("version 必须大于 0").into());
        }

        let min_app_version = req.min_app_version.unwrap_or_else(|| "0.1.0".to_string());
        let selectors: std::collections::HashMap<String, pubflow_core::selector::PlatformSelector> =
            serde_json::from_value(req.selectors)?;
        let encrypted_data = pubflow_core::selector::encrypt_selectors(
            &selectors,
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
        machine_hash: Option<String>,
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
            machine_hash: Set(machine_hash),
            platform: Set(None),
            extension_version: Set(None),
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
