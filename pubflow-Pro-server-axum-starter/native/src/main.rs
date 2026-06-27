//! pubflow-native：Chrome Native Messaging 宿主进程
//!
//! 安装到用户电脑上，Chrome 扩展通过 chrome.runtime.sendNativeMessage() 与之通信。
//!
//! 通信协议：
//! - 输入：stdin，4 字节小端长度头 + JSON 消息体
//! - 输出：stdout，4 字节小端长度头 + JSON 响应
//!
//! 支持的操作：
//! - { "action": "get_machine_id" }  → 获取系统级机器码哈希
//! - { "action": "get_platform" }    → 获取操作系统平台
//! - { "action": "ping" }            → 健康检查
//!
//! 编译：
//!   cargo build -p pubflow-native --release
//!
//! 安装：
//!   1. 将二进制复制到固定路径
//!   2. 将 pubflow-native.json 复制到 Chrome Native Messaging Hosts 目录
//!   3. Windows: 注册表 HKCU\Software\Google\Chrome\NativeMessagingHosts\
//!   4. macOS: ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
//!   5. Linux: ~/.config/google-chrome/NativeMessagingHosts/

mod handler;
mod platform;

use std::io::{self, Read, Write};

fn main() {
    tracing_subscriber::fmt::init();

    if let Some(response) = handle_cli() {
        println!("{response}");
        return;
    }

    loop {
        match read_message() {
            Ok(request) => {
                let response = handler::handle(&request);
                if let Err(e) = write_message(&response) {
                    tracing::error!("写入响应失败: {}", e);
                    break;
                }
            }
            Err(e) => {
                // stdin 关闭或读取错误，退出
                tracing::info!("Native Helper 退出: {}", e);
                break;
            }
        }
    }
}

fn handle_cli() -> Option<String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() {
        return None;
    }

    let wants_machine_code = args
        .iter()
        .any(|arg| matches!(arg.as_str(), "--print-machine-code" | "--machine-code"));
    let wants_json = args.iter().any(|arg| arg == "--json");
    let wants_platform = args.iter().any(|arg| arg == "--platform");
    let wants_help = args
        .iter()
        .any(|arg| matches!(arg.as_str(), "-h" | "--help"));

    if wants_help {
        return Some(
            "Usage: pubflow-native [--print-machine-code] [--json] [--platform]\n\
             \n\
             --print-machine-code  Print hashed machine code for license binding\n\
             --json                Print machine code response as JSON\n\
             --platform            Print current platform name"
                .to_string(),
        );
    }

    if wants_platform {
        return Some(platform::get_platform_name().to_string());
    }

    if wants_machine_code || wants_json {
        let raw_id = platform::get_raw_machine_id();
        let platform_name = platform::get_platform_name();
        let salt = machine_salt();

        let response = match raw_id {
            Some(id) => {
                let hash = pubflow_core::machine::generate_machine_hash(&id, salt);
                serde_json::json!({
                    "success": true,
                    "machine_hash": hash,
                    "platform": platform_name
                })
            }
            None => serde_json::json!({
                "success": false,
                "platform": platform_name,
                "error": "无法读取系统机器码"
            }),
        };

        if wants_json {
            return Some(response.to_string());
        }
        return Some(
            response
                .get("machine_hash")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string(),
        );
    }

    None
}

fn machine_salt() -> &'static str {
    option_env!("MACHINE_SALT")
        .expect("MACHINE_SALT env var must be set when building pubflow-native")
}

/// 从 stdin 读取一条 Native Messaging 消息
fn read_message() -> io::Result<serde_json::Value> {
    let mut len_buf = [0u8; 4];
    io::stdin().read_exact(&mut len_buf)?;
    let len = u32::from_le_bytes(len_buf) as usize;

    if len > 1024 * 1024 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "消息过长"));
    }

    let mut buf = vec![0u8; len];
    io::stdin().read_exact(&mut buf)?;

    serde_json::from_slice(&buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// 向 stdout 写入一条 Native Messaging 消息
fn write_message(msg: &serde_json::Value) -> io::Result<()> {
    let data = serde_json::to_vec(msg)?;
    let len = (data.len() as u32).to_le_bytes();
    io::stdout().write_all(&len)?;
    io::stdout().write_all(&data)?;
    io::stdout().flush()?;
    Ok(())
}
