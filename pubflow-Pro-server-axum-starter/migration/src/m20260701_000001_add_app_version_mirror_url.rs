use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(AppVersions::Table)
                    .add_column(ColumnDef::new(AppVersions::DownloadUrlMirror).text().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(AppVersions::Table)
                    .drop_column(AppVersions::DownloadUrlMirror)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AppVersions {
    Table,
    DownloadUrlMirror,
}
