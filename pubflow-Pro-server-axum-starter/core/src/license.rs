//! License 结构体与 Ed25519 验签
//!
//! License 是整个授权系统的核心数据结构。
//! 后端用私钥签名生成 License，WASM 端用公钥验证签名。
//!
//! 签名覆盖字段：device_id + tier + expires_at + activation_code
//! 任何字段被篡改都会导致验签失败。

use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::types::LicenseTier;

/// License 数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct License {
    /// 绑定的设备哈希
    pub device_id: String,
    /// 订阅等级
    pub tier: LicenseTier,
    /// 过期时间（Unix 时间戳，秒）
    pub expires_at: i64,
    /// 激活码
    pub activation_code: String,
    /// Ed25519 签名（Base64 编码）
    pub signature: String,
}

impl License {
    /// 构造待签名的消息 bytes
    /// 签名内容 = domain || len(device_id) || device_id || len(tier) || tier || ...
    fn sign_message(&self) -> Vec<u8> {
        let mut msg = Vec::new();
        msg.extend_from_slice(b"pubflow-license-v2\0");
        push_signing_field(&mut msg, &self.device_id);
        push_signing_field(&mut msg, self.tier_str());
        push_signing_field(&mut msg, &self.expires_at.to_string());
        push_signing_field(&mut msg, &self.activation_code);
        msg
    }

    fn tier_str(&self) -> &str {
        self.tier.as_str()
    }

    /// 用私钥签名，填充 signature 字段
    pub fn sign(&mut self, signing_key: &SigningKey) {
        let msg = self.sign_message();
        let sig = signing_key.sign(&msg);
        self.signature = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());
    }

    /// 用公钥验证签名是否合法
    pub fn verify(&self, verifying_key: &VerifyingKey) -> Result<(), LicenseError> {
        let sig_bytes = base64::engine::general_purpose::STANDARD
            .decode(&self.signature)
            .map_err(|_| LicenseError::InvalidSignature)?;
        let signature =
            Signature::from_slice(&sig_bytes).map_err(|_| LicenseError::InvalidSignature)?;
        let msg = self.sign_message();
        verifying_key
            .verify(&msg, &signature)
            .map_err(|_| LicenseError::SignatureMismatch)
    }

    /// 检查 License 是否过期
    pub fn is_expired(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        self.expires_at < now
    }

    /// 检查 License 是否绑定到指定设备
    pub fn matches_device(&self, machine_hash: &str) -> bool {
        self.device_id == machine_hash
    }
}

fn push_signing_field(msg: &mut Vec<u8>, value: &str) {
    let len = u32::try_from(value.len()).expect("license signing field is too large");
    msg.extend_from_slice(&len.to_be_bytes());
    msg.extend_from_slice(value.as_bytes());
}

/// License 验证错误
#[derive(Debug, Clone, thiserror::Error)]
pub enum LicenseError {
    #[error("签名格式无效")]
    InvalidSignature,
    #[error("签名验证失败，数据可能被篡改")]
    SignatureMismatch,
    #[error("License 已过期")]
    Expired,
    #[error("设备不匹配")]
    DeviceMismatch,
    #[error("License 已吊销")]
    Revoked,
}

/// 从 32 字节种子生成签名密钥对
pub fn generate_keypair(seed: &[u8; 32]) -> (SigningKey, VerifyingKey) {
    let signing_key = SigningKey::from_bytes(seed);
    let verifying_key = signing_key.verifying_key();
    (signing_key, verifying_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;

    #[test]
    fn test_sign_and_verify() {
        let mut seed = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut seed);
        let (sk, vk) = generate_keypair(&seed);

        let mut license = License {
            device_id: "abc123".into(),
            tier: LicenseTier::Pro,
            expires_at: 9999999999,
            activation_code: "CODE-XXXX".into(),
            signature: String::new(),
        };
        license.sign(&sk);
        assert!(license.verify(&vk).is_ok());
    }

    #[test]
    fn test_tamper_detected() {
        let mut seed = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut seed);
        let (sk, vk) = generate_keypair(&seed);

        let mut license = License {
            device_id: "abc123".into(),
            tier: LicenseTier::Pro,
            expires_at: 9999999999,
            activation_code: "CODE-XXXX".into(),
            signature: String::new(),
        };
        license.sign(&sk);

        // 篡改 tier
        license.tier = LicenseTier::Plus;
        assert!(license.verify(&vk).is_err());
    }

    #[test]
    fn test_sign_message_preserves_field_boundaries() {
        let license_a = License {
            device_id: "abc".into(),
            tier: LicenseTier::Pro,
            expires_at: 123,
            activation_code: "CODE".into(),
            signature: String::new(),
        };
        let license_b = License {
            device_id: "abcp".into(),
            tier: LicenseTier::Basic,
            expires_at: 123,
            activation_code: "CODE".into(),
            signature: String::new(),
        };

        assert_ne!(license_a.sign_message(), license_b.sign_message());
        assert!(
            license_a
                .sign_message()
                .starts_with(b"pubflow-license-v2\0")
        );
    }
}
