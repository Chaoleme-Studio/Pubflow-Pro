use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(LicenseEvents::Table)
                    .add_column(ColumnDef::new(LicenseEvents::Operator).string().null())
                    .add_column(ColumnDef::new(LicenseEvents::TargetId).string().null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_license_events_operator")
                    .table(LicenseEvents::Table)
                    .col(LicenseEvents::Operator)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_license_events_target_id")
                    .table(LicenseEvents::Table)
                    .col(LicenseEvents::TargetId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_license_events_target_id")
                    .table(LicenseEvents::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_license_events_operator")
                    .table(LicenseEvents::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(LicenseEvents::Table)
                    .drop_column(LicenseEvents::TargetId)
                    .drop_column(LicenseEvents::Operator)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum LicenseEvents {
    Table,
    Operator,
    TargetId,
}
