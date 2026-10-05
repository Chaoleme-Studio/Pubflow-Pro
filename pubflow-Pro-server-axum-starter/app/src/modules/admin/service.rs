use chrono::{DateTime, NaiveDate, Utc};
use entity::{
    app_version, lease, license, license_batch, license_event, license_replacement, order,
    product_catalog, user,
};
use std::collections::BTreeSet;
use std::path::PathBuf;

use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, DatabaseConnection, EntityTrait, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, Set, TransactionTrait,
};
use uuid::Uuid;

use crate::error::PubFlowError;
use crate::shared::plan::{device_migration_limit_for_plan, new_activation_code, normalize_plan};
use crate::shared::{FromState, normalize_license_tier};
use crate::{AppState, ValidationError};

use super::dto::{
    AdminAppVersionItem, AdminAppVersionListResponse, AdminAppVersionQuery, AdminDownloadConfig,
    AdminLoginRequest, AdminLoginResponse, AdminPlanConfig, AdminProductCatalogConfig,
    BulkLicenseActionRequest, BulkLicenseActionResponse, CreateAppVersionRequest,
    DeleteAppVersionResponse, DeleteLicenseRequest, DeleteLicenseResponse, FreezeLicenseRequest,
    FreezeLicenseResponse, GenerateLicenseRequest, GenerateLicenseResponse, LicenseBatchItem,
    LicenseItem, LicenseSummary, ListLicenseQuery, ListOrderQuery, ListUserQuery,
    OrderOperationItem, ReplaceLicenseRequest, ReplaceLicenseResponse, RevokeLicenseRequest,
    RevokeLicenseResponse, UnbindLicenseDeviceRequest, UnbindLicenseDeviceResponse,
    UnfreezeLicenseRequest, UnfreezeLicenseResponse, UpdateAppVersionRequest,
    UpdateLicenseLimitsRequest, UpdateLicenseLimitsResponse, UpdateLicenseNoteRequest,
    UpdateLicenseNoteResponse, UserOperationItem,
};

pub struct AdminService {
    db: DatabaseConnection,
    jwt_service: crate::shared::jwt::JwtService,
    admin_username: String,
    admin_password_hash: String,
    downloads_fs_path: String,
}

#[derive(Debug, Clone)]
pub struct AdminAuditContext {
    pub operator: String,
    pub source_ip: String,
}

impl FromState for AdminService {
    fn from_state(state: &AppState) -> Self {
        Self {
            db: state.db.clone(),
            jwt_service: state.jwt_service.clone(),
            admin_username: state.config.admin_username.clone(),
            admin_password_hash: state.config.admin_password_hash.clone(),
            downloads_fs_path: state.config.downloads_fs_path.clone(),
        }
    }
}

impl AdminService {
    pub fn audit_context(&self, source_ip: impl Into<String>) -> AdminAuditContext {
        AdminAuditContext {
            operator: self.admin_username.clone(),
            source_ip: source_ip.into(),
        }
    }

    pub fn login(&self, req: AdminLoginRequest) -> Result<AdminLoginResponse, crate::AppError> {
        let username = req.username.trim();

        if username != self.admin_username {
            return Err(crate::error::AuthError::InvalidPassword.into());
        }

        // 使用 Argon2 验证密码哈希
        let is_valid =
            crate::shared::password::verify_password(&req.password, &self.admin_password_hash)
                .map_err(|_| crate::error::AuthError::InvalidPassword)?;

        if !is_valid {
            return Err(crate::error::AuthError::InvalidPassword.into());
        }

        // 生成 JWT token（admin 使用 sub=-1 标识，有效期 24 小时）
        let token = self
            .jwt_service
            .generate_token(-1, 24 * 3600)
            .map_err(|_| crate::error::AuthError::InvalidToken)?;

        Ok(AdminLoginResponse {
            token,
            username: self.admin_username.clone(),
        })
    }

    pub async fn generate_licenses(
        &self,
        req: GenerateLicenseRequest,
        audit: AdminAuditContext,
    ) -> Result<GenerateLicenseResponse, crate::AppError> {
        let plan = normalize_plan(&req.plan)?;
        let tier = normalize_license_tier(&req.tier)?;
        let device_migration_limit = device_migration_limit_for_plan(plan)?;
        let quantity = req.quantity.unwrap_or(1).clamp(1, 100);
        let max_devices = req.max_devices.unwrap_or(1).clamp(1, 20);
        let now = Utc::now();
        let sales_channel =
            trim_string(req.sales_channel).unwrap_or_else(|| "third_party".to_string());
        let batch_name = trim_string(req.batch_name)
            .unwrap_or_else(|| format!("{}-{}", sales_channel, now.format("%Y%m%d%H%M%S")));
        let note = trim_string(req.note);
        if note
            .as_ref()
            .is_some_and(|value| value.chars().count() > 500)
        {
            return Err(ValidationError::custom("卡密备注不能超过 500 个字符").into());
        }

        let txn = self.db.begin().await?;
        let batch = license_batch::ActiveModel {
            id: Set(Uuid::new_v4()),
            batch_name: Set(batch_name),
            sales_channel: Set(sales_channel.clone()),
            tier: Set(tier.to_string()),
            plan: Set(plan.to_string()),
            quantity: Set(quantity as i32),
            max_devices: Set(max_devices),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&txn)
        .await?;
        let mut items = Vec::with_capacity(quantity as usize);

        for _ in 0..quantity {
            let inserted = license::ActiveModel {
                id: Set(Uuid::new_v4()),
                user_id: Set(None),
                activation_code: Set(new_activation_code()),
                tier: Set(tier.to_string()),
                plan: Set(plan.to_string()),
                source_channel: Set(sales_channel.clone()),
                batch_id: Set(Some(batch.id)),
                note: Set(note.clone()),
                max_devices: Set(max_devices),
                remote_daily_job_limit: Set(None),
                remote_daily_byte_limit: Set(None),
                device_migration_limit: Set(device_migration_limit),
                device_migration_count: Set(0),
                last_migrated_at: Set(None),
                activated_at: Set(None),
                expires_at: Set(None),
                is_revoked: Set(false),
                deleted_at: Set(None),
                created_at: Set(now.into()),
                updated_at: Set(now.into()),
            }
            .insert(&txn)
            .await?;
            items.push(to_license_item(
                inserted,
                Vec::new(),
                Vec::new(),
                None,
                Some(batch.clone()),
            ));
        }

        insert_admin_audit_event(
            &txn,
            None,
            None,
            "generate_licenses",
            "success",
            Some(format!(
                "tier:{tier}:plan:{plan}:quantity:{quantity}:channel:{sales_channel}:max_devices:{max_devices}:migration_limit:{device_migration_limit}"
            )),
            None,
            &audit,
            Some(batch.id.to_string()),
        )
        .await?;

        txn.commit().await?;
        Ok(GenerateLicenseResponse { items })
    }

    pub async fn revoke_license(
        &self,
        req: RevokeLicenseRequest,
        audit: AdminAuditContext,
    ) -> Result<RevokeLicenseResponse, crate::AppError> {
        let now = Utc::now();
        let reason = trim_string(req.reason).unwrap_or_else(|| "后台手动吊销卡密".to_string());
        let txn = self.db.begin().await?;
        let license_model = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(req.activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&txn)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;

        let mut active: license::ActiveModel = license_model.clone().into();
        active.is_revoked = Set(true);
        active.updated_at = Set(now.into());
        active.update(&txn).await?;

        lease::Entity::update_many()
            .filter(lease::Column::LicenseId.eq(license_model.id))
            .filter(lease::Column::IsRevoked.eq(false))
            .set(lease::ActiveModel {
                is_revoked: Set(true),
                updated_at: Set(now.into()),
                ..Default::default()
            })
            .exec(&txn)
            .await?;

        insert_admin_license_event(
            &txn,
            license_model.id,
            Some(license_model.activation_code),
            "admin_revoke",
            "success",
            Some(reason),
            license_model.expires_at,
            &audit,
            Some(license_model.id.to_string()),
        )
        .await?;

        txn.commit().await?;
        Ok(RevokeLicenseResponse { revoked: true })
    }

