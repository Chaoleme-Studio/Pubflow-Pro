use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Leases::Table)
                    .add_column(ColumnDef::new(Leases::ClientInstallId).string().null())
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(LicenseEvents::Table)
                    .add_column(
                        ColumnDef::new(LicenseEvents::ClientInstallId)
                            .string()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .get_connection()
            .execute_unprepared(
                r#"
                UPDATE leases
                SET client_install_id = machine_hash
                WHERE client_install_id IS NULL
                  AND machine_hash LIKE 'install:%'
                "#,
            )
            .await?;

        manager
            .get_connection()
            .execute_unprepared(
                r#"
                UPDATE license_events
                SET client_install_id = machine_hash
                WHERE client_install_id IS NULL
                  AND machine_hash LIKE 'install:%'
                "#,
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_leases_client_install")
                    .table(Leases::Table)
                    .col(Leases::LicenseId)
                    .col(Leases::ClientInstallId)
                    .col(Leases::IsRevoked)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_license_events_client_install")
                    .table(LicenseEvents::Table)
                    .col(LicenseEvents::ClientInstallId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_license_events_client_install")
                    .table(LicenseEvents::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_leases_client_install")
                    .table(Leases::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(LicenseEvents::Table)
                    .drop_column(LicenseEvents::ClientInstallId)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Leases::Table)
                    .drop_column(Leases::ClientInstallId)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Leases {
    Table,
    LicenseId,
    ClientInstallId,
    IsRevoked,
}

#[derive(DeriveIden)]
enum LicenseEvents {
    Table,
    ClientInstallId,
}
