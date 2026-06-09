use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ProductCatalog::Table)
                    .if_not_exists()
                    .col(uuid(ProductCatalog::Id).primary_key())
                    .col(string(ProductCatalog::Kind))
                    .col(string(ProductCatalog::Code))
                    .col(string(ProductCatalog::Name))
                    .col(string_null(ProductCatalog::Price))
                    .col(string_null(ProductCatalog::Unit))
                    .col(string_null(ProductCatalog::Note))
                    .col(integer_null(ProductCatalog::AmountCents))
                    .col(string_null(ProductCatalog::Platform))
                    .col(string_null(ProductCatalog::Chip))
                    .col(string_null(ProductCatalog::FileName))
                    .col(string_null(ProductCatalog::Href))
                    .col(integer(ProductCatalog::SortOrder).default(0))
                    .col(boolean(ProductCatalog::IsActive).default(true))
                    .col(
                        timestamp_with_time_zone(ProductCatalog::CreatedAt)
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .col(
                        timestamp_with_time_zone(ProductCatalog::UpdatedAt)
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_product_catalog_kind_code")
                    .if_not_exists()
                    .table(ProductCatalog::Table)
                    .col(ProductCatalog::Kind)
                    .col(ProductCatalog::Code)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ProductCatalog::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ProductCatalog {
    Table,
    Id,
    Kind,
    Code,
    Name,
    Price,
    Unit,
    Note,
    AmountCents,
    Platform,
    Chip,
    FileName,
    Href,
    SortOrder,
    IsActive,
    CreatedAt,
    UpdatedAt,
}
