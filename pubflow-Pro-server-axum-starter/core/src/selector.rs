//! Selector 解密逻辑
//!
//! Selector 是各平台发布页的 DOM 选择器配置（CSS 选择器、XPath 等）。
//! 为防止逆向，选择器以 AES-GCM 加密形式存储和传输。
//!
//! 流程：
//! 1. 后端读取明文 selector JSON
//! 2. 用主密钥加密 → 生成 encrypted_selector
//! 3. 扩展端 WASM 模块用派生密钥解密
//! 4. Content script 使用解密后的选择器操作 DOM
//!
//! 选择器按平台分组，每个平台包含：
//! - title_input: 标题输入框
//! - desc_input: 描述输入框
//! - topic_input: 话题输入框
//! - publish_btn: 发布按钮
//! - cover_upload: 封面上传
//! - video_upload: 视频上传
//! - image_upload: 图片上传（图文模式）
//! - article_editor: 文章编辑器

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::crypto::{self, CryptoError};

/// 单个平台的选择器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformSelector {
    pub title_input: String,
    pub desc_input: Option<String>,
    pub topic_input: Option<String>,
    pub topic_confirm: Option<String>,
    pub publish_btn: String,
    pub cover_upload: Option<String>,
    pub video_upload: Option<String>,
    pub image_upload: Option<String>,
    pub article_editor: Option<String>,
    /// 自定义选择器（扩展字段）
    #[serde(flatten)]
    pub extra: HashMap<String, String>,
}

/// 加密后的 Selector 容器
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedSelector {
    /// 加密数据（Base64 编码的 nonce + ciphertext + tag）
    pub data: String,
    /// SHA-256 校验和（用于完整性校验）
    pub checksum: String,
    /// 版本号
    pub version: u32,
    /// 最低兼容扩展版本
    pub min_app_version: String,
}

/// 解密 selector 数据
///
/// encrypted_data: AES-GCM 加密的 Base64 字符串
/// server_secret: 服务端主密钥
/// license_code: 用户激活码（共享秘密）
///
/// 返回解密后的平台选择器 Map
pub fn decrypt_selectors(
    encrypted_data: &str,
    server_secret: &str,
    license_code: &str,
) -> Result<HashMap<String, PlatformSelector>, CryptoError> {
    let key = crypto::derive_key(server_secret, license_code);
    let plaintext = crypto::decrypt(encrypted_data, &key)?;
    let json_str =
        String::from_utf8(plaintext).map_err(|e| CryptoError::DecryptFailed(e.to_string()))?;
    serde_json::from_str(&json_str).map_err(|e| CryptoError::DecryptFailed(e.to_string()))
}

/// 加密 selector 数据（后端使用）
pub fn encrypt_selectors(
    selectors: &HashMap<String, PlatformSelector>,
    server_secret: &str,
    license_code: &str,
) -> Result<String, CryptoError> {
    let json =
        serde_json::to_string(selectors).map_err(|e| CryptoError::EncryptFailed(e.to_string()))?;
    let key = crypto::derive_key(server_secret, license_code);
    crypto::encrypt(json.as_bytes(), &key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_selectors() {
        let mut selectors = HashMap::new();
        selectors.insert(
            "douyin".to_string(),
            PlatformSelector {
                title_input: "#title-input".into(),
                desc_input: Some("#desc-input".into()),
                topic_input: Some("#topic-input".into()),
                topic_confirm: None,
                publish_btn: "#publish-btn".into(),
                cover_upload: Some("#cover-upload".into()),
                video_upload: Some("#video-upload".into()),
                image_upload: None,
                article_editor: None,
                extra: HashMap::new(),
            },
        );

        let secret = "server-secret-key";
        let code = "ACTIVATE-CODE-123";

        let encrypted = encrypt_selectors(&selectors, secret, code).unwrap();
        let decrypted = decrypt_selectors(&encrypted, secret, code).unwrap();

        assert_eq!(decrypted.len(), 1);
        assert_eq!(decrypted["douyin"].title_input, "#title-input");
    }
}