    pub async fn delete_license(
        &self,
        req: DeleteLicenseRequest,
        audit: AdminAuditContext,
    ) -> Result<DeleteLicenseResponse, crate::AppError> {
        let now = Utc::now();
        let reason = trim_string(req.reason).unwrap_or_else(|| "后台软删除测试卡密".to_string());
        let txn = self.db.begin().await?;
        let license_model = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(req.activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&txn)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;

        let mut active: license::ActiveModel = license_model.clone().into();
        active.is_revoked = Set(true);
        active.deleted_at = Set(Some(now.into()));
        active.updated_at = Set(now.into());
        active.update(&txn).await?;

        let revoked = lease::Entity::update_many()
            .filter(lease::Column::LicenseId.eq(license_model.id))
            .filter(lease::Column::IsRevoked.eq(false))
            .set(lease::ActiveModel {
                is_revoked: Set(true),
                updated_at: Set(now.into()),
                ..Default::default()
            })
            .exec(&txn)
            .await?;

        insert_admin_license_event(
            &txn,
            license_model.id,
            Some(license_model.activation_code),
            "admin_delete",
            "success",
            Some(format!("{reason}:revoked_{}_leases", revoked.rows_affected)),
            license_model.expires_at,
            &audit,
            Some(license_model.id.to_string()),
        )
        .await?;

        txn.commit().await?;
        Ok(DeleteLicenseResponse {
            deleted: true,
            revoked_leases: revoked.rows_affected,
        })
    }

    pub async fn bulk_license_action(
        &self,
        req: BulkLicenseActionRequest,
        audit: AdminAuditContext,
    ) -> Result<BulkLicenseActionResponse, crate::AppError> {
        let action = req.action.trim().to_ascii_lowercase();
        if action != "revoke" && action != "delete" {
            return Err(ValidationError::custom("批量操作仅支持 revoke 或 delete").into());
        }

        let codes: BTreeSet<String> = req
            .activation_codes
            .into_iter()
            .map(|code| code.trim().to_string())
            .filter(|code| !code.is_empty())
            .collect();
        if codes.len() > 200 {
            return Err(ValidationError::custom("单次最多处理 200 张卡密").into());
        }

        let batch_id = trim_string(req.batch_id)
            .map(|value| {
                Uuid::parse_str(&value).map_err(|_| ValidationError::custom("批次 ID 格式不正确"))
            })
            .transpose()?;
        if batch_id.is_none() && codes.is_empty() {
            return Err(ValidationError::custom("请选择卡密或指定批次").into());
        }

        let now = Utc::now();
        let reason = trim_string(req.reason).unwrap_or_else(|| {
            if action == "delete" {
                "后台批量删除卡密".to_string()
            } else {
                "后台批量吊销卡密".to_string()
            }
        });
        let txn = self.db.begin().await?;
        let mut query = license::Entity::find().filter(license::Column::DeletedAt.is_null());
        query = if let Some(batch_id) = batch_id {
            query.filter(license::Column::BatchId.eq(batch_id))
        } else {
            query.filter(license::Column::ActivationCode.is_in(codes))
        };
        let rows = query.all(&txn).await?;
        if rows.is_empty() {
            return Err(ValidationError::custom("没有找到可处理的卡密").into());
        }

        let license_ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        let mut update = license::ActiveModel {
            is_revoked: Set(true),
            updated_at: Set(now.into()),
            ..Default::default()
        };
        if action == "delete" {
            update.deleted_at = Set(Some(now.into()));
        }
        license::Entity::update_many()
            .filter(license::Column::Id.is_in(license_ids.clone()))
            .set(update)
            .exec(&txn)
            .await?;

        let revoked = lease::Entity::update_many()
            .filter(lease::Column::LicenseId.is_in(license_ids))
            .filter(lease::Column::IsRevoked.eq(false))
            .set(lease::ActiveModel {
                is_revoked: Set(true),
                updated_at: Set(now.into()),
                ..Default::default()
            })
            .exec(&txn)
            .await?;

        let event_type = if action == "delete" {
            "admin_bulk_delete"
        } else {
            "admin_bulk_revoke"
        };
        for row in &rows {
            insert_admin_license_event(
                &txn,
                row.id,
                Some(row.activation_code.clone()),
                event_type,
                "success",
                Some(reason.clone()),
                row.expires_at,
                &audit,
                Some(row.id.to_string()),
            )
            .await?;
        }

        txn.commit().await?;
        Ok(BulkLicenseActionResponse {
            affected: rows.len() as u64,
            revoked_leases: revoked.rows_affected,
        })
    }

    pub async fn freeze_license(
        &self,
        req: FreezeLicenseRequest,
        audit: AdminAuditContext,
    ) -> Result<FreezeLicenseResponse, crate::AppError> {
        let now = Utc::now();
        let reason = trim_string(req.reason).unwrap_or_else(|| "后台冻结当前设备授权".to_string());
        let txn = self.db.begin().await?;
        let license_model = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(req.activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&txn)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;
        if license_model.is_revoked {
            return Err(ValidationError::custom("已吊销卡密不能冻结").into());
        }

        let revoked = lease::Entity::update_many()
            .filter(lease::Column::LicenseId.eq(license_model.id))
            .filter(lease::Column::IsRevoked.eq(false))
            .set(lease::ActiveModel {
                is_revoked: Set(true),
                updated_at: Set(now.into()),
                ..Default::default()
            })
            .exec(&txn)
            .await?;

        insert_admin_license_event(
            &txn,
            license_model.id,
            Some(license_model.activation_code),
            "admin_freeze",
            "success",
            Some(format!("{reason}:revoked_{}_leases", revoked.rows_affected)),
            license_model.expires_at,
            &audit,
            Some(license_model.id.to_string()),
        )
        .await?;

        txn.commit().await?;
        Ok(FreezeLicenseResponse {
            frozen: true,
            revoked_leases: revoked.rows_affected,
        })
    }

    pub async fn unfreeze_license(
        &self,
        req: UnfreezeLicenseRequest,
        audit: AdminAuditContext,
    ) -> Result<UnfreezeLicenseResponse, crate::AppError> {
        let now = Utc::now();
        let reason = trim_string(req.reason).unwrap_or_else(|| "后台解除冻结".to_string());
        let reset_migration_count = req.reset_migration_count.unwrap_or(false);
        let txn = self.db.begin().await?;
        let row = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(req.activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&txn)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;
        if row.is_revoked {
            return Err(ValidationError::custom("已吊销卡密不能解冻，请补发新卡密").into());
        }

        let mut active: license::ActiveModel = row.clone().into();
        if reset_migration_count {
            active.device_migration_count = Set(0);
        }
        active.updated_at = Set(now.into());
        let updated = active.update(&txn).await?;

        insert_admin_license_event(
            &txn,
            updated.id,
            Some(updated.activation_code.clone()),
            "admin_unfreeze",
            "success",
            Some(format!(
                "{reason}:reset_migration_count:{reset_migration_count}"
            )),
            updated.expires_at,
            &audit,
            Some(updated.id.to_string()),
        )
        .await?;

        txn.commit().await?;
        Ok(UnfreezeLicenseResponse {
            unfrozen: true,
            device_migration_count: updated.device_migration_count,
        })
    }

