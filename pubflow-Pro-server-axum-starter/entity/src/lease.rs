use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "leases")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,

    /// 关联的 license ID
    pub license_id: Uuid,

    /// lease 类型：subscription / perpetual
    pub lease_type: String,

    /// 订阅等级：pro / enterprise
    pub tier: String,

    /// 功能列表，JSON 格式
    pub features: String,

    /// 签名后的 lease token
    pub lease_token: String,

    /// 生效时间
    pub valid_from: DateTimeWithTimeZone,

    /// 失效时间
    pub valid_until: DateTimeWithTimeZone,

    /// 最低插件版本要求
    pub min_extension_version: String,

    /// 策略版本号
    pub policy_version: i32,

    /// 是否已吊销
    pub is_revoked: bool,

    /// 客户端 IP 地址
    pub ip_address: String,

    /// 机器码哈希
    pub machine_hash: String,

    /// 平台：macos / windows / linux
    pub platform: String,

    /// 创建时间
    pub created_at: DateTimeWithTimeZone,

    /// 更新时间
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::license::Entity",
        from = "Column::LicenseId",
        to = "super::license::Column::Id"
    )]
    License,
}

impl Related<super::license::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::License.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
