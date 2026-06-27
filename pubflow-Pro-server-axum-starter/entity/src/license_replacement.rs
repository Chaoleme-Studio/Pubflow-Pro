use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "license_replacements")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub old_license_id: Uuid,
    pub new_license_id: Uuid,
    pub reason: String,
    pub operator: String,
    pub revoked_old: bool,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::license::Entity",
        from = "Column::OldLicenseId",
        to = "super::license::Column::Id"
    )]
    OldLicense,
    #[sea_orm(
        belongs_to = "super::license::Entity",
        from = "Column::NewLicenseId",
        to = "super::license::Column::Id"
    )]
    NewLicense,
}

impl ActiveModelBehavior for ActiveModel {}
