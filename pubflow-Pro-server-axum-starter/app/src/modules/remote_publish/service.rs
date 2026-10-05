use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use entity::{license, remote_asset, remote_daily_usage, remote_job, remote_web_session};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DatabaseTransaction, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, TransactionTrait,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::dto::{AssetView, CreateJobRequest, JobView, QuotaView, SessionView};
use crate::shared::require_remote_publish;
use crate::{AppError, AppState, AuthError, PubFlowError, ValidationError};

pub const ACCESS_COOKIE: &str = "pubflow_remote_access";
pub const REFRESH_COOKIE: &str = "pubflow_remote_refresh";

#[derive(Debug)]
pub struct IssuedSession {
    pub view: SessionView,
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Clone)]
pub struct RemotePublishService {
    db: DatabaseConnection,
    config: crate::core::config::RemotePublishConfig,
    jwt_service: crate::shared::jwt::JwtService,
    quota_locks: Arc<Mutex<HashMap<Uuid, Arc<Mutex<()>>>>>,
}

impl RemotePublishService {
    pub fn from_state(state: &AppState) -> Self {
        Self {
            db: state.db.clone(),
            config: state.config.remote_publish.clone(),
            jwt_service: state.jwt_service.clone(),
            quota_locks: state.remote_quota_locks.clone(),
        }
    }

    pub fn secure_cookies(&self) -> bool {
        self.config.secure_cookies
    }

    pub async fn login(&self, activation_code: &str) -> Result<IssuedSession, AppError> {
        let code = activation_code.trim().to_ascii_uppercase();
        if code.len() < 12 || code.len() > 64 {
            return Err(AuthError::InvalidToken.into());
        }
        let license = license::Entity::find()
            .filter(license::Column::ActivationCode.eq(code))
            .filter(license::Column::DeletedAt.is_null())
            .one(&self.db)
            .await?
            .ok_or(AuthError::InvalidToken)?;
        self.ensure_license_active(&license)?;
        self.issue_session(&license, true).await
    }

    pub async fn refresh(&self, raw_refresh: &str) -> Result<IssuedSession, AppError> {
        let now = Utc::now();
        let refresh_hash = token_hash(raw_refresh);
        let session = remote_web_session::Entity::find()
            .filter(remote_web_session::Column::RefreshTokenHash.eq(refresh_hash))
            .filter(remote_web_session::Column::RevokedAt.is_null())
            .one(&self.db)
            .await?
            .ok_or(AuthError::InvalidToken)?;
        if session.refresh_expires_at.with_timezone(&Utc) <= now {
            self.revoke_session(session.id).await?;
            return Err(AuthError::InvalidToken.into());
        }
        let license = license::Entity::find_by_id(session.license_id)
            .one(&self.db)
            .await?
            .ok_or(AuthError::InvalidToken)?;
        self.ensure_license_active(&license)?;

        let access_token = random_token();
        let refresh_token = random_token();
        let access_expires_at =
            bounded_expiry(now, self.config.access_ttl_seconds, license.expires_at);
        let refresh_expires_at =
            bounded_expiry(now, self.config.refresh_ttl_seconds, license.expires_at);
        let mut active: remote_web_session::ActiveModel = session.into();
        active.access_token_hash = Set(token_hash(&access_token));
        active.refresh_token_hash = Set(token_hash(&refresh_token));
        active.access_expires_at = Set(access_expires_at.into());
        active.refresh_expires_at = Set(refresh_expires_at.into());
        active.last_seen_at = Set(now.into());
        active.updated_at = Set(now.into());
        active.update(&self.db).await?;
        Ok(IssuedSession {
            access_token,
            refresh_token,
            view: SessionView {
                license_expires_at: license.expires_at.map(|v| v.with_timezone(&Utc)),
                access_expires_at,
                refresh_expires_at,
            },
        })
    }

    async fn issue_session(
        &self,
        license: &license::Model,
        revoke_existing: bool,
    ) -> Result<IssuedSession, AppError> {
        let now = Utc::now();
        if revoke_existing {
            remote_web_session::Entity::update_many()
                .filter(remote_web_session::Column::LicenseId.eq(license.id))
                .filter(remote_web_session::Column::RevokedAt.is_null())
                .set(remote_web_session::ActiveModel {
                    revoked_at: Set(Some(now.into())),
                    updated_at: Set(now.into()),
                    ..Default::default()
                })
                .exec(&self.db)
                .await?;
        }
        let access_token = random_token();
        let refresh_token = random_token();
        let access_expires_at =
            bounded_expiry(now, self.config.access_ttl_seconds, license.expires_at);
        let refresh_expires_at =
            bounded_expiry(now, self.config.refresh_ttl_seconds, license.expires_at);
        remote_web_session::ActiveModel {
            id: Set(Uuid::new_v4()),
            license_id: Set(license.id),
            access_token_hash: Set(token_hash(&access_token)),
            access_expires_at: Set(access_expires_at.into()),
            refresh_token_hash: Set(token_hash(&refresh_token)),
            refresh_expires_at: Set(refresh_expires_at.into()),
            last_seen_at: Set(now.into()),
            revoked_at: Set(None),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&self.db)
        .await?;
        Ok(IssuedSession {
            access_token,
            refresh_token,
            view: SessionView {
                license_expires_at: license.expires_at.map(|v| v.with_timezone(&Utc)),
                access_expires_at,
                refresh_expires_at,
            },
        })
    }

