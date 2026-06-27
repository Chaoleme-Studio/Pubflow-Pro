use serde::Deserialize;

/// 应用状态运行时配置
///
/// 存储应用在运行时需要的敏感配置信息和秘密。
#[derive(Debug, Clone, Deserialize)]
pub struct AppStateConfig {
    /// JWT 签名密钥，用于生成和验证令牌
    pub jwt_secret: String,

    /// Selector AES 派生主密钥
    pub selector_secret: String,

    /// Selector 二进制协议服务端私钥（hex）
    pub selector_protocol_private_key: String,

    /// Selector 协议请求允许的时间偏差
    pub selector_replay_window_seconds: i64,

    /// Selector 协议 nonce 去重保留时间
    pub selector_nonce_ttl_seconds: u64,

    /// 机器码哈希盐
    pub machine_salt: String,

    /// 管理端登录账号
    pub admin_username: String,

    /// 管理端登录密码哈希（Argon2 格式）
    pub admin_password_hash: String,
}
