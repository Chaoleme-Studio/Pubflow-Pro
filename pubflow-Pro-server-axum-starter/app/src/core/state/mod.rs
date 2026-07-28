mod runtime;

pub use runtime::AppStateConfig;

use crate::{
    AppConfig, AppError, ValidationError,
    core::config::parse_jwt_previous_secrets,
    shared::{RemoteTransferLimiter, jwt::JwtService},
};
use deadpool_redis::Pool as RedisPool;
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, mpsc, oneshot};
use uuid::Uuid;

#[derive(Debug)]
pub struct RemoteProbeRequest {
    pub test_id: Uuid,
    pub requested_at: std::time::Instant,
    pub response: oneshot::Sender<RemoteProbeResult>,
}

#[derive(Debug)]
pub struct RemoteProbeResult {
    pub latency_ms: u64,
    pub extension_version: Option<String>,
}

#[derive(Debug)]
pub struct RemoteExtensionConnection {
    pub connection_id: Uuid,
    pub cancel: oneshot::Sender<()>,
    pub probe_sender: mpsc::Sender<RemoteProbeRequest>,
    pub job_sender: mpsc::Sender<()>,
}

/// 应用程序运行时状态
///
/// 包含应用程序在运行时需要的所有共享资源，如数据库连接、Redis 连接池和配置。
/// 通过 Axum 的 State 提取器传递给每个处理器。
#[derive(Debug, Clone)]
pub struct AppState {
    /// 数据库连接
    pub db: DatabaseConnection,

    /// Redis 连接池（可选）
    pub redis: Option<RedisPool>,

    /// JWT 服务
    pub jwt_service: JwtService,

    /// 应用状态配置
    pub config: AppStateConfig,

    /// 每个 License 只保留一个插件长连接；新连接会通知旧连接退出。
    pub remote_connections: Arc<Mutex<HashMap<Uuid, RemoteExtensionConnection>>>,

    pub remote_quota_locks: Arc<Mutex<HashMap<Uuid, Arc<Mutex<()>>>>>,

    /// 所有远程素材上传和下载共享的带宽与并发限制。
    pub remote_transfer_limiter: Arc<RemoteTransferLimiter>,
}

impl AppState {
    /// 初始化应用状态
    ///
    /// 根据应用配置创建数据库连接池和运行时状态。
    ///
    /// # 参数
    ///
    /// * `app_config` - 应用配置对象
    ///
    /// # 返回值
    ///
    /// 成功返回初始化后的应用状态，失败返回应用错误
    ///
    /// # 异步
    ///
    /// 此方法是异步的，因为建立数据库连接是 I/O 操作
    pub async fn init(app_config: &AppConfig) -> Result<Self, AppError> {
        let db = Self::create_db_connection(app_config).await?;
        let redis = Self::create_redis_pool(app_config).await?;
        let jwt_service = JwtService::with_key_versions(
            app_config.secrets.jwt_secret.clone(),
            app_config.secrets.jwt_key_version,
            parse_jwt_previous_secrets(&app_config.secrets.jwt_previous_secrets)
                .map_err(ValidationError::custom)?,
        );

        // 如果没有提供密码哈希，则从明文密码生成
        let admin_password_hash = if app_config.secrets.admin_password_hash.is_empty() {
            crate::shared::password::hash_password(&app_config.secrets.admin_password).map_err(
                |e| {
                    AppError::Validation(crate::ValidationError::custom(format!(
                        "无法生成管理员密码哈希: {}",
                        e
                    )))
                },
            )?
        } else {
            app_config.secrets.admin_password_hash.clone()
        };

        Ok(AppState {
            db,
            redis,
            jwt_service,
            config: AppStateConfig {
                jwt_secret: app_config.secrets.jwt_secret.clone(),
                jwt_key_version: app_config.secrets.jwt_key_version,
                selector_secret: app_config.secrets.selector_secret.clone(),
                selector_protocol_private_key: selector_protocol_private_key(app_config),
                selector_protocol_key_version: app_config.secrets.selector_protocol_key_version,
                selector_protocol_signing_private_key: app_config
                    .secrets
                    .selector_protocol_signing_private_key
                    .clone(),
                selector_replay_window_seconds: app_config.secrets.selector_replay_window_seconds,
                selector_nonce_ttl_seconds: app_config.secrets.selector_nonce_ttl_seconds,
                machine_salt: app_config.secrets.machine_salt.clone(),
                admin_username: app_config.secrets.admin_username.clone(),
                admin_password_hash,
                downloads_fs_path: app_config.downloads_fs_path.clone(),
                payment: app_config.payment.clone(),
                remote_publish: app_config.remote_publish.clone(),
            },
            remote_connections: Arc::new(Mutex::new(HashMap::new())),
            remote_quota_locks: Arc::new(Mutex::new(HashMap::new())),
            remote_transfer_limiter: Arc::new(RemoteTransferLimiter::new(
                app_config
                    .remote_publish
                    .aggregate_transfer_bytes_per_second,
                app_config.remote_publish.max_concurrent_transfers,
            )),
        })
    }

