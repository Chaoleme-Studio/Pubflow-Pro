//! AES-256-GCM 对称加解密
//!
//! 用于 Selector 文件的加密传输。
//! 后端用主密钥加密 selector JSON，WASM 端用派生密钥解密。
//!
//! 密钥派生：SHA-256(server_secret + license_code)
//! license_code 是激活码，作为客户端和服务器的共享秘密。
//!
//! 加密格式：nonce (12 bytes) || ciphertext || tag (16 bytes)
//! 输出为 Base64 编码。

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use base64::Engine;
use sha2::{Digest, Sha256};

/// 加密错误
#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("加密失败: {0}")]
    EncryptFailed(String),
    #[error("解密失败: {0}")]
    DecryptFailed(String),
    #[error("密钥派生失败")]
    KeyDerivationFailed,
}

/// 从 server_secret 和 license_code 派生 256 位密钥
///
/// key = SHA-256(server_secret || license_code)
pub fn derive_key(server_secret: &str, license_code: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(server_secret.as_bytes());
    hasher.update(license_code.as_bytes());
    hasher.finalize().into()
}

/// AES-256-GCM 加密
///
/// 返回 Base64 编码的 nonce + ciphertext + tag
pub fn encrypt(plaintext: &[u8], key: &[u8; 32]) -> Result<String, CryptoError> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| CryptoError::EncryptFailed(e.to_string()))?;

    let mut nonce_bytes = [0u8; 12];
    use rand::RngCore;
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| CryptoError::EncryptFailed(e.to_string()))?;

    let mut output = Vec::with_capacity(12 + ciphertext.len());
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    Ok(base64::engine::general_purpose::STANDARD.encode(&output))
}

/// AES-256-GCM 解密
///
/// 输入为 Base64 编码的 nonce + ciphertext + tag
pub fn decrypt(encoded: &str, key: &[u8; 32]) -> Result<Vec<u8>, CryptoError> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e: base64::DecodeError| CryptoError::DecryptFailed(e.to_string()))?;

    if data.len() < 12 {
        return Err(CryptoError::DecryptFailed("数据过短".into()));
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| CryptoError::DecryptFailed(e.to_string()))?;
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| CryptoError::DecryptFailed(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = derive_key("server-secret-123", "ACTIVATE-CODE-456");
        let plaintext = b"{\"douyin\":{\"title\":\"#title\"}}";

        let encrypted = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = derive_key("secret1", "code1");
        let key2 = derive_key("secret2", "code2");
        let plaintext = b"hello world";

        let encrypted = encrypt(plaintext, &key1).unwrap();
        assert!(decrypt(&encrypted, &key2).is_err());
    }
}
