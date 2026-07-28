use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "remote_web_sessions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub license_id: Uuid,
    #[sea_orm(unique)]
    pub access_token_hash: String,
    pub access_expires_at: DateTimeWithTimeZone,
    #[sea_orm(unique)]
    pub refresh_token_hash: String,
    pub refresh_expires_at: DateTimeWithTimeZone,
    pub last_seen_at: DateTimeWithTimeZone,
    pub revoked_at: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
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