    pub async fn authenticate_access(
        &self,
        raw_access: &str,
    ) -> Result<(remote_web_session::Model, license::Model), AppError> {
        let now = Utc::now();
        let session = remote_web_session::Entity::find()
            .filter(remote_web_session::Column::AccessTokenHash.eq(token_hash(raw_access)))
            .filter(remote_web_session::Column::RevokedAt.is_null())
            .one(&self.db)
            .await?
            .ok_or(AuthError::InvalidToken)?;
        if session.access_expires_at.with_timezone(&Utc) <= now {
            return Err(AuthError::InvalidToken.into());
        }
        let license = license::Entity::find_by_id(session.license_id)
            .one(&self.db)
            .await?
            .ok_or(AuthError::InvalidToken)?;
        self.ensure_license_active(&license)?;
        Ok((session, license))
    }

    pub async fn revoke_session(&self, id: Uuid) -> Result<(), AppError> {
        let now = Utc::now();
        remote_web_session::Entity::update_many()
            .filter(remote_web_session::Column::Id.eq(id))
            .set(remote_web_session::ActiveModel {
                revoked_at: Set(Some(now.into())),
                updated_at: Set(now.into()),
                ..Default::default()
            })
            .exec(&self.db)
            .await?;
        Ok(())
    }

    pub fn session_view(
        &self,
        session: &remote_web_session::Model,
        license: &license::Model,
    ) -> SessionView {
        SessionView {
            license_expires_at: license.expires_at.map(|v| v.with_timezone(&Utc)),
            access_expires_at: session.access_expires_at.with_timezone(&Utc),
            refresh_expires_at: session.refresh_expires_at.with_timezone(&Utc),
        }
    }

    pub async fn create_job(
        &self,
        license: &license::Model,
        mut req: CreateJobRequest,
    ) -> Result<(JobView, bool), AppError> {
        validate_request(&mut req)?;
        let quota_lock = {
            let mut locks = self.quota_locks.lock().await;
            locks
                .entry(license.id)
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _quota_guard = quota_lock.lock().await;
        if let Some(existing) = remote_job::Entity::find()
            .filter(remote_job::Column::LicenseId.eq(license.id))
            .filter(remote_job::Column::RequestId.eq(req.request_id.clone()))
            .one(&self.db)
            .await?
        {
            return Ok((self.job_view(existing, false, None).await?, false));
        }

        let declared_bytes = req.assets.iter().map(|a| a.size).sum::<i64>();
        let txn = self.db.begin().await?;
        self.reserve_quota(&txn, license, declared_bytes).await?;
        let now = Utc::now();
        let job_id = Uuid::new_v4();
        let project_id = Uuid::new_v4();
        let status = "uploading";
        let request_json = serde_json::to_string(&req)?;
        let platforms_json = serde_json::to_string(&req.platforms)?;
        let job = remote_job::ActiveModel {
            id: Set(job_id),
            license_id: Set(license.id),
            request_id: Set(req.request_id.clone()),
            project_id: Set(project_id),
            content_type: Set(req.content_type.clone()),
            title: Set(req.title.clone()),
            platforms_json: Set(platforms_json),
            request_json: Set(request_json),
            project_json: Set(None),
            publish_mode: Set(req.publish_mode.clone()),
            status: Set(status.to_string()),
            status_sequence: Set(0),
            declared_bytes: Set(declared_bytes),
            claimed_install_id: Set(None),
            claimed_at: Set(None),
            error: Set(None),
            completed_at: Set(None),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&txn)
        .await?;
        for descriptor in &req.assets {
            remote_asset::ActiveModel {
                id: Set(Uuid::new_v4()),
                job_id: Set(job_id),
                role: Set(descriptor.role.clone()),
                file_name: Set(descriptor.file_name.clone()),
                content_type: Set(descriptor.content_type.clone()),
                declared_size: Set(descriptor.size),
                sha256: Set(descriptor.sha256.clone()),
                storage_path: Set(None),
                status: Set("pending".to_string()),
                created_at: Set(now.into()),
                committed_at: Set(None),
            }
            .insert(&txn)
            .await?;
        }
        txn.commit().await?;
        Ok((self.job_view(job, false, None).await?, true))
    }

    async fn reserve_quota(
        &self,
        txn: &DatabaseTransaction,
        license: &license::Model,
        bytes: i64,
    ) -> Result<(), AppError> {
        let date = Utc::now().date_naive();
        let job_limit = license
            .remote_daily_job_limit
            .unwrap_or(self.config.daily_job_limit);
        let byte_limit = license
            .remote_daily_byte_limit
            .unwrap_or(self.config.daily_byte_limit);
        let existing = remote_daily_usage::Entity::find_by_id((license.id, date))
            .one(txn)
            .await?;
        let jobs_used = existing.as_ref().map_or(0, |v| v.job_count);
        let bytes_used = existing.as_ref().map_or(0, |v| v.byte_count);
        if jobs_used >= job_limit || bytes > byte_limit.saturating_sub(bytes_used) {
            return Err(PubFlowError::RemoteQuotaExceeded.into());
        }
        let now = Utc::now();
        if let Some(usage) = existing {
            let mut active: remote_daily_usage::ActiveModel = usage.into();
            active.job_count = Set(jobs_used + 1);
            active.byte_count = Set(bytes_used + bytes);
            active.updated_at = Set(now.into());
            active.update(txn).await?;
        } else {
            remote_daily_usage::ActiveModel {
                license_id: Set(license.id),
                usage_date: Set(date),
                job_count: Set(1),
                byte_count: Set(bytes),
                updated_at: Set(now.into()),
            }
            .insert(txn)
            .await?;
        }
        Ok(())
    }

    pub async fn quota(&self, license: &license::Model) -> Result<QuotaView, AppError> {
        let date = Utc::now().date_naive();
        let usage = remote_daily_usage::Entity::find_by_id((license.id, date))
            .one(&self.db)
            .await?;
        let jobs_used = usage.as_ref().map_or(0, |v| v.job_count);
        let bytes_used = usage.as_ref().map_or(0, |v| v.byte_count);
        let job_limit = license
            .remote_daily_job_limit
            .unwrap_or(self.config.daily_job_limit);
        let byte_limit = license
            .remote_daily_byte_limit
            .unwrap_or(self.config.daily_byte_limit);
        Ok(QuotaView {
            date,
            job_limit,
            jobs_used,
            jobs_remaining: (job_limit - jobs_used).max(0),
            byte_limit,
            bytes_used,
            bytes_remaining: (byte_limit - bytes_used).max(0),
        })
    }

    pub async fn set_quota_override(
        &self,
        license_id: Uuid,
        job_limit: Option<i32>,
        byte_limit: Option<i64>,
    ) -> Result<QuotaView, AppError> {
        if job_limit.is_some_and(|value| value <= 0) || byte_limit.is_some_and(|value| value <= 0) {
            return Err(ValidationError::custom(
                "License 额度覆盖值必须大于 0，传 null 可恢复默认值",
            )
            .into());
        }
        let license = license::Entity::find_by_id(license_id)
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::LicenseNotFound)?;
        let mut active: license::ActiveModel = license.into();
        active.remote_daily_job_limit = Set(job_limit);
        active.remote_daily_byte_limit = Set(byte_limit);
        active.updated_at = Set(Utc::now().into());
        let updated = active.update(&self.db).await?;
        self.quota(&updated).await
    }