    pub async fn unbind_license_device(
        &self,
        req: UnbindLicenseDeviceRequest,
        audit: AdminAuditContext,
    ) -> Result<UnbindLicenseDeviceResponse, crate::AppError> {
        let now = Utc::now();
        let client_install_id = req.client_install_id.trim().to_string();
        if client_install_id.is_empty() {
            return Err(ValidationError::custom("client_install_id 不能为空").into());
        }
        let reason = trim_string(req.reason).unwrap_or_else(|| "后台解绑单个设备".to_string());
        let consume_migration = req.consume_migration.unwrap_or(false);
        let txn = self.db.begin().await?;
        let row = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(req.activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&txn)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;
        if row.is_revoked {
            return Err(ValidationError::custom("已吊销卡密不能解绑设备").into());
        }

        let revoked = lease::Entity::update_many()
            .filter(lease::Column::LicenseId.eq(row.id))
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

        let mut updated = row.clone();
        if consume_migration && revoked.rows_affected > 0 {
            let mut active: license::ActiveModel = row.clone().into();
            active.device_migration_count = Set(row.device_migration_count.saturating_add(1));
            active.last_migrated_at = Set(Some(now.into()));
            active.updated_at = Set(now.into());
            updated = active.update(&txn).await?;
        }

        insert_admin_license_event(
            &txn,
            updated.id,
            Some(updated.activation_code.clone()),
            "admin_unbind_device",
            "success",
            Some(format!(
                "{reason}:client_install_id:{client_install_id}:revoked_{}_leases:consume_migration:{consume_migration}",
                revoked.rows_affected
            )),
            updated.expires_at,
            &audit,
            Some(format!("{}:{client_install_id}", updated.id)),
        )
        .await?;

        txn.commit().await?;
        Ok(UnbindLicenseDeviceResponse {
            revoked_leases: revoked.rows_affected,
            device_migration_count: updated.device_migration_count,
            device_migration_limit: updated.device_migration_limit,
        })
    }

    pub async fn product_catalog_config(
        &self,
    ) -> Result<AdminProductCatalogConfig, crate::AppError> {
        let rows = product_catalog::Entity::find()
            .order_by(product_catalog::Column::SortOrder, sea_orm::Order::Asc)
            .all(&self.db)
            .await?;
        Ok(admin_product_catalog_from_rows(rows))
    }

    pub async fn save_product_catalog_config(
        &self,
        req: AdminProductCatalogConfig,
        audit: AdminAuditContext,
    ) -> Result<AdminProductCatalogConfig, crate::AppError> {
        let now = Utc::now();
        let txn = self.db.begin().await?;
        let mut incoming_download_codes = Vec::new();

        for (index, plan) in req.plans.into_iter().enumerate() {
            let code = normalize_plan(&plan.id)?;
            let tier = normalize_license_tier(&plan.tier)?;
            if plan.original_amount_cents <= 0 {
                return Err(ValidationError::custom("套餐原价必须大于 0").into());
            }
            if let Some(discount) = plan.discount_amount_cents
                && discount <= 0
            {
                return Err(ValidationError::custom("折扣价必须大于 0").into());
            }
            let existing = product_catalog::Entity::find()
                .filter(product_catalog::Column::Kind.eq("plan"))
                .filter(product_catalog::Column::Code.eq(code))
                .filter(product_catalog::Column::Tier.eq(tier))
                .one(&txn)
                .await?;
            let mut active = existing
                .map(Into::<product_catalog::ActiveModel>::into)
                .unwrap_or_else(|| product_catalog::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    kind: Set("plan".to_string()),
                    code: Set(code.to_string()),
                    tier: Set(tier.to_string()),
                    created_at: Set(now.into()),
                    ..Default::default()
                });
            active.name = Set(trim_string(Some(plan.name)).unwrap_or_else(|| code.to_string()));
            active.price = Set(Some(cents_to_yuan(plan.original_amount_cents)));
            active.unit = Set(plan.unit);
            active.note = Set(plan.note);
            active.amount_cents = Set(Some(plan.original_amount_cents));
            active.original_amount_cents = Set(Some(plan.original_amount_cents));
            active.discount_amount_cents = Set(plan.discount_amount_cents);
            active.discount_start_at = Set(plan.discount_start_at.map(Into::into));
            active.discount_end_at = Set(plan.discount_end_at.map(Into::into));
            active.discount_enabled = Set(plan.discount_enabled);
            active.sort_order = Set(plan.sort_order.unwrap_or(((index + 1) * 10) as i32));
            active.is_active = Set(plan.is_active);
            active.updated_at = Set(now.into());
            active.save(&txn).await?;
        }

