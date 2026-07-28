use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "remote_jobs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub license_id: Uuid,
    pub request_id: String,
    pub project_id: Uuid,
    pub content_type: String,
    pub title: String,
    pub platforms_json: String,
    pub request_json: String,
    pub project_json: Option<String>,
    pub publish_mode: String,
    pub status: String,
    pub status_sequence: i64,
    pub declared_bytes: i64,
    pub claimed_install_id: Option<String>,
    pub claimed_at: Option<DateTimeWithTimeZone>,
    pub error: Option<String>,
    pub completed_at: Option<DateTimeWithTimeZone>,
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
    #[sea_orm(has_many = "super::remote_asset::Entity")]
    RemoteAssets,
}

impl Related<super::license::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::License.def()
    }
}
impl Related<super::remote_asset::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RemoteAssets.def()
    }
}
impl ActiveModelBehavior for ActiveModel {}
