mod config;
mod database;
mod error;
mod local_api;
mod models;
mod project;
mod routes;
mod state;

use anyhow::Result;
use config::{Settings, load_workspace_env_file};
use database::JobDatabase;
use state::AppState;
use tokio::signal;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    load_workspace_env_file();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")),
        )
        .init();

    let settings = Settings::load()?;
    let database = JobDatabase::connect(&settings.database_path()).await?;
    database.recover_inflight_jobs().await?;
    let state = AppState::new(settings.clone(), database);
    let app = routes::router(state);
    let listener = tokio::net::TcpListener::bind(settings.bind_addr).await?;

    info!("PubFlow Native 已启动：http://{}", settings.bind_addr);
    info!("工作区：{}", settings.workspace_root.display());
    info!("HTTP Token 文件：{}", settings.token_path().display());
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = signal::ctrl_c().await {
        tracing::error!(%error, "安装 Ctrl+C 监听失败");
    }
}
