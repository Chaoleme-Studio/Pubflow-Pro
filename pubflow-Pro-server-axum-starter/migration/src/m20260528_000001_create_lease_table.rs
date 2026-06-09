use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Leases::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Leases::Id).uuid().not_null().primary_key())
                    .col(ColumnDef::new(Leases::LicenseId).uuid().not_null())
                    .col(ColumnDef::new(Leases::MachineHash).string().not_null())
                    .col(ColumnDef::new(Leases::Platform).string().not_null())
                    .col(
                        ColumnDef::new(Leases::LeaseType)
                            .string()
                            .not_null()
                            .default("subscription"),
                    )
                    .col(
                        ColumnDef::new(Leases::Tier)
                            .string()
                            .not_null()
                            .default("pro"),
                    )
                    .col(
                        ColumnDef::new(Leases::Features)
                            .string()
                            .not_null()
                            .default("[]"),
                    )
                    .col(ColumnDef::new(Leases::LeaseToken).text().not_null())
                    .col(
                        ColumnDef::new(Leases::ValidFrom)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Leases::ValidUntil)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Leases::MinExtensionVersion)
                            .string()
                            .not_null()
                            .default("0.1.0"),
                    )
                    .col(
                        ColumnDef::new(Leases::PolicyVersion)
                            .integer()
                            .not_null()
                            .default(1),
                    )
                    .col(
                        ColumnDef::new(Leases::IsRevoked)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(Leases::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Leases::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_leases_license_id")
                            .from(Leases::Table, Leases::LicenseId)
                            .to(Licenses::Table, Licenses::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // 创建索引
        manager
            .create_index(
                Index::create()
                    .name("idx_leases_license_id")
                    .table(Leases::Table)
                    .col(Leases::LicenseId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_leases_machine_hash")
                    .table(Leases::Table)
                    .col(Leases::MachineHash)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_leases_valid_until")
                    .table(Leases::Table)
                    .col(Leases::ValidUntil)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Leases::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Leases {
    Table,
    Id,
    LicenseId,
    MachineHash,
    Platform,
    LeaseType,
    Tier,
    Features,
    LeaseToken,
    ValidFrom,
    ValidUntil,
    MinExtensionVersion,
    PolicyVersion,
    IsRevoked,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Licenses {
    Table,
    Id,
}
