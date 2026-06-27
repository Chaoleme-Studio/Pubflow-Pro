use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AppVersions::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AppVersions::Id)
                            .uuid()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AppVersions::Platform).string().not_null())
                    .col(ColumnDef::new(AppVersions::Version).string().not_null())
                    .col(ColumnDef::new(AppVersions::MinAppVersion).string())
                    .col(ColumnDef::new(AppVersions::DownloadUrl).text().not_null())
                    .col(ColumnDef::new(AppVersions::ReleaseNotes).text())
                    .col(
                        ColumnDef::new(AppVersions::ForceUpdate)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(AppVersions::IsActive)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(AppVersions::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .col(
                        ColumnDef::new(AppVersions::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_app_versions_platform_created")
                    .if_not_exists()
                    .table(AppVersions::Table)
                    .col(AppVersions::Platform)
                    .col(AppVersions::CreatedAt)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_app_versions_platform_version")
                    .if_not_exists()
                    .table(AppVersions::Table)
                    .col(AppVersions::Platform)
                    .col(AppVersions::Version)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AppVersions::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AppVersions {
    Table,
    Id,
    Platform,
    Version,
    MinAppVersion,
    DownloadUrl,
    ReleaseNotes,
    ForceUpdate,
    IsActive,
    CreatedAt,
    UpdatedAt,
}
