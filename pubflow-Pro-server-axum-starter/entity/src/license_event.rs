use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "license_events")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub license_id: Option<Uuid>,
    pub lease_id: Option<Uuid>,
    pub activation_code: Option<String>,
    pub event_type: String,
    pub status: String,
    pub reason: Option<String>,
    pub ip_address: String,
    pub machine_hash: Option<String>,
    pub platform: Option<String>,
    pub extension_version: Option<String>,
    pub user_agent: Option<String>,
    pub expires_at: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::license::Entity",
        from = "Column::LicenseId",
        to = "super::license::Column::Id"
    )]
    License,
    #[sea_orm(
        belongs_to = "super::lease::Entity",
        from = "Column::LeaseId",
        to = "super::lease::Column::Id"
    )]
    Lease,
}

impl Related<super::license::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::License.def()
    }
}

impl Related<super::lease::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Lease.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