    /// 只通知目标 License 的在线插件；容量 1 会合并重复通知。
    pub async fn notify_remote_job(&self, license_id: Uuid) {
        let sender = self
            .remote_connections
            .lock()
            .await
            .get(&license_id)
            .map(|connection| connection.job_sender.clone());
        if let Some(sender) = sender {
            let _ = sender.try_send(());
        }
    }

    /// 创建数据库连接
    ///
    /// 根据应用配置创建连接池并连接到数据库。
    ///
    /// # 参数
    ///
    /// * `app_config` - 应用配置对象
    ///
    /// # 返回值
    ///
    /// 成功返回数据库连接，失败返回应用错误
    async fn create_db_connection(app_config: &AppConfig) -> Result<DatabaseConnection, AppError> {
        let mut opt = ConnectOptions::new(app_config.database.url.as_str());
        opt.max_connections(app_config.database.max_connections)
            .min_connections(app_config.database.min_connections)
            .connect_timeout(Duration::from_secs(app_config.database.pool_timeout))
            .acquire_timeout(Duration::from_secs(app_config.database.pool_timeout))
            .idle_timeout(Duration::from_secs(app_config.database.idle_timeout))
            .max_lifetime(Duration::from_secs(app_config.database.max_lifetime))
            .sqlx_logging(true)
            .sqlx_logging_level(app_config.logging.level.parse().map_err(|_| {
                AppError::Validation(ValidationError::custom(format!(
                    "无效的日志级别：{}",
                    app_config.logging.level
                )))
            })?);

        Database::connect(opt).await.map_err(AppError::Database)
    }

    /// 创建 Redis 连接池
    ///
    /// 根据应用配置创建 Redis 连接池。如果未配置 Redis URL，返回 None。
    ///
    /// # 参数
    ///
    /// * `app_config` - 应用配置对象
    ///
    /// # 返回值
    ///
    /// 成功返回 Redis 连接池（如果配置了）或 None，失败返回应用错误
    async fn create_redis_pool(app_config: &AppConfig) -> Result<Option<RedisPool>, AppError> {
        match &app_config.redis.url {
            Some(redis_url) => {
                let cfg = deadpool_redis::Config::from_url(redis_url);
                let pool = cfg.create_pool(Some(deadpool_redis::Runtime::Tokio1))?;

                tracing::info!("Redis 连接池已初始化");

                Ok(Some(pool))
            }
            None => {
                tracing::info!("未配置 Redis，将跳过 Redis 连接池初始化");
                Ok(None)
            }
        }
    }
}

fn selector_protocol_private_key(app_config: &AppConfig) -> String {
    if !app_config
        .secrets
        .selector_protocol_private_key
        .trim()
        .is_empty()
    {
        return app_config.secrets.selector_protocol_private_key.clone();
    }

    tracing::warn!(
        "SELECTOR_PROTOCOL_PRIVATE_KEY 未配置，开发环境将从 SELECTOR_SECRET 派生稳定私钥"
    );
    let mut hasher = Sha256::new();
    hasher.update(b"pubflow-selector-protocol-dev-key");
    hasher.update(app_config.secrets.selector_secret.as_bytes());
    hex::encode(hasher.finalize())
}
