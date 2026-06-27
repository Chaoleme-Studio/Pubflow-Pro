use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        add_column_if_missing(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::OriginalAmountCents,
            "original_amount_cents",
            ColumnDef::new(ProductCatalog::OriginalAmountCents).integer(),
        )
        .await?;
        add_column_if_missing(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::DiscountAmountCents,
            "discount_amount_cents",
            ColumnDef::new(ProductCatalog::DiscountAmountCents).integer(),
        )
        .await?;
        add_column_if_missing(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::DiscountStartAt,
            "discount_start_at",
            ColumnDef::new(ProductCatalog::DiscountStartAt).timestamp_with_time_zone(),
        )
        .await?;
        add_column_if_missing(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::DiscountEndAt,
            "discount_end_at",
            ColumnDef::new(ProductCatalog::DiscountEndAt).timestamp_with_time_zone(),
        )
        .await?;
        add_column_if_missing(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::DiscountEnabled,
            "discount_enabled",
            ColumnDef::new(ProductCatalog::DiscountEnabled)
                .boolean()
                .not_null()
                .default(false),
        )
        .await?;

        manager
            .create_table(
                Table::create()
                    .table(LicenseReplacements::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(LicenseReplacements::Id)
                            .uuid()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(LicenseReplacements::OldLicenseId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LicenseReplacements::NewLicenseId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LicenseReplacements::Reason)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LicenseReplacements::Operator)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LicenseReplacements::RevokedOld)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(LicenseReplacements::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_license_replacements_old_license")
                            .from(
                                LicenseReplacements::Table,
                                LicenseReplacements::OldLicenseId,
                            )
                            .to(Licenses::Table, Licenses::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_license_replacements_new_license")
                            .from(
                                LicenseReplacements::Table,
                                LicenseReplacements::NewLicenseId,
                            )
                            .to(Licenses::Table, Licenses::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        create_index_if_missing(
            manager,
            "idx_license_replacements_old_license",
            LicenseReplacements::Table,
            vec![LicenseReplacements::OldLicenseId],
        )
        .await?;
        create_index_if_missing(
            manager,
            "idx_license_replacements_new_license",
            LicenseReplacements::Table,
            vec![LicenseReplacements::NewLicenseId],
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(LicenseReplacements::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;

        drop_column_if_exists(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::DiscountEnabled,
            "discount_enabled",
        )
        .await?;
        drop_column_if_exists(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::DiscountEndAt,
            "discount_end_at",
        )
        .await?;
        drop_column_if_exists(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::DiscountStartAt,
            "discount_start_at",
        )
        .await?;
        drop_column_if_exists(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::DiscountAmountCents,
            "discount_amount_cents",
        )
        .await?;
        drop_column_if_exists(
            manager,
            ProductCatalog::Table,
            "product_catalog",
            ProductCatalog::OriginalAmountCents,
            "original_amount_cents",
        )
        .await
    }
}

async fn add_column_if_missing<T, C>(
    manager: &SchemaManager<'_>,
    table: T,
    table_name: &str,
    _column: C,
    column_name: &str,
    column_def: &mut ColumnDef,
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
                    .add_column(column_def.to_owned())
                    .to_owned(),
            )
            .await?;
    }
    Ok(())
}

async fn drop_column_if_exists<T, C>(
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

async fn create_index_if_missing<T, C>(
    manager: &SchemaManager<'_>,
    name: &str,
    table: T,
    columns: Vec<C>,
) -> Result<(), DbErr>
where
    T: IntoIden + 'static,
    C: IntoIden + 'static,
{
    let mut index = Index::create();
    index.name(name).if_not_exists().table(table);
    for column in columns {
        index.col(column);
    }
    manager.create_index(index.to_owned()).await
}

#[derive(DeriveIden)]
enum ProductCatalog {
    Table,
    OriginalAmountCents,
    DiscountAmountCents,
    DiscountStartAt,
    DiscountEndAt,
    DiscountEnabled,
}

#[derive(DeriveIden)]
enum LicenseReplacements {
    Table,
    Id,
    OldLicenseId,
    NewLicenseId,
    Reason,
    Operator,
    RevokedOld,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Licenses {
    Table,
    Id,
}