    pub async fn owned_asset(
        &self,
        license_id: Uuid,
        job_id: Uuid,
        asset_id: Uuid,
    ) -> Result<(remote_job::Model, remote_asset::Model), AppError> {
        let job = remote_job::Entity::find_by_id(job_id)
            .filter(remote_job::Column::LicenseId.eq(license_id))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::RemoteJobNotFound)?;
        let asset = remote_asset::Entity::find_by_id(asset_id)
            .filter(remote_asset::Column::JobId.eq(job_id))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::RemoteAssetNotFound)?;
        Ok((job, asset))
    }

    pub fn pending_asset_path(
        &self,
        license_id: Uuid,
        job_id: Uuid,
        asset_id: Uuid,
    ) -> (PathBuf, PathBuf) {
        let dir = Path::new(&self.config.storage_path)
            .join(license_id.to_string())
            .join(job_id.to_string());
        (
            dir.join(format!("{asset_id}.part")),
            dir.join(format!("{asset_id}.blob")),
        )
    }

    pub async fn commit_asset(
        &self,
        asset: remote_asset::Model,
        final_path: &Path,
    ) -> Result<(), AppError> {
        let mut active: remote_asset::ActiveModel = asset.into();
        active.storage_path = Set(Some(final_path.to_string_lossy().into_owned()));
        active.status = Set("uploaded".to_string());
        active.committed_at = Set(Some(Utc::now().into()));
        active.update(&self.db).await?;
        Ok(())
    }

    pub async fn complete_job(&self, license_id: Uuid, job_id: Uuid) -> Result<JobView, AppError> {
        let job = remote_job::Entity::find_by_id(job_id)
            .filter(remote_job::Column::LicenseId.eq(license_id))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::RemoteJobNotFound)?;
        if job.status == "queued" {
            return self.job_view(job, false, None).await;
        }
        if job.status != "uploading" {
            return Err(PubFlowError::InvalidRemoteJobState.into());
        }
        let assets = remote_asset::Entity::find()
            .filter(remote_asset::Column::JobId.eq(job.id))
            .all(&self.db)
            .await?;
        if assets.iter().any(|asset| asset.status != "uploaded") {
            return Err(ValidationError::custom("仍有素材未上传完成").into());
        }
        let req: CreateJobRequest = serde_json::from_str(&job.request_json)?;
        let manifest = build_project_manifest(&job, &req, &assets);
        let mut active: remote_job::ActiveModel = job.into();
        active.project_json = Set(Some(serde_json::to_string(&manifest)?));
        active.status = Set("queued".to_string());
        active.status_sequence = Set(1);
        active.updated_at = Set(Utc::now().into());
        let updated = active.update(&self.db).await?;
        self.job_view(updated, false, None).await
    }

    pub async fn get_job(&self, license_id: Uuid, job_id: Uuid) -> Result<JobView, AppError> {
        let job = remote_job::Entity::find_by_id(job_id)
            .filter(remote_job::Column::LicenseId.eq(license_id))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::RemoteJobNotFound)?;
        self.job_view(job, false, None).await
    }

    pub async fn list_jobs(&self, license_id: Uuid) -> Result<Vec<JobView>, AppError> {
        let jobs = remote_job::Entity::find()
            .filter(remote_job::Column::LicenseId.eq(license_id))
            .order_by_desc(remote_job::Column::CreatedAt)
            .limit(50)
            .all(&self.db)
            .await?;
        let mut views = Vec::with_capacity(jobs.len());
        for job in jobs {
            views.push(self.job_view(job, false, None).await?);
        }
        Ok(views)
    }

    pub async fn job_view(
        &self,
        job: remote_job::Model,
        include_downloads: bool,
        install_id: Option<&str>,
    ) -> Result<JobView, AppError> {
        let assets = remote_asset::Entity::find()
            .filter(remote_asset::Column::JobId.eq(job.id))
            .all(&self.db)
            .await?;
        let asset_views = assets
            .into_iter()
            .map(|asset| AssetView {
                asset_id: asset.id.to_string(),
                role: asset.role,
                file_name: asset.file_name,
                content_type: asset.content_type,
                size: asset.declared_size,
                sha256: asset.sha256,
                status: asset.status,
                download_url: if include_downloads {
                    install_id.map(|_| format!("/v1/remote/assets/{}", asset.id))
                } else {
                    None
                },
            })
            .collect();
        Ok(JobView {
            job_id: job.id.to_string(),
            project_id: job.project_id.to_string(),
            request_id: job.request_id,
            content_type: job.content_type,
            title: job.title,
            platforms: serde_json::from_str(&job.platforms_json).unwrap_or_default(),
            publish_mode: job.publish_mode,
            status: job.status,
            status_sequence: job.status_sequence,
            declared_bytes: job.declared_bytes,
            assets: asset_views,
            error: job.error,
            created_at: job.created_at.with_timezone(&Utc),
            updated_at: job.updated_at.with_timezone(&Utc),
        })
    }

    pub async fn count_jobs(&self, license_id: Uuid) -> Result<u64, AppError> {
        Ok(remote_job::Entity::find()
            .filter(remote_job::Column::LicenseId.eq(license_id))
            .count(&self.db)
            .await?)
    }

    pub async fn cleanup_expired(&self) -> Result<(), AppError> {
        let now = Utc::now();
        remote_web_session::Entity::delete_many()
            .filter(remote_web_session::Column::RefreshExpiresAt.lt(now))
            .exec(&self.db)
            .await?;
        let stale_uploads = remote_job::Entity::find()
            .filter(remote_job::Column::Status.eq("uploading"))
            .filter(
                remote_job::Column::CreatedAt
                    .lt(now - Duration::hours(self.config.unclaimed_retention_hours)),
            )
            .all(&self.db)
            .await?;
        let retained_cutoff = now - Duration::days(self.config.job_retention_days);
        let retained = remote_job::Entity::find()
            .filter(remote_job::Column::Status.is_in(["completed", "failed", "cancelled"]))
            .filter(remote_job::Column::CreatedAt.lt(retained_cutoff))
            .all(&self.db)
            .await?;
        for job in stale_uploads.into_iter().chain(retained) {
            let assets = remote_asset::Entity::find()
                .filter(remote_asset::Column::JobId.eq(job.id))
                .all(&self.db)
                .await?;
            for asset in assets {
                if let Some(path) = asset.storage_path {
                    let _ = tokio::fs::remove_file(path).await;
                }
            }
            remote_job::Entity::delete_by_id(job.id)
                .exec(&self.db)
                .await?;
        }
        Ok(())
    }

    pub async fn next_queued(&self, license_id: Uuid) -> Result<Option<JobView>, AppError> {
        let job = remote_job::Entity::find()
            .filter(remote_job::Column::LicenseId.eq(license_id))
            .filter(remote_job::Column::Status.eq("queued"))
            .order_by_asc(remote_job::Column::CreatedAt)
            .one(&self.db)
            .await?;
        match job {
            Some(job) => Ok(Some(self.job_view(job, false, None).await?)),
            None => Ok(None),
        }
    }

    pub async fn claim_job(
        &self,
        license_id: Uuid,
        install_id: &str,
        job_id: Uuid,
    ) -> Result<Value, AppError> {
        let job = remote_job::Entity::find_by_id(job_id)
            .filter(remote_job::Column::LicenseId.eq(license_id))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::RemoteJobNotFound)?;
        if job.status != "queued"
            && !(job.status == "claimed" && job.claimed_install_id.as_deref() == Some(install_id))
        {
            return Err(PubFlowError::InvalidRemoteJobState.into());
        }
        let job = if job.status == "queued" {
            let mut active: remote_job::ActiveModel = job.into();
            active.status = Set("claimed".to_string());
            active.status_sequence = Set(2);
            active.claimed_install_id = Set(Some(install_id.to_string()));
            active.claimed_at = Set(Some(Utc::now().into()));
            active.updated_at = Set(Utc::now().into());
            active.update(&self.db).await?
        } else {
            job
        };
        let assets = remote_asset::Entity::find()
            .filter(remote_asset::Column::JobId.eq(job.id))
            .all(&self.db)
            .await?;
        let asset_values = assets.into_iter().map(|asset| {
            let ticket = self.asset_ticket(&job, &asset, install_id)?;
            Ok(json!({
                "assetId": asset.id.to_string(), "role": asset.role, "fileName": asset.file_name,
                "contentType": asset.content_type, "size": asset.declared_size, "sha256": asset.sha256,
                "downloadUrl": format!("/v1/remote/assets/{}?ticket={}", asset.id, ticket)
            }))
        }).collect::<Result<Vec<Value>, AppError>>()?;
        Ok(json!({
            "jobId": job.id.to_string(), "projectId": job.project_id.to_string(), "statusSequence": job.status_sequence,
            "publishMode": job.publish_mode, "platforms": serde_json::from_str::<Value>(&job.platforms_json).unwrap_or(json!([])),
            "project": job.project_json.as_deref().and_then(|v| serde_json::from_str::<Value>(v).ok()).unwrap_or(Value::Null),
            "assets": asset_values
        }))
    }

    pub async fn update_job_status(
        &self,
        license_id: Uuid,
        install_id: &str,
        message: super::dto::JobStatusMessage,
    ) -> Result<JobView, AppError> {
        let job_id =
            Uuid::parse_str(&message.job_id).map_err(|_| ValidationError::custom("jobId 无效"))?;
        let job = remote_job::Entity::find_by_id(job_id)
            .filter(remote_job::Column::LicenseId.eq(license_id))
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::RemoteJobNotFound)?;
        if job.claimed_install_id.as_deref() != Some(install_id) {
            return Err(PubFlowError::InvalidRemoteJobState.into());
        }
        if message.status_sequence <= job.status_sequence {
            return Err(PubFlowError::InvalidRemoteJobState.into());
        }
        if !matches!(
            message.status.as_str(),
            "accepted" | "materialized" | "running" | "completed" | "failed" | "cancelled"
        ) {
            return Err(ValidationError::custom("远程任务状态无效").into());
        }
        let terminal = matches!(
            message.status.as_str(),
            "completed" | "failed" | "cancelled"
        );
        let mut active: remote_job::ActiveModel = job.into();
        active.status = Set(message.status);
        active.status_sequence = Set(message.status_sequence);
        active.error = Set(message.error);
        active.updated_at = Set(Utc::now().into());
        if terminal {
            active.completed_at = Set(Some(Utc::now().into()));
        }
        let updated = active.update(&self.db).await?;
        self.job_view(updated, false, None).await
    }

    pub async fn project_materialized(
        &self,
        license_id: Uuid,
        install_id: &str,
        job_id: Uuid,
        sequence: i64,
    ) -> Result<JobView, AppError> {
        let view = self
            .update_job_status(
                license_id,
                install_id,
                super::dto::JobStatusMessage {
                    job_id: job_id.to_string(),
                    status: "materialized".to_string(),
                    status_sequence: sequence,
                    error: None,
                },
            )
            .await?;
        let assets = remote_asset::Entity::find()
            .filter(remote_asset::Column::JobId.eq(job_id))
            .all(&self.db)
            .await?;
        for asset in assets {
            if let Some(path) = asset.storage_path.as_deref() {
                let _ = tokio::fs::remove_file(path).await;
            }
            let mut active: remote_asset::ActiveModel = asset.into();
            active.status = Set("materialized".to_string());
            active.storage_path = Set(None);
            active.update(&self.db).await?;
        }
        Ok(view)
    }

    pub async fn release_unmaterialized_claims(
        &self,
        license_id: Uuid,
        install_id: &str,
    ) -> Result<(), AppError> {
        let now = Utc::now();
        remote_job::Entity::update_many()
            .filter(remote_job::Column::LicenseId.eq(license_id))
            .filter(remote_job::Column::ClaimedInstallId.eq(install_id))
            .filter(remote_job::Column::Status.eq("claimed"))
            .set(remote_job::ActiveModel {
                status: Set("queued".to_string()),
                status_sequence: Set(1),
                claimed_install_id: Set(None),
                claimed_at: Set(None),
                updated_at: Set(now.into()),
                ..Default::default()
            })
            .exec(&self.db)
            .await?;
        Ok(())
    }

    pub async fn download_asset_with_ticket(
        &self,
        asset_id: Uuid,
        ticket: &str,
    ) -> Result<(remote_asset::Model, PathBuf), AppError> {
        let claims = self
            .jwt_service
            .verify_token_custom(ticket)
            .map_err(|_| AuthError::InvalidToken)?;
        if claims.get("kind").and_then(Value::as_str) != Some("remote_asset")
            || claims.get("asset_id").and_then(Value::as_str) != Some(asset_id.to_string().as_str())
        {
            return Err(AuthError::InvalidToken.into());
        }
        let asset = remote_asset::Entity::find_by_id(asset_id)
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::RemoteAssetNotFound)?;
        let job = remote_job::Entity::find_by_id(asset.job_id)
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::RemoteJobNotFound)?;
        if claims.get("license_id").and_then(Value::as_str)
            != Some(job.license_id.to_string().as_str())
            || claims.get("install_id").and_then(Value::as_str) != job.claimed_install_id.as_deref()
        {
            return Err(AuthError::InvalidToken.into());
        }
        let path = asset
            .storage_path
            .as_deref()
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .ok_or(PubFlowError::RemoteAssetNotFound)?;
        Ok((asset, path))
    }

    fn asset_ticket(
        &self,
        job: &remote_job::Model,
        asset: &remote_asset::Model,
        install_id: &str,
    ) -> Result<String, AppError> {
        self.jwt_service.generate_token_with_claims(&json!({
            "kind": "remote_asset", "asset_id": asset.id.to_string(), "license_id": job.license_id.to_string(), "install_id": install_id
        }), self.config.asset_ticket_ttl_seconds).map_err(|_| PubFlowError::Internal("生成素材下载票据失败".to_string()).into())
    }

    fn ensure_license_active(&self, license: &license::Model) -> Result<(), AppError> {
        if license.deleted_at.is_some() || license.is_revoked {
            return Err(PubFlowError::LicenseRevoked.into());
        }
        if license
            .expires_at
            .is_some_and(|v| v.with_timezone(&Utc) <= Utc::now())
        {
            return Err(PubFlowError::LicenseExpired.into());
        }
        require_remote_publish(&license.tier)?;
        Ok(())
    }
}