        for (index, item) in req.downloads.into_iter().enumerate() {
            let code = trim_string(Some(item.code))
                .ok_or_else(|| ValidationError::custom("下载配置 code 不能为空"))?;
            incoming_download_codes.push(code.clone());
            let href = trim_string(Some(item.href))
                .ok_or_else(|| ValidationError::custom("下载链接不能为空"))?;
            if item.is_active && !is_supported_download_base(&href) {
                return Err(ValidationError::custom(
                    "下载链接必须是 http(s) 或 /v1/downloads/ 直链",
                )
                .into());
            }
            let existing = product_catalog::Entity::find()
                .filter(product_catalog::Column::Kind.eq("download"))
                .filter(product_catalog::Column::Code.eq(&code))
                .filter(product_catalog::Column::Tier.eq("basic"))
                .one(&txn)
                .await?;
            let mut active = existing
                .map(Into::<product_catalog::ActiveModel>::into)
                .unwrap_or_else(|| product_catalog::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    kind: Set("download".to_string()),
                    code: Set(code.clone()),
                    tier: Set("basic".to_string()),
                    created_at: Set(now.into()),
                    ..Default::default()
                });
            active.name = Set(trim_string(Some(item.name)).unwrap_or_else(|| code.clone()));
            active.price = Set(None);
            active.unit = Set(None);
            active.note = Set(None);
            active.amount_cents = Set(None);
            active.original_amount_cents = Set(None);
            active.discount_amount_cents = Set(None);
            active.discount_start_at = Set(None);
            active.discount_end_at = Set(None);
            active.discount_enabled = Set(false);
            active.platform = Set(Some(item.platform));
            active.chip = Set(item.chip);
            active.file_name = Set(item.file_name);
            active.href = Set(Some(href));
            active.sort_order = Set(item.sort_order.unwrap_or(100 + index as i32 * 10));
            active.is_active = Set(item.is_active);
            active.updated_at = Set(now.into());
            active.save(&txn).await?;
        }

        let mut inactive_downloads = product_catalog::Entity::update_many()
            .filter(product_catalog::Column::Kind.eq("download"));
        if !incoming_download_codes.is_empty() {
            inactive_downloads = inactive_downloads
                .filter(product_catalog::Column::Code.is_not_in(incoming_download_codes));
        }
        inactive_downloads
            .set(product_catalog::ActiveModel {
                is_active: Set(false),
                updated_at: Set(now.into()),
                ..Default::default()
            })
            .exec(&txn)
            .await?;

        insert_admin_audit_event(
            &txn,
            None,
            None,
            "product_catalog_save",
            "success",
            Some("后台保存商品与下载配置".to_string()),
            None,
            &audit,
            Some("product_catalog".to_string()),
        )
        .await?;

        txn.commit().await?;
        self.product_catalog_config().await
    }

    pub async fn list_app_versions(
        &self,
        query: AdminAppVersionQuery,
    ) -> Result<AdminAppVersionListResponse, crate::AppError> {
        let platform = normalize_app_platform(query.platform);
        let rows = app_version::Entity::find()
            .filter(app_version::Column::Platform.eq(platform))
            .order_by(app_version::Column::CreatedAt, sea_orm::Order::Desc)
            .limit(query.limit.unwrap_or(20).clamp(1, 100))
            .all(&self.db)
            .await?;

        Ok(AdminAppVersionListResponse {
            items: rows.into_iter().map(to_admin_app_version_item).collect(),
        })
    }

    pub async fn create_app_version(
        &self,
        req: CreateAppVersionRequest,
        audit: AdminAuditContext,
    ) -> Result<AdminAppVersionItem, crate::AppError> {
        let now = Utc::now();
        let active = app_version::ActiveModel {
            id: Set(Uuid::new_v4()),
            created_at: Set(now.into()),
            ..Default::default()
        };
        let inserted = fill_app_version_active_model(
            active,
            Some(req.platform),
            req.version,
            req.min_app_version,
            req.download_url,
            req.download_url_mirror,
            req.release_notes,
            req.force_update,
            req.is_active,
            now,
            &self.downloads_fs_path,
        )
        .await?
        .insert(&self.db)
        .await?;

        insert_admin_audit_event(
            &self.db,
            None,
            None,
            "app_version_create",
            "success",
            Some(format!(
                "platform:{}:version:{}",
                inserted.platform, inserted.version
            )),
            None,
            &audit,
            Some(inserted.id.to_string()),
        )
        .await?;

        Ok(to_admin_app_version_item(inserted))
    }

    pub async fn update_app_version(
        &self,
        id: Uuid,
        req: UpdateAppVersionRequest,
        audit: AdminAuditContext,
    ) -> Result<AdminAppVersionItem, crate::AppError> {
        let row = app_version::Entity::find_by_id(id)
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::AppVersionNotFound)?;
        let now = Utc::now();
        let active = fill_app_version_active_model(
            row.into(),
            req.platform,
            req.version,
            req.min_app_version,
            req.download_url,
            req.download_url_mirror,
            req.release_notes,
            req.force_update,
            req.is_active,
            now,
            &self.downloads_fs_path,
        )
        .await?;
        let updated = active.update(&self.db).await?;

        insert_admin_audit_event(
            &self.db,
            None,
            None,
            "app_version_update",
            "success",
            Some(format!(
                "platform:{}:version:{}",
                updated.platform, updated.version
            )),
            None,
            &audit,
            Some(updated.id.to_string()),
        )
        .await?;

        Ok(to_admin_app_version_item(updated))
    }

    pub async fn delete_app_version(
        &self,
        id: Uuid,
        audit: AdminAuditContext,
    ) -> Result<DeleteAppVersionResponse, crate::AppError> {
        let result = app_version::Entity::delete_by_id(id).exec(&self.db).await?;
        insert_admin_audit_event(
            &self.db,
            None,
            None,
            "app_version_delete",
            if result.rows_affected > 0 {
                "success"
            } else {
                "failed"
            },
            Some(format!("deleted:{}", result.rows_affected)),
            None,
            &audit,
            Some(id.to_string()),
        )
        .await?;
        Ok(DeleteAppVersionResponse {
            deleted: result.rows_affected > 0,
        })
    }

    pub async fn get_app_version(&self, id: Uuid) -> Result<AdminAppVersionItem, crate::AppError> {
        let row = app_version::Entity::find_by_id(id)
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::AppVersionNotFound)?;
        Ok(to_admin_app_version_item(row))
    }

    pub async fn replace_license(
        &self,
        req: ReplaceLicenseRequest,
        audit: AdminAuditContext,
    ) -> Result<ReplaceLicenseResponse, crate::AppError> {
        let reason = trim_string(Some(req.reason))
            .ok_or_else(|| ValidationError::custom("补发原因不能为空"))?;
        let revoke_old = req.revoke_old.unwrap_or(true);
        let now = Utc::now();
        let txn = self.db.begin().await?;
        let old = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(req.activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&txn)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;
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
            note: Set(old.note.clone()),
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

        if revoke_old {
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
        }

        license_replacement::ActiveModel {
            id: Set(Uuid::new_v4()),
            old_license_id: Set(old.id),
            new_license_id: Set(new_id),
            reason: Set(reason.clone()),
            operator: Set(self.admin_username.clone()),
            revoked_old: Set(revoke_old),
            created_at: Set(now.into()),
        }
        .insert(&txn)
        .await?;

        insert_admin_license_event(
            &txn,
            old.id,
            Some(old.activation_code.clone()),
            "replace",
            "success",
            Some(reason),
            old.expires_at,
            &audit,
            Some(format!("{old_id}->{new_id}", old_id = old.id)),
        )
        .await?;

        txn.commit().await?;
        Ok(ReplaceLicenseResponse {
            old_license_id: old.id.to_string(),
            new_license_id: new_id.to_string(),
            new_activation_code,
            revoked_old: revoke_old,
        })
    }

    pub async fn update_license_limits(
        &self,
        req: UpdateLicenseLimitsRequest,
        audit: AdminAuditContext,
    ) -> Result<UpdateLicenseLimitsResponse, crate::AppError> {
        let max_devices = req.max_devices.clamp(1, 20);
        let migration_limit = req.device_migration_limit.clamp(0, 100);
        let now = Utc::now();
        let txn = self.db.begin().await?;
        let row = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(req.activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&txn)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;
        let reason = trim_string(req.reason).unwrap_or_else(|| "后台调整设备限制".to_string());

        let mut active: license::ActiveModel = row.clone().into();
        active.max_devices = Set(max_devices);
        active.device_migration_limit = Set(migration_limit);
        active.updated_at = Set(now.into());
        let updated = active.update(&txn).await?;

        insert_admin_license_event(
            &txn,
            updated.id,
            Some(updated.activation_code.clone()),
            "adjust_limits",
            "success",
            Some(reason),
            updated.expires_at,
            &audit,
            Some(updated.id.to_string()),
        )
        .await?;

        txn.commit().await?;
        Ok(UpdateLicenseLimitsResponse {
            item: to_license_item(updated, Vec::new(), Vec::new(), None, None),
        })
    }

    pub async fn update_license_note(
        &self,
        req: UpdateLicenseNoteRequest,
        audit: AdminAuditContext,
    ) -> Result<UpdateLicenseNoteResponse, crate::AppError> {
        let note = trim_string(req.note);
        if note
            .as_ref()
            .is_some_and(|value| value.chars().count() > 500)
        {
            return Err(ValidationError::custom("卡密备注不能超过 500 个字符").into());
        }

        let now = Utc::now();
        let txn = self.db.begin().await?;
        let row = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(req.activation_code.trim()))
            .filter(license::Column::DeletedAt.is_null())
            .one(&txn)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;

        let mut active: license::ActiveModel = row.into();
        active.note = Set(note.clone());
        active.updated_at = Set(now.into());
        let updated = active.update(&txn).await?;

        insert_admin_license_event(
            &txn,
            updated.id,
            Some(updated.activation_code.clone()),
            "update_note",
            "success",
            Some(
                if note.is_some() {
                    "更新卡密备注"
                } else {
                    "清空卡密备注"
                }
                .to_string(),
            ),
            updated.expires_at,
            &audit,
            Some(updated.id.to_string()),
        )
        .await?;

        txn.commit().await?;
        Ok(UpdateLicenseNoteResponse {
            item: to_license_item(updated, Vec::new(), Vec::new(), None, None),
        })
    }

    pub async fn list_license_batches(&self) -> Result<Vec<LicenseBatchItem>, crate::AppError> {
        let rows = license_batch::Entity::find()
            .order_by_desc(license_batch::Column::CreatedAt)
            .limit(200)
            .all(&self.db)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| LicenseBatchItem {
                id: row.id.to_string(),
                batch_name: row.batch_name,
                sales_channel: row.sales_channel,
                tier: row.tier,
                plan: row.plan,
                quantity: row.quantity,
                created_at: row.created_at.with_timezone(&Utc),
            })
            .collect())
    }

    pub async fn list_licenses(
        &self,
        query: ListLicenseQuery,
    ) -> Result<(Vec<LicenseItem>, u64, u64, u64, LicenseSummary), crate::AppError> {
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
        let mut stmt = license::Entity::find().filter(license::Column::DeletedAt.is_null());

        if let Some(keyword) = trim_opt(&query.keyword) {
            stmt = stmt.filter(
                Condition::any()
                    .add(license::Column::ActivationCode.contains(keyword.clone()))
                    .add(license::Column::Tier.contains(keyword.clone()))
                    .add(license::Column::Note.contains(keyword)),
            );
        }
        if let Some(code) = trim_opt(&query.activation_code) {
            stmt = stmt.filter(license::Column::ActivationCode.contains(code));
        }
        if let Some(tier) = trim_opt(&query.tier) {
            stmt = stmt.filter(license::Column::Tier.eq(tier));
        }
        if let Some(plan) = trim_opt(&query.plan) {
            stmt = stmt.filter(license::Column::Plan.eq(plan));
        }
        if let Some(is_revoked) = query.is_revoked {
            stmt = stmt.filter(license::Column::IsRevoked.eq(is_revoked));
        }
        if let Some(status) = trim_opt(&query.status) {
            stmt = apply_license_status_filter(stmt, &status);
        }
        if let Some(batch_id) = trim_opt(&query.batch_id) {
            let batch_id = Uuid::parse_str(&batch_id)
                .map_err(|_| ValidationError::custom("批次 ID 格式不正确"))?;
            stmt = stmt.filter(license::Column::BatchId.eq(batch_id));
        }
        if let Some(source_channel) = trim_opt(&query.source_channel) {
            stmt = stmt.filter(license::Column::SourceChannel.eq(source_channel));
        }
        if let Some(from) = parse_date_start(query.created_from.as_deref())? {
            stmt = stmt.filter(license::Column::CreatedAt.gte(from));
        }
        if let Some(to) = parse_date_end(query.created_to.as_deref())? {
            stmt = stmt.filter(license::Column::CreatedAt.lte(to));
        }
        if let Some(from) = parse_date_start(query.expires_from.as_deref())? {
            stmt = stmt.filter(license::Column::ExpiresAt.gte(from));
        }
        if let Some(to) = parse_date_end(query.expires_to.as_deref())? {
            stmt = stmt.filter(license::Column::ExpiresAt.lte(to));
        }

        let paginator = stmt
            .order_by_desc(license::Column::CreatedAt)
            .paginate(&self.db, page_size);
        let total = paginator.num_items().await?;
        let rows = paginator.fetch_page(page - 1).await?;

        // 批量查询关联的 lease 和 order，避免 N+1
        let license_ids: Vec<_> = rows.iter().map(|r| r.id).collect();
        let all_leases = lease::Entity::find()
            .filter(lease::Column::LicenseId.is_in(license_ids.clone()))
            .filter(lease::Column::IsRevoked.eq(false))
            .all(&self.db)
            .await?;
        let all_orders = order::Entity::find()
            .filter(order::Column::LicenseId.is_in(license_ids))
            .all(&self.db)
            .await?;
        let batch_ids: Vec<_> = rows.iter().filter_map(|r| r.batch_id).collect();
        let batches_map: std::collections::HashMap<uuid::Uuid, _> = if batch_ids.is_empty() {
            std::collections::HashMap::new()
        } else {
            license_batch::Entity::find()
                .filter(license_batch::Column::Id.is_in(batch_ids))
                .all(&self.db)
                .await?
                .into_iter()
                .map(|batch| (batch.id, batch))
                .collect()
        };

        let mut leases_by_license: std::collections::HashMap<_, Vec<_>> =
            std::collections::HashMap::new();
        for l in all_leases {
            leases_by_license.entry(l.license_id).or_default().push(l);
        }
        let mut orders_by_license: std::collections::HashMap<uuid::Uuid, _> =
            std::collections::HashMap::new();
        for o in all_orders.into_iter().filter(|o| o.license_id.is_some()) {
            orders_by_license.entry(o.license_id.unwrap()).or_insert(o);
        }

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let leases = leases_by_license.get(&row.id).cloned().unwrap_or_default();
            let related_order = orders_by_license.remove(&row.id);
            let machine_hashes: Vec<String> = leases
                .iter()
                .map(|l| l.machine_hash.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            let client_install_ids: Vec<String> = leases
                .iter()
                .filter_map(|l| {
                    l.client_install_id
                        .clone()
                        .or_else(|| Some(l.machine_hash.clone()))
                })
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            let install_filter =
                trim_opt(&query.client_install_id).or_else(|| trim_opt(&query.machine_hash));
            if let Some(filter) = install_filter
                && !client_install_ids.iter().any(|item| item.contains(&filter))
            {
                continue;
            }
            if let Some(from) = parse_date_start(query.paid_from.as_deref())? {
                if !related_order
                    .as_ref()
                    .and_then(|order| order.paid_at)
                    .is_some_and(|paid_at| paid_at >= from)
                {
                    continue;
                }
            }
            if let Some(to) = parse_date_end(query.paid_to.as_deref())? {
                if !related_order
                    .as_ref()
                    .and_then(|order| order.paid_at)
                    .is_some_and(|paid_at| paid_at <= to)
                {
                    continue;
                }
            }
            let related_batch = row.batch_id.and_then(|id| batches_map.get(&id).cloned());
            items.push(to_license_item(
                row,
                client_install_ids,
                machine_hashes,
                related_order,
                related_batch,
            ));
        }

        // 计算汇总统计
        let summary = self.get_license_summary(&query).await?;

        Ok((items, total, page, page_size, summary))
    }

    async fn get_license_summary(
        &self,
        query: &ListLicenseQuery,
    ) -> Result<LicenseSummary, crate::AppError> {
        let mut stmt = license::Entity::find().filter(license::Column::DeletedAt.is_null());

        // 应用相同的过滤条件
        if let Some(keyword) = trim_opt(&query.keyword) {
            stmt = stmt.filter(
                Condition::any()
                    .add(license::Column::ActivationCode.contains(keyword.clone()))
                    .add(license::Column::Tier.contains(keyword.clone()))
                    .add(license::Column::Note.contains(keyword)),
            );
        }
        if let Some(code) = trim_opt(&query.activation_code) {
            stmt = stmt.filter(license::Column::ActivationCode.contains(code));
        }
        if let Some(tier) = trim_opt(&query.tier) {
            stmt = stmt.filter(license::Column::Tier.eq(tier));
        }
        if let Some(plan) = trim_opt(&query.plan) {
            stmt = stmt.filter(license::Column::Plan.eq(plan));
        }
        if let Some(is_revoked) = query.is_revoked {
            stmt = stmt.filter(license::Column::IsRevoked.eq(is_revoked));
        }
        if let Some(status) = trim_opt(&query.status) {
            stmt = apply_license_status_filter(stmt, &status);
        }
        if let Some(batch_id) = trim_opt(&query.batch_id) {
            let batch_id = Uuid::parse_str(&batch_id)
                .map_err(|_| ValidationError::custom("批次 ID 格式不正确"))?;
            stmt = stmt.filter(license::Column::BatchId.eq(batch_id));
        }
        if let Some(source_channel) = trim_opt(&query.source_channel) {
            stmt = stmt.filter(license::Column::SourceChannel.eq(source_channel));
        }
        if let Some(from) = parse_date_start(query.created_from.as_deref())? {
            stmt = stmt.filter(license::Column::CreatedAt.gte(from));
        }
        if let Some(to) = parse_date_end(query.created_to.as_deref())? {
            stmt = stmt.filter(license::Column::CreatedAt.lte(to));
        }
        if let Some(from) = parse_date_start(query.expires_from.as_deref())? {
            stmt = stmt.filter(license::Column::ExpiresAt.gte(from));
        }
        if let Some(to) = parse_date_end(query.expires_to.as_deref())? {
            stmt = stmt.filter(license::Column::ExpiresAt.lte(to));
        }

        let all_licenses = stmt.all(&self.db).await?;
        let total = all_licenses.len() as i64;

        let license_ids: Vec<_> = all_licenses.iter().map(|l| l.id).collect();

        // 批量查询关联订单金额，避免 N+1
        let order_amounts: std::collections::HashMap<uuid::Uuid, i32> = if license_ids.is_empty() {
            std::collections::HashMap::new()
        } else {
            let all_orders = order::Entity::find()
                .filter(order::Column::LicenseId.is_in(license_ids))
                .all(&self.db)
                .await?;
            let mut amounts: std::collections::HashMap<uuid::Uuid, i32> =
                std::collections::HashMap::new();
            for o in all_orders.into_iter() {
                if let Some(lid) = o.license_id {
                    *amounts.entry(lid).or_insert(0) += o.amount_cents;
                }
            }
            amounts
        };

        let mut pending = 0i64;
        let mut active = 0i64;
        let mut revenue_cents = 0i64;

        for lic in &all_licenses {
            if lic.is_revoked {
                // 已吊销不计入 pending/active
            } else if lic.activated_at.is_some() {
                active += 1;
            } else {
                pending += 1;
            }

            revenue_cents += order_amounts.get(&lic.id).copied().unwrap_or(0) as i64;
        }

        Ok(LicenseSummary {
            total,
            pending,
            active,
            revenue_cents,
        })
    }

    pub async fn list_users(
        &self,
        query: ListUserQuery,
    ) -> Result<(Vec<UserOperationItem>, u64, u64, u64), crate::AppError> {
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
        let mut stmt = user::Entity::find();

        if let Some(keyword) = trim_opt(&query.keyword) {
            stmt = stmt.filter(
                Condition::any()
                    .add(user::Column::Username.contains(keyword.clone()))
                    .add(user::Column::Email.contains(keyword)),
            );
        }
        if let Some(status) = trim_opt(&query.status) {
            stmt = stmt.filter(user::Column::Status.eq(status_to_code(&status)?));
        }

        let paginator = stmt.paginate(&self.db, page_size);
        let total = paginator.num_items().await?;
        let rows = paginator.fetch_page(page - 1).await?;

        // 批量查询关联数据，避免 N+1
        let user_ids: Vec<_> = rows.iter().map(|r| r.id).collect();
        let all_licenses = license::Entity::find()
            .filter(license::Column::UserId.is_in(user_ids.clone()))
            .filter(license::Column::DeletedAt.is_null())
            .all(&self.db)
            .await?;
        let all_license_ids: Vec<_> = all_licenses.iter().map(|l| l.id).collect();
        let all_leases = if all_license_ids.is_empty() {
            vec![]
        } else {
            lease::Entity::find()
                .filter(lease::Column::LicenseId.is_in(all_license_ids.clone()))
                .filter(lease::Column::IsRevoked.eq(false))
                .all(&self.db)
                .await?
        };
        let all_orders = if all_license_ids.is_empty() {
            vec![]
        } else {
            order::Entity::find()
                .filter(order::Column::LicenseId.is_in(all_license_ids))
                .all(&self.db)
                .await?
        };

        // 按 user_id 分组 licenses
        let mut licenses_by_user: std::collections::HashMap<_, Vec<_>> =
            std::collections::HashMap::new();
        for lic in all_licenses {
            if let Some(uid) = lic.user_id {
                licenses_by_user.entry(uid).or_default().push(lic);
            }
        }
        // 按 license_id 分组 leases
        let mut leases_by_license: std::collections::HashMap<uuid::Uuid, Vec<_>> =
            std::collections::HashMap::new();
        for l in all_leases {
            leases_by_license.entry(l.license_id).or_default().push(l);
        }
        // 按 license_id 分组 orders
        let mut orders_by_license: std::collections::HashMap<uuid::Uuid, Vec<_>> =
            std::collections::HashMap::new();
        for o in all_orders.into_iter() {
            if let Some(lid) = o.license_id {
                orders_by_license.entry(lid).or_default().push(o);
            }
        }

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let licenses = licenses_by_user.remove(&row.id).unwrap_or_default();
            let license_ids: Vec<_> = licenses.iter().map(|l| l.id).collect();

            let mut machine_hashes_set = BTreeSet::new();
            let mut client_install_ids_set = BTreeSet::new();
            let mut related_orders = Vec::new();
            for lid in &license_ids {
                if let Some(leases) = leases_by_license.get(lid) {
                    for l in leases {
                        machine_hashes_set.insert(l.machine_hash.clone());
                        client_install_ids_set.insert(
                            l.client_install_id
                                .clone()
                                .unwrap_or_else(|| l.machine_hash.clone()),
                        );
                    }
                }
                if let Some(orders) = orders_by_license.get(lid) {
                    related_orders.extend_from_slice(orders);
                }
            }
            related_orders.sort_by_key(|item| item.paid_at.or(Some(item.created_at)));
            related_orders.reverse();

            let machine_hashes = machine_hashes_set.into_iter().collect::<Vec<_>>();
            let client_install_ids = client_install_ids_set.into_iter().collect::<Vec<_>>();

            let install_filter =
                trim_opt(&query.client_install_id).or_else(|| trim_opt(&query.machine_hash));
            if let Some(filter) = install_filter
                && !client_install_ids.iter().any(|item| item.contains(&filter))
            {
                continue;
            }

            let latest_order = related_orders.first();
            let latest_license = licenses.iter().max_by_key(|license| license.created_at);

            if let Some(plan) = trim_opt(&query.plan)
                && latest_order
                    .map(|order| order.plan.as_str())
                    .or_else(|| latest_license.map(|license| license.plan.as_str()))
                    != Some(plan.as_str())
            {
                continue;
            }
            if let Some(from) = parse_date_start(query.paid_from.as_deref())? {
                if !latest_order
                    .and_then(|order| order.paid_at)
                    .is_some_and(|paid_at| paid_at >= from)
                {
                    continue;
                }
            }
            if let Some(to) = parse_date_end(query.paid_to.as_deref())? {
                if !latest_order
                    .and_then(|order| order.paid_at)
                    .is_some_and(|paid_at| paid_at <= to)
                {
                    continue;
                }
            }
            if let Some(from) = parse_date_start(query.expires_from.as_deref())? {
                if !latest_license
                    .and_then(|license| license.expires_at)
                    .is_some_and(|expires_at| expires_at >= from)
                {
                    continue;
                }
            }
            if let Some(to) = parse_date_end(query.expires_to.as_deref())? {
                if !latest_license
                    .and_then(|license| license.expires_at)
                    .is_some_and(|expires_at| expires_at <= to)
                {
                    continue;
                }
            }

            let source = latest_order.map(|order| order.channel.clone());
            let plan = latest_order
                .map(|order| order.plan.clone())
                .or_else(|| latest_license.map(|license| license.plan.clone()));

            items.push(UserOperationItem {
                id: row.id,
                username: row.username,
                email: row.email,
                status: user_status_label(row.status).to_string(),
                plan,
                source,
                client_install_ids,
                machine_hashes,
                license_count: licenses.len(),
                order_no: latest_order.map(|order| order.order_no.clone()),
                amount_cents: latest_order.map(|order| order.amount_cents),
                paid_at: latest_order
                    .and_then(|order| order.paid_at.map(|value| value.with_timezone(&Utc))),
                created_at: row.created_at.with_timezone(&Utc),
                expires_at: latest_license
                    .and_then(|license| license.expires_at.map(|value| value.with_timezone(&Utc))),
            });
        }

        Ok((items, total, page, page_size))
    }

    pub async fn list_orders(
        &self,
        query: ListOrderQuery,
    ) -> Result<(Vec<OrderOperationItem>, u64, u64, u64), crate::AppError> {
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
        let mut stmt = order::Entity::find();

        if let Some(keyword) = trim_opt(&query.keyword) {
            stmt = stmt.filter(
                Condition::any()
                    .add(order::Column::OrderNo.contains(keyword.clone()))
                    .add(order::Column::ActivationCode.contains(keyword.clone()))
                    .add(order::Column::Channel.contains(keyword.clone()))
                    .add(order::Column::Status.contains(keyword.clone()))
                    .add(order::Column::MachineHash.contains(keyword)),
            );
        }
        if let Some(plan) = trim_opt(&query.plan) {
            stmt = stmt.filter(order::Column::Plan.eq(plan));
        }
        if let Some(tier) = trim_opt(&query.tier) {
            stmt = stmt.filter(order::Column::Tier.eq(tier));
        }
        if let Some(status) = trim_opt(&query.status) {
            stmt = stmt.filter(order::Column::Status.eq(status));
        }
        if let Some(hash) = trim_opt(&query.machine_hash) {
            stmt = stmt.filter(order::Column::MachineHash.contains(hash));
        }
        if let Some(from) = parse_date_start(query.paid_from.as_deref())? {
            stmt = stmt.filter(order::Column::PaidAt.gte(from));
        }
        if let Some(to) = parse_date_end(query.paid_to.as_deref())? {
            stmt = stmt.filter(order::Column::PaidAt.lte(to));
        }

        let paginator = stmt.paginate(&self.db, page_size);
        let total = paginator.num_items().await?;
        let rows = paginator.fetch_page(page - 1).await?;

        // 批量查询关联的 license，避免 N+1
        let license_ids: Vec<_> = rows.iter().filter_map(|r| r.license_id).collect();
        let licenses_map: std::collections::HashMap<uuid::Uuid, _> = if license_ids.is_empty() {
            std::collections::HashMap::new()
        } else {
            license::Entity::find()
                .filter(license::Column::Id.is_in(license_ids))
                .filter(license::Column::DeletedAt.is_null())
                .all(&self.db)
                .await?
                .into_iter()
                .map(|l| (l.id, l))
                .collect()
        };

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let license_model = row.license_id.and_then(|lid| licenses_map.get(&lid));
            if let Some(from) = parse_date_start(query.expires_from.as_deref())? {
                if !license_model
                    .and_then(|license| license.expires_at)
                    .is_some_and(|expires_at| expires_at >= from)
                {
                    continue;
                }
            }
            if let Some(to) = parse_date_end(query.expires_to.as_deref())? {
                if !license_model
                    .and_then(|license| license.expires_at)
                    .is_some_and(|expires_at| expires_at <= to)
                {
                    continue;
                }
            }

            items.push(OrderOperationItem {
                id: row.id.to_string(),
                order_no: row.order_no,
                tier: row.tier,
                plan: row.plan,
                channel: row.channel,
                status: row.status,
                machine_hash: row.machine_hash,
                activation_code: row.activation_code,
                amount_cents: row.amount_cents,
                paid_at: row.paid_at.map(|value| value.with_timezone(&Utc)),
                created_at: row.created_at.with_timezone(&Utc),
                updated_at: row.updated_at.with_timezone(&Utc),
                expires_at: license_model
                    .and_then(|license| license.expires_at.map(|value| value.with_timezone(&Utc))),
            });
        }

        Ok((items, total, page, page_size))
    }
}

