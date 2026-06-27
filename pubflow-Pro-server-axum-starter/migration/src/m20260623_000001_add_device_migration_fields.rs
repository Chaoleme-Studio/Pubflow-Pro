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
                        ColumnDef::new(Licenses::DeviceMigrationLimit)
                            .integer()
                            .not_null()
                            .default(3),
                    )
                    .add_column(
                        ColumnDef::new(Licenses::DeviceMigrationCount)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .add_column(
                        ColumnDef::new(Licenses::LastMigratedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Licenses::Table)
                    .drop_column(Licenses::LastMigratedAt)
                    .drop_column(Licenses::DeviceMigrationCount)
                    .drop_column(Licenses::DeviceMigrationLimit)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Licenses {
    Table,
    DeviceMigrationLimit,
    DeviceMigrationCount,
    LastMigratedAt,
}