fn validate_request(req: &mut CreateJobRequest) -> Result<(), AppError> {
    req.request_id = req.request_id.trim().to_string();
    req.title = req.title.trim().to_string();
    if req.request_id.is_empty() || req.request_id.len() > 128 {
        return Err(ValidationError::custom("requestId 必须为 1-128 个字符").into());
    }
    if req.title.is_empty() || req.title.chars().count() > 200 {
        return Err(ValidationError::custom("title 必须为 1-200 个字符").into());
    }
    if !matches!(req.content_type.as_str(), "video" | "image" | "article") {
        return Err(ValidationError::custom("contentType 仅支持 video/image/article").into());
    }
    if !matches!(req.publish_mode.as_str(), "fill_only" | "auto_submit") {
        return Err(ValidationError::custom("publishMode 仅支持 fill_only/auto_submit").into());
    }
    if req.platforms.is_empty() {
        return Err(ValidationError::custom("至少选择一个发布平台").into());
    }
    req.platforms.sort();
    req.platforms.dedup();
    const PLATFORMS: &[&str] = &[
        "douyin",
        "xiaohongshu",
        "weixinChannels",
        "bilibili",
        "kuaishou",
        "weibo",
        "zhihu",
        "xigua",
        "x",
        "youtube",
    ];
    if req
        .platforms
        .iter()
        .any(|p| !PLATFORMS.contains(&p.as_str()))
    {
        return Err(ValidationError::custom("包含不支持的平台").into());
    }
    if req.description.chars().count() > 10_000 {
        return Err(ValidationError::custom("description 不能超过 10000 个字符").into());
    }
    if req.content_type == "article"
        && req
            .article_content
            .as_deref()
            .is_none_or(|v| v.trim().is_empty())
    {
        return Err(ValidationError::custom("文章正文不能为空").into());
    }
    let mut video_count = 0;
    let mut image_count = 0;
    for asset in &mut req.assets {
        asset.file_name = Path::new(asset.file_name.trim())
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_string();
        asset.role = asset.role.trim().to_ascii_lowercase();
        asset.sha256 = asset.sha256.trim().to_ascii_lowercase();
        if asset.file_name.is_empty()
            || asset.file_name.len() > 255
            || asset.size <= 0
            || asset.sha256.len() != 64
            || !asset.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(ValidationError::custom("素材名称、长度或 SHA-256 无效").into());
        }
        match asset.role.as_str() {
            "video" => video_count += 1,
            "image" => image_count += 1,
            "cover" | "music" => {}
            _ => {
                return Err(
                    ValidationError::custom("素材 role 仅支持 video/image/cover/music").into(),
                );
            }
        }
    }
    if req.content_type == "video" && video_count != 1 {
        return Err(ValidationError::custom("视频任务必须包含一个 video 素材").into());
    }
    if req.content_type == "image" && image_count == 0 {
        return Err(ValidationError::custom("图文任务至少包含一个 image 素材").into());
    }
    Ok(())
}