fn user_status_label(status: i16) -> &'static str {
    match status {
        0 => "active",
        1 => "disabled",
        2 => "deleted",
        _ => "unknown",
    }
}

fn status_to_code(status: &str) -> Result<i16, ValidationError> {
    match status {
        "active" => Ok(0),
        "disabled" => Ok(1),
        "deleted" => Ok(2),
        _ => Err(ValidationError::custom(
            "status 必须是 active、disabled 或 deleted",
        )),
    }
}

fn to_license_item(
    row: license::Model,
    client_install_ids: Vec<String>,
    machine_hashes: Vec<String>,
    related_order: Option<order::Model>,
    related_batch: Option<license_batch::Model>,
) -> LicenseItem {
    let (order_no, order_channel, amount_cents, paid_at, plan) = if let Some(order) = related_order
    {
        (
            Some(order.order_no),
            Some(order.channel),
            Some(order.amount_cents),
            order.paid_at.map(|value| value.with_timezone(&Utc)),
            order.plan,
        )
    } else {
        (None, None, None, None, row.plan.clone())
    };
    let status = license_status(&row);

    LicenseItem {
        id: row.id.to_string(),
        activation_code: row.activation_code,
        tier: row.tier,
        plan,
        status,
        source_channel: row.source_channel,
        batch_id: row.batch_id.map(|id| id.to_string()),
        batch_name: related_batch.map(|batch| batch.batch_name),
        note: row.note,
        user_id: row.user_id,
        max_devices: row.max_devices,
        device_migration_limit: row.device_migration_limit,
        device_migration_count: row.device_migration_count,
        last_migrated_at: row.last_migrated_at.map(|value| value.with_timezone(&Utc)),
        is_revoked: row.is_revoked,
        client_install_ids,
        machine_hashes,
        order_no,
        order_channel,
        amount_cents,
        paid_at,
        created_at: row.created_at.with_timezone(&Utc),
        expires_at: row.expires_at.map(|value| value.with_timezone(&Utc)),
        activated_at: row.activated_at.map(|value| value.with_timezone(&Utc)),
    }
}

