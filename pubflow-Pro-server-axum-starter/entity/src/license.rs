use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "licenses")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub user_id: Option<i32>,
    #[sea_orm(unique)]
    pub activation_code: String,
    pub tier: String,
    pub plan: String,
    pub source_channel: String,
    pub batch_id: Option<Uuid>,
    pub max_devices: i32,
    pub device_migration_limit: i32,
    pub device_migration_count: i32,
    pub last_migrated_at: Option<DateTimeWithTimeZone>,
    pub activated_at: Option<DateTimeWithTimeZone>,
    pub expires_at: Option<DateTimeWithTimeZone>,
    pub is_revoked: bool,
    pub deleted_at: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::license_batch::Entity",
        from = "Column::BatchId",
        to = "super::license_batch::Column::Id"
    )]
    LicenseBatch,
}

impl Related<super::license_batch::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::LicenseBatch.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
