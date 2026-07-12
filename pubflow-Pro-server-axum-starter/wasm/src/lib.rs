//! pubflow-wasm：WASM 模块
//!
//! 编译为 .wasm 文件嵌入 Chrome 扩展。
//! 通过 wasm-bindgen 导出 JavaScript 可调用的函数。
//!
//! 职责：
//! - License 签名验证（Ed25519 公钥硬编在 WASM 中）
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
use pubflow_core::selector_protocol::{
    ActivationProtocolRequestPayload, SelectorProtocolRequestPayload, activation_code_hash,
    decode_activation_response, decode_response, encode_activation_request, encode_request,
    start_client_session,
};
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

/// 解密 PFSP 下发的完整 Selector JSON。
///
/// PFSP 响应体已经通过会话密钥保护；这里的二次加密只用于避免静态缓存中出现明文 selector。
#[wasm_bindgen]
pub fn pfsp_decrypt_selector_json(encrypted_json: &str, activation_code: &str) -> String {
    let activation_hash = activation_code_hash(activation_code);
    pubflow_core::selector::decrypt_selector_json(encrypted_json, &activation_hash, activation_code)
        .unwrap_or_default()
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

/// 计算激活码哈希，用于 PFSP 请求，不直接传输激活码。
#[wasm_bindgen]
pub fn pfsp_activation_code_hash(activation_code: &str) -> String {
    activation_code_hash(activation_code)
}

/// 构造 PFSP v1 Selector 拉取请求。
///
/// 返回 JSON：
/// {
///   "ok": true,
///   "request_base64": "...",
///   "response_key_hex": "..."
/// }
#[wasm_bindgen]
pub fn pfsp_build_selector_request(
    server_public_key_hex: &str,
    lease_token: &str,
    client_install_id: &str,
    activation_code_hash_value: &str,
    selector_version_known: i32,
    extension_version: &str,
    server_time_ms: i64,
) -> String {
    let timestamp_ms = if server_time_ms > 0 {
        server_time_ms
    } else {
        js_sys::Date::now() as i64
    };
    let context = "pfsp-v1";
    let session = match start_client_session(server_public_key_hex, timestamp_ms, context) {
        Ok(session) => session,
        Err(error) => return pfsp_error(error.to_string()),
    };
    let payload = SelectorProtocolRequestPayload {
        lease_token: lease_token.to_string(),
        client_install_id: client_install_id.to_string(),
        activation_code_hash: activation_code_hash_value.to_string(),
        selector_version_known: if selector_version_known > 0 {
            Some(selector_version_known)
        } else {
            None
        },
        extension_version: if extension_version.is_empty() {
            None
        } else {
            Some(extension_version.to_string())
        },
    };
    let request = match encode_request(&payload, &session) {
        Ok(request) => request,
        Err(error) => return pfsp_error(error.to_string()),
    };
    serde_json::json!({
        "ok": true,
        "request_base64": base64::engine::general_purpose::STANDARD.encode(request),
        "response_key_hex": hex::encode(session.response_key()),
    })
    .to_string()
}

/// 构造 PFAP v1 激活请求。
#[wasm_bindgen]
pub fn pfap_build_activation_request(
    server_public_key_hex: &str,
    activation_code: &str,
    client_install_id: &str,
    platform: &str,
    extension_version: &str,
    server_time_ms: i64,
) -> String {
    let timestamp_ms = if server_time_ms > 0 {
        server_time_ms
    } else {
        js_sys::Date::now() as i64
    };
    let context = "pfap-v1";
    let session = match start_client_session(server_public_key_hex, timestamp_ms, context) {
        Ok(session) => session,
        Err(error) => return pfsp_error(error.to_string()),
    };
    let payload = ActivationProtocolRequestPayload {
        activation_code: activation_code.to_string(),
        client_install_id: client_install_id.to_string(),
        platform: platform.to_string(),
        extension_version: if extension_version.is_empty() {
            None
        } else {
            Some(extension_version.to_string())
        },
    };
    let request = match encode_activation_request(&payload, &session) {
        Ok(request) => request,
        Err(error) => return pfsp_error(error.to_string()),
    };
    serde_json::json!({
        "ok": true,
        "request_base64": base64::engine::general_purpose::STANDARD.encode(request),
        "response_key_hex": hex::encode(session.response_key()),
    })
    .to_string()
}

/// 解码 PFSP v1 Selector 响应。
#[wasm_bindgen]
pub fn pfsp_decode_selector_response(response_base64: &str, response_key_hex: &str) -> String {
    let response = match base64::engine::general_purpose::STANDARD.decode(response_base64) {
        Ok(response) => response,
        Err(error) => return pfsp_error(error.to_string()),
    };
    let key_bytes = match hex::decode(response_key_hex) {
        Ok(bytes) => bytes,
        Err(error) => return pfsp_error(error.to_string()),
    };
    let key: [u8; 32] = match key_bytes.try_into() {
        Ok(key) => key,
        Err(_) => return pfsp_error("invalid response key".to_string()),
    };
    match decode_response(&response, &key) {
        Ok(payload) => serde_json::json!({
            "ok": true,
            "version": payload.version,
            "encrypted_selector_blob": payload.encrypted_selector_blob,
            "checksum": payload.checksum,
            "min_app_version": payload.min_app_version,
            "expires_at": payload.expires_at,
            "server_time": payload.server_time,
        })
        .to_string(),
        Err(error) => pfsp_error(error.to_string()),
    }
}

/// 解码 PFAP v1 激活响应。
#[wasm_bindgen]
pub fn pfap_decode_activation_response(response_base64: &str, response_key_hex: &str) -> String {
    let response = match base64::engine::general_purpose::STANDARD.decode(response_base64) {
        Ok(response) => response,
        Err(error) => return pfsp_error(error.to_string()),
    };
    let key_bytes = match hex::decode(response_key_hex) {
        Ok(bytes) => bytes,
        Err(error) => return pfsp_error(error.to_string()),
    };
    let key: [u8; 32] = match key_bytes.try_into() {
        Ok(key) => key,
        Err(_) => return pfsp_error("invalid response key".to_string()),
    };
    match decode_activation_response(&response, &key) {
        Ok(payload) => serde_json::json!({
            "ok": true,
            "lease_token": payload.lease_token,
            "lease_type": payload.lease_type,
            "tier": payload.tier,
            "features": payload.features,
            "valid_from": payload.valid_from,
            "valid_until": payload.valid_until,
            "license_expires_at": payload.license_expires_at,
            "server_time": payload.server_time,
        })
        .to_string(),
        Err(error) => pfsp_error(error.to_string()),
    }
}

fn pfsp_error(message: String) -> String {
    serde_json::json!({
        "ok": false,
        "error": message,
    })
    .to_string()
}

/// WASM 初始化钩子（可选）
#[wasm_bindgen(start)]
pub fn init() {
    // 设置 panic hook，让 Rust panic 信息出现在浏览器 console
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}