fn build_project_manifest(
    job: &remote_job::Model,
    req: &CreateJobRequest,
    assets: &[remote_asset::Model],
) -> Value {
    let name = |role: &str| {
        assets
            .iter()
            .find(|a| a.role == role)
            .map(|a| a.file_name.clone())
            .unwrap_or_default()
    };
    let size = |role: &str| {
        assets
            .iter()
            .find(|a| a.role == role)
            .map(|a| a.declared_size)
            .unwrap_or(0)
    };
    let image_names = assets
        .iter()
        .filter(|a| a.role == "image")
        .map(|a| a.file_name.clone())
        .collect::<Vec<_>>();
    let now = Utc::now();
    let platform_statuses = req
        .platforms
        .iter()
        .map(|platform| json!({"platformId": platform, "status": "pending"}))
        .collect::<Vec<_>>();
    json!({
        "version": 2, "id": job.project_id.to_string(), "updatedAt": now.to_rfc3339(), "deletedAt": Value::Null,
        "video": {
            "contentType": req.content_type, "id": job.project_id.to_string(), "title": req.title, "description": req.description,
            "articleContent": req.article_content, "topics": req.topics, "campaignIds": req.campaign_ids, "projectId": job.project_id.to_string(),
            "videoCacheId": "", "coverCacheId": "", "imageCacheIds": [], "videoFileName": name("video"), "coverFileName": name("cover"),
            "musicFileName": name("music"), "musicName": name("music"), "imageFileNames": image_names,
            "videoSize": size("video"), "coverSize": size("cover"), "musicSize": size("music"), "scheduledAt": req.scheduled_at.unwrap_or(0),
            "visibility": req.visibility, "originalDeclare": req.original_declare, "platformSettings": req.platform_settings,
            "fillOptions": req.fill_options, "platforms": platform_statuses, "createdAt": now.timestamp_millis(), "updatedAt": now.timestamp_millis()
        },
        "records": [], "articleContent": req.article_content
    })
}

