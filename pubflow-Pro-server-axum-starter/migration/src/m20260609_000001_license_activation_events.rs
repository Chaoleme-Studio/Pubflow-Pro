use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(LicenseBatches::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(LicenseBatches::Id)
                            .uuid()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(LicenseBatches::BatchName)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LicenseBatches::SalesChannel)
                            .string()
                            .not_null()
                            .default("third_party"),
                    )
                    .col(ColumnDef::new(LicenseBatches::Plan).string().not_null())
                    .col(
                        ColumnDef::new(LicenseBatches::Quantity)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LicenseBatches::MaxDevices)
                            .integer()
                            .not_null()
                            .default(1),
                    )
                    .col(
                        ColumnDef::new(LicenseBatches::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .col(
                        ColumnDef::new(LicenseBatches::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Licenses::Table)
                    .add_column(
                        ColumnDef::new(Licenses::Plan)
                            .string()
                            .not_null()
                            .default("monthly"),
                    )
                    .add_column(
                        ColumnDef::new(Licenses::SourceChannel)
                            .string()
                            .not_null()
                            .default("official"),
                    )
                    .add_column(ColumnDef::new(Licenses::BatchId).uuid())
                    .modify_column(ColumnDef::new(Licenses::ExpiresAt).timestamp_with_time_zone())
                    .to_owned(),
            )
            .await?;

        manager
            .create_foreign_key(
                ForeignKey::create()
                    .name("fk_licenses_batch_id")
                    .from(Licenses::Table, Licenses::BatchId)
                    .to(LicenseBatches::Table, LicenseBatches::Id)
                    .on_delete(ForeignKeyAction::SetNull)
                    .to_owned(),
            )
            .await?;

        manager
            .get_connection()
            .execute_unprepared("UPDATE licenses SET expires_at = NULL WHERE activated_at IS NULL")
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(LicenseEvents::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(LicenseEvents::Id)
                            .uuid()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(LicenseEvents::LicenseId).uuid())
                    .col(ColumnDef::new(LicenseEvents::LeaseId).uuid())
                    .col(ColumnDef::new(LicenseEvents::ActivationCode).string())
                    .col(ColumnDef::new(LicenseEvents::EventType).string().not_null())
                    .col(ColumnDef::new(LicenseEvents::Status).string().not_null())
                    .col(ColumnDef::new(LicenseEvents::Reason).string())
                    .col(
                        ColumnDef::new(LicenseEvents::IpAddress)
                            .string()
                            .not_null()
                            .default("unknown"),
                    )
                    .col(ColumnDef::new(LicenseEvents::MachineHash).string())
                    .col(ColumnDef::new(LicenseEvents::Platform).string())
                    .col(ColumnDef::new(LicenseEvents::ExtensionVersion).string())
                    .col(ColumnDef::new(LicenseEvents::UserAgent).string())
                    .col(ColumnDef::new(LicenseEvents::ExpiresAt).timestamp_with_time_zone())
                    .col(
                        ColumnDef::new(LicenseEvents::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_license_events_license_id")
                            .from(LicenseEvents::Table, LicenseEvents::LicenseId)
                            .to(Licenses::Table, Licenses::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_license_events_lease_id")
                            .from(LicenseEvents::Table, LicenseEvents::LeaseId)
                            .to(Leases::Table, Leases::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .to_owned(),
            )
            .await?;

        create_index(
            manager,
            "idx_license_batches_channel",
            LicenseBatches::Table,
            vec![LicenseBatches::SalesChannel],
        )
        .await?;
        create_index(
            manager,
            "idx_licenses_status",
            Licenses::Table,
            vec![Licenses::IsRevoked, Licenses::ActivatedAt],
        )
        .await?;
        create_index(
            manager,
            "idx_licenses_batch_id",
            Licenses::Table,
            vec![Licenses::BatchId],
        )
        .await?;
        create_index(
            manager,
            "idx_licenses_source_channel",
            Licenses::Table,
            vec![Licenses::SourceChannel],
        )
        .await?;
        create_index(
            manager,
            "idx_license_events_created_at",
            LicenseEvents::Table,
            vec![LicenseEvents::CreatedAt],
        )
        .await?;
        create_index(
            manager,
            "idx_license_events_license_id",
            LicenseEvents::Table,
            vec![LicenseEvents::LicenseId],
        )
        .await?;
        create_index(
            manager,
            "idx_license_events_machine_hash",
            LicenseEvents::Table,
            vec![LicenseEvents::MachineHash],
        )
        .await?;
        create_index(
            manager,
            "idx_license_events_type",
            LicenseEvents::Table,
            vec![LicenseEvents::EventType],
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(LicenseEvents::Table).to_owned())
            .await?;
        manager
            .drop_foreign_key(
                ForeignKey::drop()
                    .name("fk_licenses_batch_id")
                    .table(Licenses::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Licenses::Table)
                    .drop_column(Licenses::Plan)
                    .drop_column(Licenses::SourceChannel)
                    .drop_column(Licenses::BatchId)
                    .modify_column(
                        ColumnDef::new(Licenses::ExpiresAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(LicenseBatches::Table).to_owned())
            .await
    }
}

async fn create_index<T, C>(
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
enum Licenses {
    Table,
    Id,
    Plan,
    SourceChannel,
    BatchId,
    ActivatedAt,
    ExpiresAt,
    IsRevoked,
}

#[derive(DeriveIden)]
enum Leases {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum LicenseBatches {
    Table,
    Id,
    BatchName,
    SalesChannel,
    Plan,
    Quantity,
    MaxDevices,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum LicenseEvents {
    Table,
    Id,
    LicenseId,
    LeaseId,
    ActivationCode,
    EventType,
    Status,
    Reason,
    IpAddress,
    MachineHash,
    Platform,
    ExtensionVersion,
    UserAgent,
    ExpiresAt,
    CreatedAt,
}
