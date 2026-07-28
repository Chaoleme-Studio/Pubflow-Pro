use std::{
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use clap::Parser;
use rand::{Rng, distributions::Alphanumeric};
use serde::{Deserialize, Serialize};

const CONFIG_FILE_NAME: &str = "config.json";
const WORKSPACE_IDENTITY_FILE_NAME: &str = ".pubflow-workspace.json";
const DEFAULT_PORT: u16 = 5190;
const DEFAULT_HOST: IpAddr = IpAddr::V4(Ipv4Addr::UNSPECIFIED);
const DEFAULT_LOCAL_PASSWORD: &str = "123456";

pub fn load_workspace_env_file() {
    let env_name = std::env::var("PUBFLOW_ENV")
        .or_else(|_| std::env::var("ENV"))
        .or_else(|_| std::env::var("APP_ENV"))
        .unwrap_or_else(|_| "development".to_string());
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    if let Some(workspace_dir) = manifest_dir.parent() {
        dotenvy::from_path(workspace_dir.join(format!(".env.{env_name}"))).ok();
    }
}

#[derive(Debug, Parser)]
#[command(
    name = "pubflow-pro-native",
    version,
    about = "PubFlow Pro 本地发布 Agent"
)]
struct Cli {
    /// Agent 自身数据目录（Token、SQLite）
    #[arg(long, env = "PUBFLOW_AGENT_DATA_DIR")]
    data_dir: Option<PathBuf>,

    /// 与 Chrome 插件选择的目录完全相同的 PubFlow 工作区
    #[arg(long, env = "PUBFLOW_WORKSPACE")]
    workspace: Option<PathBuf>,

    /// 强制弹出系统目录选择器并覆盖已保存的工作区
    #[arg(long, conflicts_with = "workspace")]
    select_workspace: bool,

    #[arg(long, env = "PUBFLOW_AGENT_PORT")]
    port: Option<u16>,

    #[arg(long, env = "PUBFLOW_AGENT_HOST")]
    host: Option<IpAddr>,

    /// 本地发布网页访问密码
    #[arg(long, env = "PUBFLOW_LOCAL_PASSWORD", hide_env_values = true)]
    local_password: Option<String>,

    /// HTTP API Token；为空时首次启动自动生成
    #[arg(long, env = "PUBFLOW_AGENT_API_TOKEN")]
    api_token: Option<String>,

    /// 可选的插件 WebSocket Token
    #[arg(long, env = "PUBFLOW_EXTENSION_TOKEN")]
    extension_token: Option<String>,

