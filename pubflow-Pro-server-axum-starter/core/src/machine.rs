//! 设备机器码哈希算法
//!
//! 将系统级原始 ID（MachineGuid / IOPlatformUUID / machine-id）
//! 经过 salted SHA-256 生成稳定的设备指纹。
//!
//! 特点：
//! - 不存储原始系统 ID，只存哈希值
//! - 相同设备 + 相同 salt = 相同哈希（确定性）
//! - 不同设备碰撞概率极低（SHA-256）
//! - salt 由服务端控制，防止跨服务撞库

use sha2::{Digest, Sha256};

/// 生成设备哈希
///
/// hash = SHA-256(salt + ":" + raw_machine_id)
///
/// - raw_machine_id: 系统级原始 ID
///   - Windows: MachineGuid（注册表）
///   - macOS: IOPlatformUUID（ioreg）
///   - Linux: /etc/machine-id
/// - salt: 服务端提供的盐值，防止哈希被反查
pub fn generate_machine_hash(raw_machine_id: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b":");
    hasher.update(raw_machine_id.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

/// 验证机器码是否匹配
pub fn verify_machine_hash(raw_machine_id: &str, salt: &str, expected_hash: &str) -> bool {
    let hash = generate_machine_hash(raw_machine_id, salt);
    hash == expected_hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deterministic() {
        let hash1 = generate_machine_hash("abc-123-uuid", "my-salt");
        let hash2 = generate_machine_hash("abc-123-uuid", "my-salt");
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_different_input_different_hash() {
        let hash1 = generate_machine_hash("device-1", "salt");
        let hash2 = generate_machine_hash("device-2", "salt");
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_different_salt_different_hash() {
        let hash1 = generate_machine_hash("device-1", "salt-a");
        let hash2 = generate_machine_hash("device-1", "salt-b");
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_verify() {
        let hash = generate_machine_hash("my-device", "my-salt");
        assert!(verify_machine_hash("my-device", "my-salt", &hash));
        assert!(!verify_machine_hash("wrong-device", "my-salt", &hash));
    }
}
