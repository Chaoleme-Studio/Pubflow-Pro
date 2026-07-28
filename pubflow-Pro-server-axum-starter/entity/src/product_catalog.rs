use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "product_catalog")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub kind: String,
    pub code: String,
    pub tier: String,
    pub name: String,
    pub price: Option<String>,
    pub unit: Option<String>,
    pub note: Option<String>,
    pub amount_cents: Option<i32>,
    pub original_amount_cents: Option<i32>,
    pub discount_amount_cents: Option<i32>,
    pub discount_start_at: Option<DateTimeWithTimeZone>,
    pub discount_end_at: Option<DateTimeWithTimeZone>,
    pub discount_enabled: bool,
    pub platform: Option<String>,
    pub chip: Option<String>,
    pub file_name: Option<String>,
    pub href: Option<String>,
    pub sort_order: i32,
    pub is_active: bool,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
