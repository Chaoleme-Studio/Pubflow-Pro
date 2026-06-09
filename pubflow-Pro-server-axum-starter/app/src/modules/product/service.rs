use entity::product_catalog;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, Order, QueryFilter, QueryOrder};

use crate::AppState;
use crate::shared::FromState;

use super::dto::{DownloadItem, PlanItem, ProductCatalogResponse};

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
    pub async fn catalog(&self) -> Result<ProductCatalogResponse, crate::AppError> {
        let rows = product_catalog::Entity::find()
            .filter(product_catalog::Column::IsActive.eq(true))
            .order_by(product_catalog::Column::SortOrder, Order::Asc)
            .all(&self.db)
            .await?;

        let plans = rows
            .iter()
            .filter(|item| item.kind == "plan")
            .map(|item| PlanItem {
                id: item.code.clone(),
                name: item.name.clone(),
                price: item.price.clone().unwrap_or_default(),
                unit: item.unit.clone().unwrap_or_default(),
                note: item.note.clone().unwrap_or_default(),
                amount_cents: item.amount_cents.unwrap_or_default(),
            })
            .collect();

        let downloads = rows
            .into_iter()
            .filter(|item| item.kind == "download")
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
}
