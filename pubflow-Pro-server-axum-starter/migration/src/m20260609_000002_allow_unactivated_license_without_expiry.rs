use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE licenses ALTER COLUMN expires_at DROP NOT NULL")
            .await?;
        manager
            .get_connection()
            .execute_unprepared("UPDATE licenses SET expires_at = NULL WHERE activated_at IS NULL")
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "UPDATE licenses SET expires_at = CURRENT_TIMESTAMP WHERE expires_at IS NULL",
            )
            .await?;
        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE licenses ALTER COLUMN expires_at SET NOT NULL")
            .await?;
        Ok(())
    }
}
