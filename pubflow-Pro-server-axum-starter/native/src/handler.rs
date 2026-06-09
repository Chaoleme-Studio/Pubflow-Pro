//! 消息处理模块
//!
//! 解析扩展发送的请求，分发到对应处理函数。
//! 支持的操作：
//! - get_machine_id: 调用平台 API 获取系统机器码，哈希后返回
//! - get_platform: 返回当前操作系统平台
//! - ping: 健康检查，返回 pong

use serde_json::{Value, json};

use crate::platform;

/// 处理一条请求消息
pub fn handle(request: &Value) -> Value {
    let action = request.get("action").and_then(|v| v.as_str()).unwrap_or("");

    match action {
        "get_machine_id" => {
            let raw_id = platform::get_raw_machine_id();
            match raw_id {
                Some(id) => {
                    // 此处 salt 应从配置文件或编译时常量读取
                    let salt = option_env!("MACHINE_SALT").unwrap_or("default-salt");
                    let hash = pubflow_core::machine::generate_machine_hash(&id, salt);
                    json!({
                        "success": true,
                        "machine_hash": hash,
                        "platform": platform::get_platform_name()
                    })
                }
                None => json!({
                    "success": false,
                    "error": "无法读取系统机器码"
                }),
            }
        }
        "get_platform" => json!({
            "success": true,
            "platform": platform::get_platform_name()
        }),
        "ping" => json!({
            "success": true,
            "message": "pong"
        }),
        _ => json!({
            "success": false,
            "error": format!("未知操作: {}", action)
        }),
    }
}
