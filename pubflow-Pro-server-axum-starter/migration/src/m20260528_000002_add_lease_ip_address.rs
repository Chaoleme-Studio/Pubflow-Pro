use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 添加 IP 地址字段
        manager
            .alter_table(
                Table::alter()
                    .table(Leases::Table)
                    .add_column(
                        ColumnDef::new(Leases::IpAddress)
                            .string()
                            .default("unknown"),
                    )
                    .to_owned(),
            )
            .await?;

        // 添加 created_at 索引用于时间范围查询
        manager
            .create_index(
                Index::create()
                    .name("idx_leases_created_at")
                    .table(Leases::Table)
                    .col(Leases::CreatedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name("idx_leases_created_at").to_owned())
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Leases::Table)
                    .drop_column(Leases::IpAddress)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

#[derive(DeriveIden)]
enum Leases {
    Table,
    IpAddress,
    CreatedAt,
}
