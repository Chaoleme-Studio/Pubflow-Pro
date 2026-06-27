use chrono::Utc;
use entity::{app_version, product_catalog};
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, Order, QueryFilter, QueryOrder, QuerySelect,
};

use crate::AppState;
use crate::PubFlowError;
use crate::ValidationError;
use crate::shared::FromState;

use super::dto::{
    DownloadItem, PlanItem, ProductCatalogResponse, ProductVersionListResponse,
    ProductVersionResponse,
};

pub struct ProductService {
    db: DatabaseConnection,
}

impl FromState for ProductService {
    fn from_state(state: &AppState) -> Self {
        Self {
            db: state.db.clone(),
        }
    }
}

impl ProductService {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }

    pub async fn catalog(&self) -> Result<ProductCatalogResponse, crate::AppError> {
        let rows = product_catalog::Entity::find()
            .filter(product_catalog::Column::IsActive.eq(true))
            .order_by(product_catalog::Column::SortOrder, Order::Asc)
            .all(&self.db)
            .await?;

        let plans = rows
            .iter()
            .filter(|item| item.kind == "plan")
            .map(|item| {
                let pricing = effective_plan_pricing(item);
                PlanItem {
                    id: item.code.clone(),
                    name: item.name.clone(),
                    price: cents_to_yuan(pricing.amount_cents),
                    unit: item.unit.clone().unwrap_or_default(),
                    note: item.note.clone().unwrap_or_default(),
                    amount_cents: pricing.amount_cents,
                    original_amount_cents: pricing.original_amount_cents,
                    discount_amount_cents: item.discount_amount_cents,
                    discount_start_at: item
                        .discount_start_at
                        .map(|value| value.with_timezone(&Utc)),
                    discount_end_at: item.discount_end_at.map(|value| value.with_timezone(&Utc)),
                    discount_enabled: item.discount_enabled,
                    is_discount_active: pricing.is_discount_active,
                    savings_cents: pricing.savings_cents,
                }
            })
            .collect();

        let downloads = rows
            .into_iter()
            .filter(|item| item.kind == "download" && is_extension_download(item))
            .map(|item| DownloadItem {
                platform: item.platform.unwrap_or(item.code),
                name: item.name,
                chip: item.chip.unwrap_or_default(),
                file_name: item.file_name.unwrap_or_default(),
                href: item.href.unwrap_or_default(),
            })
            .collect();

        Ok(ProductCatalogResponse { plans, downloads })
    }

    pub async fn plan_amount_cents(&self, plan: &str) -> Result<i32, crate::AppError> {
        let row = product_catalog::Entity::find()
            .filter(product_catalog::Column::Kind.eq("plan"))
            .filter(product_catalog::Column::Code.eq(plan))
            .filter(product_catalog::Column::IsActive.eq(true))
            .one(&self.db)
            .await?
            .ok_or_else(|| ValidationError::custom("套餐配置不存在或已停用"))?;

        Ok(effective_plan_pricing(&row).amount_cents)
    }

    pub async fn latest_version(
        &self,
        platform: Option<String>,
    ) -> Result<ProductVersionResponse, crate::AppError> {
        let platform = normalize_platform(platform);
        let row = app_version::Entity::find()
            .filter(app_version::Column::Platform.eq(&platform))
            .filter(app_version::Column::IsActive.eq(true))
            .order_by(app_version::Column::CreatedAt, Order::Desc)
            .one(&self.db)
            .await?
            .ok_or(PubFlowError::AppVersionNotFound)?;

        Ok(to_product_version_response(row))
    }

    pub async fn recent_versions(
        &self,
        platform: Option<String>,
        limit: Option<u64>,
    ) -> Result<ProductVersionListResponse, crate::AppError> {
        let platform = normalize_platform(platform);
        let limit = limit.unwrap_or(3).clamp(1, 20);
        let rows = app_version::Entity::find()
            .filter(app_version::Column::Platform.eq(&platform))
            .filter(app_version::Column::IsActive.eq(true))
            .order_by(app_version::Column::CreatedAt, Order::Desc)
            .limit(limit)
            .all(&self.db)
            .await?;

        Ok(ProductVersionListResponse {
            items: rows.into_iter().map(to_product_version_response).collect(),
        })
    }
}

pub struct EffectivePlanPricing {
    pub amount_cents: i32,
    pub original_amount_cents: Option<i32>,
    pub is_discount_active: bool,
    pub savings_cents: i32,
}

pub fn effective_plan_pricing(item: &product_catalog::Model) -> EffectivePlanPricing {
    let base_amount = item
        .original_amount_cents
        .or(item.amount_cents)
        .unwrap_or_default();
    let now = Utc::now();
    let in_window = item
        .discount_start_at
        .is_none_or(|start| start.with_timezone(&Utc) <= now)
        && item
            .discount_end_at
            .is_none_or(|end| end.with_timezone(&Utc) >= now);
    let discount_amount = item.discount_amount_cents.unwrap_or(base_amount);
    let is_discount_active =
        item.discount_enabled && in_window && discount_amount > 0 && discount_amount < base_amount;
    let amount_cents = if is_discount_active {
        discount_amount
    } else {
        base_amount
    };

    EffectivePlanPricing {
        amount_cents,
        original_amount_cents: (base_amount > amount_cents).then_some(base_amount),
        is_discount_active,
        savings_cents: (base_amount - amount_cents).max(0),
    }
}

fn cents_to_yuan(amount_cents: i32) -> String {
    let yuan = amount_cents / 100;
    let cents = amount_cents.abs() % 100;
    if cents == 0 {
        yuan.to_string()
    } else {
        format!("{yuan}.{cents:02}")
    }
}

fn is_extension_download(item: &product_catalog::Model) -> bool {
    item.platform.as_deref() == Some("extension")
        || item.code == "zip"
        || item.code == "crx"
        || item
            .file_name
            .as_deref()
            .is_some_and(|name| name.ends_with(".zip") || name.ends_with(".crx"))
}

fn normalize_platform(platform: Option<String>) -> String {
    platform
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "extension".to_string())
}

fn to_product_version_response(row: app_version::Model) -> ProductVersionResponse {
    let min_version = row
        .min_app_version
        .clone()
        .unwrap_or_else(|| "0.1.0".to_string());
    ProductVersionResponse {
        id: row.id.to_string(),
        platform: row.platform,
        version: row.version.clone(),
        latest_version: row.version,
        min_version,
        min_app_version: row.min_app_version,
        download_url: row.download_url,
        release_notes: row.release_notes.unwrap_or_default(),
        force_update: row.force_update,
        created_at: row.created_at.with_timezone(&Utc),
    }
}
