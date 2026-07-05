use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Licenses::Table)
                    .add_column(
                        ColumnDef::new(Licenses::DeletedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_licenses_deleted_at")
                    .table(Licenses::Table)
                    .col(Licenses::DeletedAt)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_licenses_deleted_at")
                    .table(Licenses::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Licenses::Table)
                    .drop_column(Licenses::DeletedAt)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Licenses {
    Table,
    DeletedAt,
}
