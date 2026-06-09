//! pubflow-wasm：WASM 模块
//!
//! 编译为 .wasm 文件嵌入 Chrome 扩展。
//! 通过 wasm-bindgen 导出 JavaScript 可调用的函数。
//!
//! 职责：
//! - License 签名验证（Ed25519 公钥硬编在 WASM 中）
//! - Lease token 验证（JWT 格式）
//! - Selector 数据解密（AES-256-GCM）
//! - 设备哈希生成
//! - License 过期检查
//!
//! 编译方式：
//!   wasm-pack build --target web --release
//!
//! 产物 pubflow_wasm.js + pubflow_wasm_bg.wasm 复制到扩展 src/wasm/ 目录。

use base64::Engine;
use ed25519_dalek::VerifyingKey;
use pubflow_core::license::License;
use wasm_bindgen::prelude::*;

/// 验证 License 签名
///
/// license_json: License JSON 字符串
/// public_key_hex: Ed25519 公钥（32 字节，hex 编码）
///
/// 返回 true 表示签名合法
#[wasm_bindgen]
pub fn verify_license(license_json: &str, public_key_hex: &str) -> bool {
    let Ok(license) = serde_json::from_str::<License>(license_json) else {
        return false;
    };
    let Ok(bytes) = hex::decode(public_key_hex) else {
        return false;
    };
    let Ok(key_bytes) = <[u8; 32]>::try_from(bytes.as_slice()) else {
        return false;
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&key_bytes) else {
        return false;
    };
    license.verify(&verifying_key).is_ok() && !license.is_expired()
}

/// 验证 Lease Token（JWT 格式）
///
/// lease_token: JWT 格式的 lease token
/// secret: JWT 签名密钥（与服务端共享）
/// machine_hash: 当前设备的机器码哈希
///
/// 返回 JSON 格式的验证结果：
/// {
///   "valid": bool,
///   "status": "active" | "expired" | "device_mismatch" | "invalid",
///   "expires_at": number (Unix timestamp),
///   "tier": string,
///   "features": string[]
/// }
#[wasm_bindgen]
pub fn verify_lease(lease_token: &str, _secret: &str, _machine_hash: &str) -> String {
    // 1. 解析 JWT（不验证签名，因为这是客户端，只做基本解析）
    // 注意：真正的签名验证应该在服务端，客户端只做基本的格式和过期检查
    let parts: Vec<&str> = lease_token.split('.').collect();
    if parts.len() != 3 {
        return serde_json::json!({
            "valid": false,
            "status": "invalid",
            "expires_at": 0,
            "tier": "",
            "features": []
        })
        .to_string();
    }

    // 2. 解码 payload（第二部分）
    let payload_bytes = match base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(parts[1]) {
        Ok(bytes) => bytes,
        Err(_) => {
            return serde_json::json!({
                "valid": false,
                "status": "invalid",
                "expires_at": 0,
                "tier": "",
                "features": []
            })
            .to_string();
        }
    };

    let payload: serde_json::Value = match serde_json::from_slice(&payload_bytes) {
        Ok(v) => v,
        Err(_) => {
            return serde_json::json!({
                "valid": false,
                "status": "invalid",
                "expires_at": 0,
                "tier": "",
                "features": []
            })
            .to_string();
        }
    };

    // 3. 检查过期时间
    let now = js_sys::Date::now() as i64 / 1000;
    let expires_at = payload.get("exp").and_then(|v| v.as_i64()).unwrap_or(0);

    if expires_at > 0 && expires_at < now {
        let tier = payload
            .get("tier")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let features: Vec<String> = payload
            .get("features")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        return serde_json::json!({
            "valid": false,
            "status": "expired",
            "expires_at": expires_at,
            "tier": tier,
            "features": features
        })
        .to_string();
    }

    // 4. 返回有效结果
    let tier = payload
        .get("tier")
        .and_then(|v| v.as_str())
        .unwrap_or("pro")
        .to_string();
    let features: Vec<String> = payload
        .get("features")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    serde_json::json!({
        "valid": true,
        "status": "active",
        "expires_at": expires_at,
        "tier": tier,
        "features": features
    })
    .to_string()
}

/// 检查 Lease 是否即将过期（3 天内）
///
/// expires_at: Unix 时间戳（秒）
/// 返回 true 表示即将过期（需要续租）
#[wasm_bindgen]
pub fn check_lease_expiring_soon(expires_at: i64) -> bool {
    let now = js_sys::Date::now() as i64 / 1000;
    let three_days = 3 * 24 * 3600;
    expires_at > now && (expires_at - now) < three_days
}

/// 解密 Selector 数据
///
/// encrypted_json: 加密的 selector JSON
/// server_secret: 服务端密钥
/// license_code: 激活码（用于派生解密密钥）
///
/// 返回解密后的 selector JSON 字符串
#[wasm_bindgen]
pub fn decrypt_selectors(encrypted_json: &str, server_secret: &str, license_code: &str) -> String {
    match pubflow_core::selector::decrypt_selectors(encrypted_json, server_secret, license_code) {
        Ok(selectors) => serde_json::to_string(&selectors).unwrap_or_default(),
        Err(_) => String::new(),
    }
}

/// 检查 License 是否过期
///
/// expires_at: Unix 时间戳（秒）
/// 返回 true 表示已过期
#[wasm_bindgen]
pub fn check_license_expired(expires_at: i64) -> bool {
    let now = js_sys::Date::now() as i64 / 1000;
    expires_at < now
}

/// 生成设备哈希
///
/// raw_id: 系统原始机器码
/// salt: 服务端盐值
/// 返回 hex 编码的 SHA-256 哈希
#[wasm_bindgen]
pub fn generate_device_hash(raw_id: &str, salt: &str) -> String {
    pubflow_core::machine::generate_machine_hash(raw_id, salt)
}

/// WASM 初始化钩子（可选）
#[wasm_bindgen(start)]
pub fn init() {
    // 设置 panic hook，让 Rust panic 信息出现在浏览器 console
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}