fn random_token() -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>())
}

fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn bounded_expiry(
    now: DateTime<Utc>,
    ttl_seconds: i64,
    license_expiry: Option<chrono::DateTime<chrono::FixedOffset>>,
) -> DateTime<Utc> {
    let desired = now + Duration::seconds(ttl_seconds);
    license_expiry
        .map(|v| v.with_timezone(&Utc))
        .map_or(desired, |expiry| desired.min(expiry))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::config::RemotePublishConfig;
    use crate::shared::jwt::JwtService;
    use sea_orm::{ConnectionTrait, Database};

    async fn create_test_schema(db: &DatabaseConnection) {
        let statements = [
            r#"CREATE TABLE licenses (
                id TEXT PRIMARY KEY, user_id INTEGER, activation_code TEXT NOT NULL UNIQUE,
                tier TEXT NOT NULL, plan TEXT NOT NULL, source_channel TEXT NOT NULL,
                batch_id TEXT, note TEXT, max_devices INTEGER NOT NULL,
                remote_daily_job_limit INTEGER, remote_daily_byte_limit INTEGER,
                device_migration_limit INTEGER NOT NULL, device_migration_count INTEGER NOT NULL,
                last_migrated_at TEXT, activated_at TEXT, expires_at TEXT,
                is_revoked BOOLEAN NOT NULL, deleted_at TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )"#,
            r#"CREATE TABLE remote_web_sessions (
                id TEXT PRIMARY KEY, license_id TEXT NOT NULL,
                access_token_hash TEXT NOT NULL UNIQUE, access_expires_at TEXT NOT NULL,
                refresh_token_hash TEXT NOT NULL UNIQUE, refresh_expires_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL, revoked_at TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )"#,
            r#"CREATE TABLE remote_jobs (
                id TEXT PRIMARY KEY, license_id TEXT NOT NULL, request_id TEXT NOT NULL,
                project_id TEXT NOT NULL, content_type TEXT NOT NULL, title TEXT NOT NULL,
                platforms_json TEXT NOT NULL, request_json TEXT NOT NULL, project_json TEXT,
                publish_mode TEXT NOT NULL, status TEXT NOT NULL, status_sequence INTEGER NOT NULL,
                declared_bytes INTEGER NOT NULL, claimed_install_id TEXT, claimed_at TEXT,
                error TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                UNIQUE (license_id, request_id)
            )"#,
            r#"CREATE TABLE remote_assets (
                id TEXT PRIMARY KEY, job_id TEXT NOT NULL, role TEXT NOT NULL,
                file_name TEXT NOT NULL, content_type TEXT, declared_size INTEGER NOT NULL,
                sha256 TEXT NOT NULL, storage_path TEXT, status TEXT NOT NULL,
                created_at TEXT NOT NULL, committed_at TEXT
            )"#,
            r#"CREATE TABLE remote_daily_usage (
                license_id TEXT NOT NULL, usage_date TEXT NOT NULL,
                job_count INTEGER NOT NULL, byte_count INTEGER NOT NULL,
                updated_at TEXT NOT NULL, PRIMARY KEY (license_id, usage_date)
            )"#,
        ];
        for statement in statements {
            db.execute_unprepared(statement)
                .await
                .expect("create remote publish test table");
        }
    }

    async fn test_service() -> (RemotePublishService, license::Model) {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("sqlite memory db");
        create_test_schema(&db).await;
        let now = Utc::now();
        let license = license::ActiveModel {
            id: Set(Uuid::new_v4()),
            user_id: Set(None),
            activation_code: Set(format!("PF-REMOTE-{}", Uuid::new_v4()).to_ascii_uppercase()),
            tier: Set("pro".to_string()),
            plan: Set("monthly".to_string()),
            source_channel: Set("test".to_string()),
            batch_id: Set(None),
            note: Set(None),
            max_devices: Set(1),
            remote_daily_job_limit: Set(None),
            remote_daily_byte_limit: Set(None),
            device_migration_limit: Set(3),
            device_migration_count: Set(0),
            last_migrated_at: Set(None),
            activated_at: Set(Some(now.into())),
            expires_at: Set(Some((now + Duration::days(30)).into())),
            is_revoked: Set(false),
            deleted_at: Set(None),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
        }
        .insert(&db)
        .await
        .expect("insert license");
        let config = RemotePublishConfig {
            daily_job_limit: 3,
            daily_byte_limit: 100,
            secure_cookies: false,
            ..RemotePublishConfig::default()
        };
        (
            RemotePublishService {
                db,
                config,
                jwt_service: JwtService::new("remote-publish-test-jwt-secret".to_string()),
                quota_locks: Arc::new(Mutex::new(HashMap::new())),
            },
            license,
        )
    }

    fn video_request(request_id: &str, bytes: i64) -> CreateJobRequest {
        CreateJobRequest {
            request_id: request_id.to_string(),
            content_type: "video".to_string(),
            title: "Remote video".to_string(),
            description: String::new(),
            article_content: None,
            topics: vec![],
            campaign_ids: vec![],
            platforms: vec!["douyin".to_string()],
            scheduled_at: None,
            visibility: "public".to_string(),
            original_declare: false,
            platform_settings: Default::default(),
            fill_options: None,
            assets: vec![super::super::dto::AssetDescriptor {
                role: "video".to_string(),
                file_name: "video.mp4".to_string(),
                content_type: Some("video/mp4".to_string()),
                size: bytes,
                sha256: "0".repeat(64),
            }],
            publish_mode: "fill_only".to_string(),
        }
    }

    #[test]
    fn publish_mode_accepts_fill_only_and_auto_submit() {
        let mut fill_only = video_request("fill-only", 1);
        assert!(validate_request(&mut fill_only).is_ok());

        let mut auto_submit = video_request("auto-submit", 1);
        auto_submit.publish_mode = "auto_submit".to_string();
        assert!(validate_request(&mut auto_submit).is_ok());

        let mut invalid = video_request("invalid", 1);
        invalid.publish_mode = "immediate".to_string();
        assert!(validate_request(&mut invalid).is_err());
    }

    #[tokio::test]
    async fn job_idempotency_reserves_quota_once_and_enforces_limits() {
        let (service, license) = test_service().await;

        let (first, created) = service
            .create_job(&license, video_request("request-1", 25))
            .await
            .expect("create first job");
        assert!(created);
        let (duplicate, created) = service
            .create_job(&license, video_request("request-1", 25))
            .await
            .expect("return idempotent job");
        assert!(!created);
        assert_eq!(duplicate.job_id, first.job_id);

        service
            .create_job(&license, video_request("request-2", 25))
            .await
            .expect("create second job");
        service
            .create_job(&license, video_request("request-3", 25))
            .await
            .expect("create third job");
        assert!(
            service
                .create_job(&license, video_request("request-4", 1))
                .await
                .is_err()
        );

        let quota = service.quota(&license).await.expect("read quota");
        assert_eq!(quota.jobs_used, 3);
        assert_eq!(quota.bytes_used, 75);
        assert_eq!(quota.jobs_remaining, 0);
        assert!(
            service
                .create_job(&license, video_request("too-large", 101))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn login_and_refresh_rotate_page_session_tokens() {
        let (service, license) = test_service().await;
        let first = service
            .login(&license.activation_code)
            .await
            .expect("first login");
        let second = service
            .login(&license.activation_code)
            .await
            .expect("second login");
        assert!(
            service
                .authenticate_access(&first.access_token)
                .await
                .is_err()
        );
        assert!(
            service
                .authenticate_access(&second.access_token)
                .await
                .is_ok()
        );

        let rotated = service
            .refresh(&second.refresh_token)
            .await
            .expect("rotate refresh token");
        assert!(service.refresh(&second.refresh_token).await.is_err());
        assert!(
            service
                .authenticate_access(&second.access_token)
                .await
                .is_err()
        );
        assert!(
            service
                .authenticate_access(&rotated.access_token)
                .await
                .is_ok()
        );
    }
}
