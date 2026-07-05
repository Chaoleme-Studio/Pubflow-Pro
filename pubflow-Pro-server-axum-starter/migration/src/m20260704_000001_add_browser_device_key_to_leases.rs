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
                    .add_column(ColumnDef::new(Leases::DeviceKeyId).string().null())
                    .add_column(ColumnDef::new(Leases::DevicePublicKeySpki).text().null())
                    .add_column(ColumnDef::new(Leases::DeviceKeyAlgorithm).string().null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_leases_device_key_id")
                    .table(Leases::Table)
                    .col(Leases::DeviceKeyId)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_leases_device_key_id")
                    .table(Leases::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Leases::Table)
                    .drop_column(Leases::DeviceKeyAlgorithm)
                    .drop_column(Leases::DevicePublicKeySpki)
                    .drop_column(Leases::DeviceKeyId)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Leases {
    Table,
    DeviceKeyId,
    DevicePublicKeySpki,
    DeviceKeyAlgorithm,
}