fn admin_product_catalog_from_rows(rows: Vec<product_catalog::Model>) -> AdminProductCatalogConfig {
    let plans = rows
        .iter()
        .filter(|item| item.kind == "plan")
        .map(|item| AdminPlanConfig {
            id: item.code.clone(),
            tier: item.tier.clone(),
            name: item.name.clone(),
            unit: item.unit.clone(),
            note: item.note.clone(),
            original_amount_cents: item
                .original_amount_cents
                .or(item.amount_cents)
                .unwrap_or_default(),
            discount_amount_cents: item.discount_amount_cents,
            discount_start_at: item
                .discount_start_at
                .map(|value| value.with_timezone(&Utc)),
            discount_end_at: item.discount_end_at.map(|value| value.with_timezone(&Utc)),
            discount_enabled: item.discount_enabled,
            is_active: item.is_active,
            sort_order: Some(item.sort_order),
        })
        .collect();
    let downloads = rows
        .into_iter()
        .filter(|item| item.kind == "download" && is_public_download_config(item))
        .map(|item| AdminDownloadConfig {
            code: item.code,
            platform: item.platform.unwrap_or_default(),
            name: item.name,
            chip: item.chip,
            file_name: item.file_name,
            href: item.href.unwrap_or_default(),
            is_active: item.is_active,
            sort_order: Some(item.sort_order),
        })
        .collect();

    AdminProductCatalogConfig { plans, downloads }
}

