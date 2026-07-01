use sea_orm_migration::{prelude::*, sea_orm::ConnectionTrait};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r#"
UPDATE app_versions
SET download_url = '/v1/downloads/',
    updated_at = CURRENT_TIMESTAMP
WHERE platform = 'extension'
  AND (
    download_url LIKE '/downloads/%'
    OR download_url LIKE '/download-files/%'
    OR download_url LIKE '/static/downloads/%'
  )
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE product_catalog
SET platform = 'extension',
    file_name = 'pubflow-extension.zip',
    href = '/v1/downloads/pubflow-extension.zip',
    is_active = TRUE,
    updated_at = CURRENT_TIMESTAMP
WHERE kind = 'download'
  AND code = 'zip'
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE product_catalog
SET platform = 'extension',
    file_name = 'pubflow-extension.crx',
    href = '/v1/downloads/pubflow-extension.crx',
    is_active = TRUE,
    updated_at = CURRENT_TIMESTAMP
WHERE kind = 'download'
  AND code = 'crx'
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE product_catalog
SET is_active = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE kind = 'download'
  AND code NOT IN ('zip', 'crx')
"#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
