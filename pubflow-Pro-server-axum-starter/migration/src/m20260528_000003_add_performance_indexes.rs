use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // orders.license_id 索引（用于批量查询关联订单）
        manager
            .create_index(
                Index::create()
                    .name("idx_orders_license_id")
                    .table(Orders::Table)
                    .col(Orders::LicenseId)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        // leases.lease_token 唯一索引（用于 lease 验证/续租查询）
        manager
            .create_index(
                Index::create()
                    .name("idx_leases_lease_token")
                    .table(Leases::Table)
                    .col(Leases::LeaseToken)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        // leases(license_id, is_revoked) 复合索引（最常用的筛选组合）
        manager
            .create_index(
                Index::create()
                    .name("idx_leases_license_revoked")
                    .table(Leases::Table)
                    .col(Leases::LicenseId)
                    .col(Leases::IsRevoked)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        // leases(valid_until) 索引（用于检查 lease 过期）
        manager
            .create_index(
                Index::create()
                    .name("idx_leases_valid_until")
                    .table(Leases::Table)
                    .col(Leases::ValidUntil)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name("idx_orders_license_id").to_owned())
            .await?;
        manager
            .drop_index(Index::drop().name("idx_leases_lease_token").to_owned())
            .await?;
        manager
            .drop_index(Index::drop().name("idx_leases_license_revoked").to_owned())
            .await?;
        manager
            .drop_index(Index::drop().name("idx_leases_valid_until").to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Orders {
    Table,
    LicenseId,
}

#[derive(DeriveIden)]
enum Leases {
    Table,
    LicenseId,
    IsRevoked,
    LeaseToken,
    ValidUntil,
}