fn to_admin_app_version_item(row: app_version::Model) -> AdminAppVersionItem {
    AdminAppVersionItem {
        id: row.id.to_string(),
        platform: row.platform,
        version: row.version,
        min_app_version: row.min_app_version,
        download_url: row.download_url,
        download_url_mirror: row.download_url_mirror,
        release_notes: row.release_notes,
        force_update: row.force_update,
        is_active: row.is_active,
        created_at: row.created_at.with_timezone(&Utc),
        updated_at: row.updated_at.with_timezone(&Utc),
    }
}

async fn fill_app_version_active_model(
    mut active: app_version::ActiveModel,
    platform: Option<String>,
    version: String,
    min_app_version: Option<String>,
    download_url: String,
    download_url_mirror: Option<String>,
    release_notes: Option<String>,
    force_update: Option<bool>,
    is_active: Option<bool>,
    now: DateTime<Utc>,
    downloads_fs_path: &str,
) -> Result<app_version::ActiveModel, crate::AppError> {
    let version =
        trim_string(Some(version)).ok_or_else(|| ValidationError::custom("版本号不能为空"))?;
    validate_version_text(&version)?;

    let download_url = trim_string(Some(download_url))
        .ok_or_else(|| ValidationError::custom("下载链接不能为空"))?;
    if !is_supported_download_base(&download_url) {
        return Err(
            ValidationError::custom("下载链接必须是 http(s) 或 /v1/downloads/ 前缀").into(),
        );
    }

    validate_download_packages(&download_url, downloads_fs_path).await?;

    active.platform = Set(normalize_app_platform(platform));
    active.version = Set(version);
    active.min_app_version = Set(trim_string(min_app_version));
    active.download_url = Set(download_url);
    active.download_url_mirror = Set(trim_string(download_url_mirror));
    active.release_notes = Set(trim_string(release_notes));
    active.force_update = Set(force_update.unwrap_or(false));
    active.is_active = Set(is_active.unwrap_or(true));
    active.updated_at = Set(now.into());

    Ok(active)
}

async fn insert_admin_license_event<C>(
    db: &C,
    license_id: Uuid,
    activation_code: Option<String>,
    event_type: &'static str,
    status: &'static str,
    reason: Option<String>,
    expires_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    audit: &AdminAuditContext,
    target_id: Option<String>,
) -> Result<(), sea_orm::DbErr>
where
    C: sea_orm::ConnectionTrait,
{
    insert_admin_audit_event(
        db,
        Some(license_id),
        activation_code,
        event_type,
        status,
        reason,
        expires_at,
        audit,
        target_id,
    )
    .await
}

