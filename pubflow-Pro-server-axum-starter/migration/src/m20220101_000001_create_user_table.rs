use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(User::Table)
                    .if_not_exists()
                    .col(pk_auto(User::Id))
                    .col(string_uniq(User::Username))
                    .col(string_uniq(User::Email))
                    .col(string(User::PasswordHash))
                    .col(small_integer(User::Status).default(0))
                    .col(
                        timestamp_with_time_zone(User::CreatedAt)
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .col(
                        timestamp_with_time_zone(User::UpdatedAt)
                            .extra("DEFAULT CURRENT_TIMESTAMP"),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(User::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum User {
    /// 表名
    Table,

    /// 用户 ID，主键，自增
    Id,

    /// 用户名，唯一
    Username,

    /// 邮箱，唯一
    Email,

    /// 密码哈希值
    PasswordHash,

    /// 用户状态（0=激活，1=停用，2=删除）
    Status,

    /// 创建时间，自动设置当前时间戳
    CreatedAt,

    /// 更新时间，自动设置当前时间戳
    UpdatedAt,
}
