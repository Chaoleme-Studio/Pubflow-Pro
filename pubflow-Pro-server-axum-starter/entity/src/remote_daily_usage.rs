use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "remote_daily_usage")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub license_id: Uuid,
    #[sea_orm(primary_key, auto_increment = false)]
    pub usage_date: Date,
    pub job_count: i32,
    pub byte_count: i64,
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
