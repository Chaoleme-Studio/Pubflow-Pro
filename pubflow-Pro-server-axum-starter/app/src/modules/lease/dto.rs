use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// 激活 lease 请求
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ActivateLeaseRequest {
    /// 激活码
    pub activation_code: String,
    /// 浏览器插件安装实例 ID
    pub client_install_id: Option<String>,
    /// 旧版兼容字段；订阅版不再表示硬件机器码
    pub machine_hash: Option<String>,
    /// 平台：windows / macos / linux
    pub platform: String,
    /// 插件版本
    pub extension_version: Option<String>,
}

/// 激活 lease 响应
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ActivateLeaseResponse {
    /// lease token（签名后的 JWT）
    pub lease_token: String,
    /// lease 类型：subscription / perpetual
    pub lease_type: String,
    /// 订阅等级
    pub tier: String,
    /// 功能列表
    pub features: Vec<String>,
    /// 生效时间
    pub valid_from: DateTime<Utc>,
    /// 失效时间
    pub valid_until: DateTime<Utc>,
    /// 服务器时间（用于校准本地时间）
    pub server_time: DateTime<Utc>,
}

/// 验证 lease 请求
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct VerifyLeaseRequest {
    /// lease token
    pub lease_token: String,
    /// 浏览器插件安装实例 ID
    pub client_install_id: Option<String>,
    /// 旧版兼容字段；订阅版不再表示硬件机器码
    pub machine_hash: Option<String>,
}

/// 验证 lease 响应
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct VerifyLeaseResponse {
    /// 是否有效
    pub valid: bool,
    /// 状态：active / expired / device_mismatch / revoked
    pub status: String,
    /// lease 类型
    pub lease_type: String,
    /// 订阅等级
    pub tier: String,
    /// 功能列表
    pub features: Vec<String>,
    /// 失效时间
    pub valid_until: DateTime<Utc>,
    /// 服务器时间
    pub server_time: DateTime<Utc>,
    /// 距离过期的秒数
    pub expires_in_seconds: i64,
}

/// 续租请求
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RenewLeaseRequest {
    /// 当前 lease token
    pub lease_token: String,
    /// 浏览器插件安装实例 ID
    pub client_install_id: Option<String>,
    /// 旧版兼容字段；订阅版不再表示硬件机器码
    pub machine_hash: Option<String>,
}

/// 续租响应
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RenewLeaseResponse {
    /// 新的 lease token
    pub lease_token: String,
    /// 新的失效时间
    pub valid_until: DateTime<Utc>,
    /// 服务器时间
    pub server_time: DateTime<Utc>,
}

/// 解绑设备请求
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DeactivateLeaseRequest {
    /// 激活码
    pub activation_code: String,
    /// 浏览器插件安装实例 ID
    pub client_install_id: Option<String>,
    /// 旧版兼容字段；订阅版不再表示硬件机器码
    pub machine_hash: Option<String>,
}

/// 解绑设备响应
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DeactivateLeaseResponse {
    /// 是否成功
    pub deactivated: bool,
}

/// 管理员查询 Lease 记录响应
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AdminLeaseItem {
    /// 事件 ID
    pub id: String,
    /// 激活码
    pub activation_code: String,
    /// 安装实例 ID
    pub client_install_id: String,
    /// 旧版兼容字段
    pub machine_hash: String,
    /// 平台
    pub platform: String,
    /// IP 地址
    pub ip_address: String,
    /// 事件类型：activate / verify / renew / deactivate / selector_fetch
    pub event_type: String,
    /// 结果：success / failed
    pub status: String,
    /// 失败或附加原因
    pub reason: Option<String>,
    /// 授权到期时间
    pub expires_at: Option<String>,
    /// 事件时间
    pub created_at: String,
}

/// 管理员查询 DAU 统计
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DauStat {
    /// 日期
    pub date: String,
    /// 激活数
    pub activations: i64,
    /// 验证数（去重用户）
    pub verifications: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AdminLeaseListResponse {
    pub items: Vec<AdminLeaseItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DauStatListResponse {
    pub items: Vec<DauStat>,
}
