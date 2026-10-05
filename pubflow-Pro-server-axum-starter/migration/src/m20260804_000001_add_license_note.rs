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
                    .add_column(ColumnDef::new(Licenses::Note).string())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Licenses::Table)
                    .drop_column(Licenses::Note)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Licenses {
    Table,
    Note,
}