async fn insert_admin_audit_event<C>(
    db: &C,
    license_id: Option<Uuid>,
    activation_code: Option<String>,
    event_type: &'static str,
    status: &'static str,
    reason: Option<String>,
    expires_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    audit: &AdminAuditContext,
    target_id: Option<String>,
) -> Result<(), sea_orm::DbErr>
where
    C: sea_orm::ConnectionTrait,
{
    let now = Utc::now();
    license_event::ActiveModel {
        id: Set(Uuid::new_v4()),
        license_id: Set(license_id),
        lease_id: Set(None),
        activation_code: Set(activation_code),
        event_type: Set(event_type.to_string()),
        status: Set(status.to_string()),
        reason: Set(reason),
        ip_address: Set(audit.source_ip.clone()),
        machine_hash: Set(None),
        client_install_id: Set(None),
        platform: Set(Some("admin".to_string())),
        extension_version: Set(None),
        user_agent: Set(None),
        operator: Set(Some(audit.operator.clone())),
        target_id: Set(target_id),
        expires_at: Set(expires_at),
        created_at: Set(now.into()),
    }
    .insert(db)
    .await?;
    Ok(())
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

fn apply_license_status_filter(
    stmt: sea_orm::Select<license::Entity>,
    status: &str,
) -> sea_orm::Select<license::Entity> {
    match status {
        "pending" => stmt
            .filter(license::Column::IsRevoked.eq(false))
            .filter(license::Column::ActivatedAt.is_null()),
        "active" => stmt
            .filter(license::Column::IsRevoked.eq(false))
            .filter(license::Column::ActivatedAt.is_not_null())
            .filter(
                Condition::any()
                    .add(license::Column::ExpiresAt.is_null())
                    .add(license::Column::ExpiresAt.gte(Utc::now())),
            ),
        "expired" => stmt
            .filter(license::Column::IsRevoked.eq(false))
            .filter(license::Column::ExpiresAt.lt(Utc::now())),
        "revoked" => stmt.filter(license::Column::IsRevoked.eq(true)),
        _ => stmt,
    }
}

fn trim_opt(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn trim_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_app_platform(platform: Option<String>) -> String {
    platform
        .and_then(|value| trim_string(Some(value)))
        .map(|value| value.to_lowercase())
        .unwrap_or_else(|| "extension".to_string())
}

fn validate_version_text(version: &str) -> Result<(), ValidationError> {
    if version.len() > 32 {
        return Err(ValidationError::custom("版本号不能超过 32 个字符"));
    }
    if !version
        .chars()
        .all(|item| item.is_ascii_alphanumeric() || item == '.' || item == '-' || item == '_')
    {
        return Err(ValidationError::custom(
            "版本号只能包含英文、数字、点、短横线或下划线",
        ));
    }
    Ok(())
}

fn is_supported_download_base(href: &str) -> bool {
    href.starts_with("https://")
        || href.starts_with("http://")
        || href.starts_with("/v1/downloads/")
}

/// 把 /v1/downloads/ 本地下载前缀映射到文件系统路径。
///
/// - `/v1/downloads/` 开头的本地路径会映射到 `downloads_fs_path` 指定的目录。
/// - `http(s)://` 路径会发送 HEAD 请求检查。
async fn validate_download_packages(
    base_url: &str,
    downloads_fs_path: &str,
) -> Result<(), crate::AppError> {
    if base_url.ends_with(".zip") || base_url.ends_with(".crx") {
        let package_name = if base_url.ends_with(".crx") {
            "pubflow-extension.crx"
        } else {
            "pubflow-extension.zip"
        };
        return validate_download_package(base_url, downloads_fs_path, package_name, true).await;
    }

    const REQUIRED_PACKAGE_NAMES: [&str; 1] = ["pubflow-extension.zip"];
    const OPTIONAL_PACKAGE_NAMES: [&str; 1] = ["pubflow-extension.crx"];

    for name in REQUIRED_PACKAGE_NAMES {
        validate_download_package(base_url, downloads_fs_path, name, true).await?;
    }
    for name in OPTIONAL_PACKAGE_NAMES {
        validate_download_package(base_url, downloads_fs_path, name, false).await?;
    }

    Ok(())
}

async fn validate_download_package(
    base_url: &str,
    downloads_fs_path: &str,
    name: &str,
    required: bool,
) -> Result<(), crate::AppError> {
    let is_local = is_local_download_base(base_url);
    if is_local {
        if downloads_fs_path.is_empty() {
            return Err(ValidationError::custom(
                "未配置本地下载路径，请设置 DOWNLOADS_FS_PATH 或配置文件中的 downloads_fs_path",
            )
            .into());
        }
        let path = PathBuf::from(downloads_fs_path).join(name);
        let meta = match tokio::fs::metadata(&path).await {
            Ok(meta) => meta,
            Err(error) if !required && error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(());
            }
            Err(error) => {
                return Err(ValidationError::custom(format!(
                    "无法读取下载文件 {}：{}",
                    path.display(),
                    error
                ))
                .into());
            }
        };
        if meta.len() == 0 {
            return Err(
                ValidationError::custom(format!("下载文件 {} 大小为 0", path.display())).into(),
            );
        }
        return Ok(());
    }

    if base_url.starts_with("http://") || base_url.starts_with("https://") {
        let url = normalize_package_url(base_url, name);
        let client = reqwest::Client::new();
        let response = client
            .head(&url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;
        let response = match response {
            Ok(response)
                if response.status() == reqwest::StatusCode::METHOD_NOT_ALLOWED
                    || response.status() == reqwest::StatusCode::FORBIDDEN =>
            {
                client
                    .get(&url)
                    .header(reqwest::header::RANGE, "bytes=0-0")
                    .timeout(std::time::Duration::from_secs(10))
                    .send()
                    .await
            }
            other => other,
        };
        match response {
            Ok(response) if response.status().is_success() => {
                let content_length = response
                    .headers()
                    .get("content-length")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok());
                if content_length == Some(0) {
                    return Err(
                        ValidationError::custom(format!("下载链接 {} 文件大小为 0", url)).into(),
                    );
                }
            }
            Ok(response) if !required && response.status() == reqwest::StatusCode::NOT_FOUND => {
                return Ok(());
            }
            Ok(response) => {
                return Err(ValidationError::custom(format!(
                    "下载链接 {} 返回状态码 {}",
                    url,
                    response.status()
                ))
                .into());
            }
            Err(error) if !required => {
                tracing::warn!(url = %url, error = %error, "optional download package is not reachable");
                return Ok(());
            }
            Err(error) => {
                return Err(ValidationError::custom(format!("无法访问 {}：{}", url, error)).into());
            }
        }
    }

    Ok(())
}

fn is_local_download_base(base_url: &str) -> bool {
    base_url.starts_with("/v1/downloads/")
}

fn normalize_package_url(base_url: &str, name: &str) -> String {
    if base_url.ends_with(name) {
        return base_url.to_string();
    }
    if base_url.starts_with("http://") || base_url.starts_with("https://") {
        let base = base_url.trim_end_matches('/');
        format!("{base}/{name}")
    } else {
        format!("{base_url}/{name}").replace("//", "/")
    }
}

fn is_public_download_config(item: &product_catalog::Model) -> bool {
    item.platform.as_deref() == Some("extension")
        || item.code == "zip"
        || item.code == "crx"
        || item
            .file_name
            .as_deref()
            .is_some_and(|name| name.starts_with("pubflow-pro-native-"))
}

fn cents_to_yuan(amount_cents: i32) -> String {
    let yuan = amount_cents / 100;
    let cents = amount_cents.abs() % 100;
    if cents == 0 {
        yuan.to_string()
    } else {
        format!("{yuan}.{cents:02}")
    }
}

fn parse_date_start(value: Option<&str>) -> Result<Option<DateTime<Utc>>, ValidationError> {
    parse_date_bound(value, false)
}

fn parse_date_end(value: Option<&str>) -> Result<Option<DateTime<Utc>>, ValidationError> {
    parse_date_bound(value, true)
}

fn parse_date_bound(
    value: Option<&str>,
    end_of_day: bool,
) -> Result<Option<DateTime<Utc>>, ValidationError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| ValidationError::custom("日期格式必须是 YYYY-MM-DD"))?;
    let naive = if end_of_day {
        date.and_hms_opt(23, 59, 59)
    } else {
        date.and_hms_opt(0, 0, 0)
    }
    .ok_or_else(|| ValidationError::custom("日期无效"))?;
    Ok(Some(
        DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc).into(),
    ))
}