    /// 逗号分隔的 Chrome 扩展 ID 白名单；开发阶段可留空
    #[arg(long, env = "PUBFLOW_ALLOWED_EXTENSION_IDS", value_delimiter = ',')]
    allowed_extension_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Settings {
    pub bind_addr: SocketAddr,
    pub data_dir: PathBuf,
    pub workspace_root: PathBuf,
    pub workspace_id: String,
    pub local_password: String,
    pub api_token: String,
    pub extension_token: Option<String>,
    pub allowed_extension_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedConfig {
    workspace_root: PathBuf,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    host: Option<IpAddr>,
    #[serde(default)]
    local_password: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceIdentity {
    version: u8,
    workspace_id: String,
}

impl Settings {
    pub fn load() -> Result<Self> {
        Self::from_cli(Cli::parse())
    }

    fn from_cli(cli: Cli) -> Result<Self> {
        Self::from_cli_with_picker(cli, pick_workspace_directory)
    }

    fn from_cli_with_picker(cli: Cli, picker: impl FnOnce() -> Option<PathBuf>) -> Result<Self> {
        let data_dir = match cli.data_dir {
            Some(path) => absolute(path)?,
            None => absolute(home_dir()?.join(".pubflow-pro-native"))?,
        };
        fs::create_dir_all(&data_dir)
            .with_context(|| format!("无法创建 Agent 数据目录 {}", data_dir.display()))?;

        if cli.workspace.is_some() && cli.select_workspace {
            bail!("--workspace 与 --select-workspace 不能同时使用");
        }
        let (workspace_root, persist_workspace, persisted) =
            resolve_workspace(&data_dir, cli.workspace, cli.select_workspace, picker)?;
        let port = cli
            .port
            .or(persisted.as_ref().and_then(|value| value.port))
            .unwrap_or(DEFAULT_PORT);
        let host = cli
            .host
            .or(persisted.as_ref().and_then(|value| value.host))
            .unwrap_or(DEFAULT_HOST);
        let local_password = cli
            .local_password
            .or_else(|| {
                persisted
                    .as_ref()
                    .and_then(|value| value.local_password.clone())
            })
            .unwrap_or_else(|| DEFAULT_LOCAL_PASSWORD.to_owned());
        let local_password = local_password.trim().to_owned();
        if !(6..=128).contains(&local_password.len()) {
            bail!("PUBFLOW_LOCAL_PASSWORD 必须为 6-128 个字符");
        }
        let workspace_id = load_or_create_workspace_id(&workspace_root)?;

        let token_path = data_dir.join("api-token");
        let api_token = match cli.api_token.filter(|value| !value.trim().is_empty()) {
            Some(value) => value.trim().to_owned(),
            None if token_path.is_file() => fs::read_to_string(&token_path)
                .with_context(|| format!("无法读取 {}", token_path.display()))?
                .trim()
                .to_owned(),
            None => {
                let generated: String = rand::thread_rng()
                    .sample_iter(&Alphanumeric)
                    .take(48)
                    .map(char::from)
                    .collect();
                fs::write(&token_path, format!("{generated}\n"))
                    .with_context(|| format!("无法写入 {}", token_path.display()))?;
                restrict_token_permissions(&token_path)?;
                generated
            }
        };
        if api_token.len() < 24 {
            bail!("PUBFLOW_AGENT_API_TOKEN 至少需要 24 个字符");
        }

        if persist_workspace {
            save_persisted_config(&data_dir, &workspace_root, host, port, &local_password)?;
        }

        Ok(Self {
            bind_addr: SocketAddr::new(host, port),
            data_dir,
            workspace_root,
            workspace_id,
            local_password,
            api_token,
            extension_token: cli.extension_token.filter(|value| !value.trim().is_empty()),
            allowed_extension_ids: cli
                .allowed_extension_ids
                .into_iter()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
                .collect(),
        })
    }

    pub fn database_path(&self) -> PathBuf {
        self.data_dir.join("jobs.sqlite3")
    }

    pub fn token_path(&self) -> PathBuf {
        self.data_dir.join("api-token")
    }

    pub fn save_workspace_selection(&self, selected: &Path) -> Result<PathBuf> {
        if !selected.is_dir() {
            bail!("工作区不存在或不是目录：{}", selected.display());
        }
        let workspace_root = fs::canonicalize(selected)
            .with_context(|| format!("无法解析工作区路径 {}", selected.display()))?;
        load_or_create_workspace_id(&workspace_root)?;
        save_persisted_config(
            &self.data_dir,
            &workspace_root,
            self.bind_addr.ip(),
            self.bind_addr.port(),
            &self.local_password,
        )?;
        Ok(workspace_root)
    }
}

fn resolve_workspace(
    data_dir: &Path,
    requested: Option<PathBuf>,
    force_picker: bool,
    picker: impl FnOnce() -> Option<PathBuf>,
) -> Result<(PathBuf, bool, Option<PersistedConfig>)> {
    let config_path = data_dir.join(CONFIG_FILE_NAME);
    let persisted = if config_path.is_file() {
        let contents = fs::read(&config_path)
            .with_context(|| format!("无法读取 Agent 配置 {}", config_path.display()))?;
        Some(
            serde_json::from_slice::<PersistedConfig>(&contents)
                .with_context(|| format!("Agent 配置格式无效 {}", config_path.display()))?,
        )
    } else {
        None
    };
    let (path, should_persist) = match requested {
        Some(path) => (absolute(path)?, true),
        None if !force_picker && persisted.is_some() => (
            absolute(persisted.as_ref().unwrap().workspace_root.clone())?,
            false,
        ),
        None => (
            picker().ok_or_else(|| {
                anyhow::anyhow!(
                    "未选择工作区。请重新启动后选择目录，或使用 --workspace 指定绝对路径"
                )
            })?,
            true,
        ),
    };

    if !path.is_dir() {
        bail!(
            "工作区不存在或不是目录：{}。请检查 --workspace，或在插件 Dashboard 中重新选择该目录",
            path.display()
        );
    }

    let canonical = fs::canonicalize(&path)
        .with_context(|| format!("无法解析工作区路径 {}", path.display()))?;
    Ok((canonical, should_persist, persisted))
}

fn save_persisted_config(
    data_dir: &Path,
    workspace_root: &Path,
    host: IpAddr,
    port: u16,
    local_password: &str,
) -> Result<()> {
    let path = data_dir.join(CONFIG_FILE_NAME);
    let config = PersistedConfig {
        workspace_root: workspace_root.to_owned(),
        port: Some(port),
        host: Some(host),
        local_password: Some(local_password.to_owned()),
    };
    let mut contents = serde_json::to_string_pretty(&config)?;
    contents.push('\n');
    fs::write(&path, contents).with_context(|| format!("无法写入 Agent 配置 {}", path.display()))
}

fn load_or_create_workspace_id(workspace_root: &Path) -> Result<String> {
    let path = workspace_root.join(WORKSPACE_IDENTITY_FILE_NAME);
    if path.is_file() {
        let contents = fs::read(&path)
            .with_context(|| format!("无法读取工作区身份文件 {}", path.display()))?;
        let identity: WorkspaceIdentity = serde_json::from_slice(&contents)
            .with_context(|| format!("工作区身份文件格式无效 {}", path.display()))?;
        if identity.version != 1 || identity.workspace_id.trim().is_empty() {
            bail!("工作区身份文件内容无效 {}", path.display());
        }
        return Ok(identity.workspace_id);
    }

    let workspace_id = uuid::Uuid::new_v4().to_string();
    let identity = WorkspaceIdentity {
        version: 1,
        workspace_id: workspace_id.clone(),
    };
    let mut contents = serde_json::to_string_pretty(&identity)?;
    contents.push('\n');
    fs::write(&path, contents)
        .with_context(|| format!("无法写入工作区身份文件 {}", path.display()))?;
    Ok(workspace_id)
}

fn absolute(path: PathBuf) -> Result<PathBuf> {
    if path.is_absolute() {
        return Ok(path);
    }
    Ok(std::env::current_dir()?.join(path))
}

fn home_dir() -> Result<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .context("无法确定用户主目录，请显式传入 --data-dir")
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn pick_workspace_directory() -> Option<PathBuf> {
    rfd::FileDialog::new()
        .set_title("选择 PubFlow 插件使用的工作区")
        .pick_folder()
}

#[cfg(target_os = "linux")]
pub fn pick_workspace_directory() -> Option<PathBuf> {
    let output = std::process::Command::new("zenity")
        .args([
            "--file-selection",
            "--directory",
            "--title=选择 PubFlow 插件使用的工作区",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let selected = String::from_utf8(output.stdout).ok()?;
    let selected = selected.trim();
    (!selected.is_empty()).then(|| PathBuf::from(selected))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub fn pick_workspace_directory() -> Option<PathBuf> {
    None
}

#[cfg(unix)]
fn restrict_token_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_token_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const TEST_TOKEN: &str = "12345678901234567890123456789012";

    fn cli(data_dir: PathBuf, workspace: Option<PathBuf>) -> Cli {
        Cli {
            data_dir: Some(data_dir),
            workspace,
            select_workspace: false,
            port: None,
            host: None,
            local_password: Some(DEFAULT_LOCAL_PASSWORD.to_owned()),
            api_token: Some(TEST_TOKEN.to_owned()),
            extension_token: None,
            allowed_extension_ids: Vec::new(),
        }
    }

    #[test]
    fn first_start_uses_the_selected_workspace() {
        let root = tempdir().unwrap();
        let workspace = root.path().join("workspace");
        fs::create_dir(&workspace).unwrap();
        let settings = Settings::from_cli_with_picker(cli(root.path().join("agent"), None), || {
            Some(workspace.clone())
        })
        .unwrap();

        assert_eq!(
            settings.workspace_root,
            fs::canonicalize(workspace).unwrap()
        );
    }

    #[test]
    fn first_start_rejects_a_cancelled_picker() {
        let root = tempdir().unwrap();
        let error = Settings::from_cli_with_picker(cli(root.path().join("agent"), None), || None)
            .unwrap_err();

        assert!(error.to_string().contains("未选择工作区"));
    }

    #[test]
    fn explicit_workspace_is_persisted_and_reused() {
        let root = tempdir().unwrap();
        let data_dir = root.path().join("agent");
        let workspace = root.path().join("workspace");
        fs::create_dir(&workspace).unwrap();

        let initial = Settings::from_cli(cli(data_dir.clone(), Some(workspace))).unwrap();
        assert!(data_dir.join(CONFIG_FILE_NAME).is_file());
        assert!(
            initial
                .workspace_root
                .join(WORKSPACE_IDENTITY_FILE_NAME)
                .is_file()
        );

        let restored = Settings::from_cli(cli(data_dir, None)).unwrap();
        assert_eq!(restored.workspace_root, initial.workspace_root);
        assert_eq!(restored.workspace_id, initial.workspace_id);
        assert_eq!(restored.bind_addr.port(), DEFAULT_PORT);
    }

    #[test]
    fn explicit_port_overrides_persisted_port() {
        let root = tempdir().unwrap();
        let data_dir = root.path().join("agent");
        let workspace = root.path().join("workspace");
        fs::create_dir(&workspace).unwrap();

        let mut first_cli = cli(data_dir.clone(), Some(workspace));
        first_cli.port = Some(5201);
        Settings::from_cli(first_cli).unwrap();

        let restored = Settings::from_cli(cli(data_dir.clone(), None)).unwrap();
        assert_eq!(restored.bind_addr.port(), 5201);

        let mut override_cli = cli(data_dir, None);
        override_cli.port = Some(5202);
        let overridden = Settings::from_cli(override_cli).unwrap();
        assert_eq!(overridden.bind_addr.port(), 5202);
    }
}
