use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Licenses::Table)
                    .if_not_exists()
                    .col(uuid(Licenses::Id).primary_key())
                    .col(integer_null(Licenses::UserId))
                    .col(string_uniq(Licenses::ActivationCode))
                    .col(string(Licenses::Tier).default("pro"))
                    .col(text_null(Licenses::LicenseJson))
                    .col(text_null(Licenses::Signature))
                    .col(integer(Licenses::MaxDevices).default(1))
                    .col(timestamp_with_time_zone_null(Licenses::ActivatedAt))
                    .col(timestamp_with_time_zone(Licenses::ExpiresAt))
                    .col(boolean(Licenses::IsRevoked).default(false))
                    .col(
                        timestamp_with_time_zone(Licenses::CreatedAt)
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .col(
                        timestamp_with_time_zone(Licenses::UpdatedAt)
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_licenses_user_id")
                            .from(Licenses::Table, Licenses::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Selectors::Table)
                    .if_not_exists()
                    .col(uuid(Selectors::Id).primary_key())
                    .col(integer(Selectors::Version))
                    .col(text(Selectors::EncryptedData))
                    .col(string(Selectors::Checksum))
                    .col(string(Selectors::MinAppVersion).default("0.1.0"))
                    .col(boolean(Selectors::IsActive).default(true))
                    .col(
                        timestamp_with_time_zone(Selectors::CreatedAt)
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Orders::Table)
                    .if_not_exists()
                    .col(uuid(Orders::Id).primary_key())
                    .col(string_uniq(Orders::OrderNo))
                    .col(string(Orders::Plan))
                    .col(integer(Orders::AmountCents))
                    .col(string(Orders::Channel))
                    .col(string(Orders::Status).default("pending"))
                    .col(string_null(Orders::MachineHash))
                    .col(string_null(Orders::ActivationCode))
                    .col(uuid_null(Orders::LicenseId))
                    .col(timestamp_with_time_zone_null(Orders::PaidAt))
                    .col(
                        timestamp_with_time_zone(Orders::CreatedAt)
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .col(
                        timestamp_with_time_zone(Orders::UpdatedAt)
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_orders_license_id")
                            .from(Orders::Table, Orders::LicenseId)
                            .to(Licenses::Table, Licenses::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .to_owned(),
            )
            .await?;

        create_index(
            manager,
            "idx_licenses_code",
            Licenses::Table,
            Licenses::ActivationCode,
        )
        .await?;
        create_index(
            manager,
            "idx_licenses_user",
            Licenses::Table,
            Licenses::UserId,
        )
        .await?;
        create_index(
            manager,
            "idx_selectors_version",
            Selectors::Table,
            Selectors::Version,
        )
        .await?;
        create_index(manager, "idx_orders_status", Orders::Table, Orders::Status).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Orders::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Selectors::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Licenses::Table).to_owned())
            .await
    }
}

async fn create_index<T, C>(
    manager: &SchemaManager<'_>,
    name: &str,
    table: T,
    column: C,
) -> Result<(), DbErr>
where
    T: IntoIden + 'static,
    C: IntoIden + 'static,
{
    manager
        .create_index(
            Index::create()
                .name(name)
                .if_not_exists()
                .table(table)
                .col(column)
                .to_owned(),
        )
        .await
}

#[derive(DeriveIden)]
enum User {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Licenses {
    Table,
    Id,
    UserId,
    ActivationCode,
    Tier,
    LicenseJson,
    Signature,
    MaxDevices,
    ActivatedAt,
    ExpiresAt,
    IsRevoked,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Selectors {
    Table,
    Id,
    Version,
    EncryptedData,
    Checksum,
    MinAppVersion,
    IsActive,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Orders {
    Table,
    Id,
    OrderNo,
    Plan,
    AmountCents,
    Channel,
    Status,
    MachineHash,
    ActivationCode,
    LicenseId,
    PaidAt,
    CreatedAt,
    UpdatedAt,
}
