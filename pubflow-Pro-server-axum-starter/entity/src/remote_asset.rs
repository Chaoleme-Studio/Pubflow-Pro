use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "remote_assets")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub job_id: Uuid,
    pub role: String,
    pub file_name: String,
    pub content_type: Option<String>,
    pub declared_size: i64,
    pub sha256: String,
    pub storage_path: Option<String>,
    pub status: String,
    pub created_at: DateTimeWithTimeZone,
    pub committed_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::remote_job::Entity",
        from = "Column::JobId",
        to = "super::remote_job::Column::Id"
    )]
    RemoteJob,
}

impl Related<super::remote_job::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RemoteJob.def()
    }
}
impl ActiveModelBehavior for ActiveModel {}
