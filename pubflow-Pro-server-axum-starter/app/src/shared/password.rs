use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};

/// 密码哈希错误
#[derive(Debug)]
pub enum PasswordError {
    /// 哈希生成失败
    HashError(String),
}

impl std::fmt::Display for PasswordError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HashError(msg) => write!(f, "密码哈希失败：{}", msg),
        }
    }
}

impl std::error::Error for PasswordError {}

/// 对密码进行哈希
///
/// # 参数
/// * `password` - 原始密码
///
/// # 返回
/// 返回哈希后的密码字符串
pub fn hash_password(password: &str) -> Result<String, PasswordError> {
    let salt = SaltString::generate(OsRng);
    let argon2 = Argon2::default();

    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| PasswordError::HashError(e.to_string()))
}

/// 验证密码
///
/// # 参数
/// * `password` - 原始密码
/// * `password_hash` - 哈希后的密码
///
/// # 返回
/// 如果密码匹配返回 true，否则返回 false
pub fn verify_password(password: &str, password_hash: &str) -> Result<bool, PasswordError> {
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|e| PasswordError::HashError(format!("无效的哈希格式：{}", e)))?;

    let argon2 = Argon2::default();

    match argon2.verify_password(password.as_bytes(), &parsed_hash) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}
