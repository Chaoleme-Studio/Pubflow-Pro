use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        add_string_column(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::Tier,
            "tier",
            "basic",
        )
        .await?;
        add_string_column(
            manager,
            Orders::Table,
            "orders",
            Orders::Tier,
            "tier",
            "pro",
        )
        .await?;
        add_string_column(
            manager,
            LicenseBatches::Table,
            "license_batches",
            LicenseBatches::Tier,
            "tier",
            "pro",
        )
        .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_product_catalog_kind_code")
                    .table(ProductCatalog::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_product_catalog_kind_code_tier")
                    .table(ProductCatalog::Table)
                    .col(ProductCatalog::Kind)
                    .col(ProductCatalog::Code)
                    .col(ProductCatalog::Tier)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_product_catalog_kind_code_tier")
                    .table(ProductCatalog::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_product_catalog_kind_code")
                    .table(ProductCatalog::Table)
                    .col(ProductCatalog::Kind)
                    .col(ProductCatalog::Code)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;
        drop_column(
            manager,
            LicenseBatches::Table,
            "license_batches",
            LicenseBatches::Tier,
            "tier",
        )
        .await?;
        drop_column(manager, Orders::Table, "orders", Orders::Tier, "tier").await?;
        drop_column(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::Tier,
            "tier",
        )
        .await
    }
}

async fn add_string_column<T, C>(
    manager: &SchemaManager<'_>,
    table: T,
    table_name: &str,
    column: C,
    column_name: &str,
    default: &str,
) -> Result<(), DbErr>
where
    T: Iden + 'static,
    C: Iden + 'static,
{
    if !manager.has_column(table_name, column_name).await? {
        manager
            .alter_table(
                Table::alter()
                    .table(table)
                    .add_column(ColumnDef::new(column).string().not_null().default(default))
                    .to_owned(),
            )
            .await?;
    }
    Ok(())
}

async fn drop_column<T, C>(
    manager: &SchemaManager<'_>,
    table: T,
    table_name: &str,
    column: C,
    column_name: &str,
) -> Result<(), DbErr>
where
    T: Iden + 'static,
    C: Iden + 'static,
{
    if manager.has_column(table_name, column_name).await? {
        manager
            .alter_table(Table::alter().table(table).drop_column(column).to_owned())
            .await?;
    }
    Ok(())
}

#[derive(DeriveIden)]
enum ProductCatalog {
    Table,
    Kind,
    Code,
    Tier,
}

#[derive(DeriveIden)]
enum Orders {
    Table,
    Tier,
}

#[derive(DeriveIden)]
enum LicenseBatches {
    Table,
    Tier,
}
