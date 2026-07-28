use std::path::Path;

use chrono::Utc;
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteRow},
};

use crate::{
    error::AppError,
    models::{JobCreate, JobView},
};

#[derive(Clone)]
pub struct JobDatabase {
    pool: SqlitePool,
}

impl JobDatabase {
    pub async fn connect(path: &Path) -> Result<Self, AppError> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        sqlx::query(
            r#"CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                request_id TEXT UNIQUE,
                project_id TEXT NOT NULL,
                project_path TEXT NOT NULL,
                request_json TEXT NOT NULL,
                status TEXT NOT NULL,
                status_sequence INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )"#,
        )
        .execute(&pool)
        .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status, created_at)")
            .execute(&pool)
            .await?;
        Ok(Self { pool })
    }

    pub async fn recover_inflight_jobs(&self) -> Result<(), AppError> {
        sqlx::query(
            "UPDATE jobs SET status = 'queued', updated_at = ? WHERE status IN ('claimed', 'running')",
        )
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert(
        &self,
        job_id: &str,
        project_id: &str,
        project_path: &str,
        request: &JobCreate,
    ) -> Result<JobView, AppError> {
        let now = now_ms();
        sqlx::query(
            r#"INSERT INTO jobs (
                job_id, request_id, project_id, project_path, request_json,
                status, status_sequence, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)"#,
        )
        .bind(job_id)
        .bind(request.request_id.as_deref())
        .bind(project_id)
        .bind(project_path)
        .bind(serde_json::to_string(request)?)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        self.get(job_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("任务 {job_id} 不存在")))
    }

    pub async fn get(&self, job_id: &str) -> Result<Option<JobView>, AppError> {
        let row = sqlx::query("SELECT * FROM jobs WHERE job_id = ?")
            .bind(job_id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_view).transpose()
    }

    pub async fn find_by_request_id(&self, request_id: &str) -> Result<Option<JobView>, AppError> {
        let row = sqlx::query("SELECT * FROM jobs WHERE request_id = ?")
            .bind(request_id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_view).transpose()
    }

    pub async fn detail(&self, job_id: &str) -> Result<Option<(JobView, JobCreate)>, AppError> {
        let row = sqlx::query("SELECT * FROM jobs WHERE job_id = ?")
            .bind(job_id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| {
            let request = serde_json::from_str::<JobCreate>(row.get("request_json"))?;
            Ok((row_to_view(row)?, request))
        })
        .transpose()
    }

    pub async fn list_details(&self, limit: i64) -> Result<Vec<(JobView, JobCreate)>, AppError> {
        let rows = sqlx::query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
            .bind(limit.clamp(1, 100))
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_detail).collect()
    }

    pub async fn next_queued(&self) -> Result<Option<JobView>, AppError> {
        let row = sqlx::query(
            "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(row_to_view).transpose()
    }

    pub async fn has_active_jobs(&self) -> Result<bool, AppError> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM jobs WHERE status IN ('queued', 'claimed', 'running')",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(count > 0)
    }

    pub async fn claim(&self, job_id: &str) -> Result<Option<JobView>, AppError> {
        let mut transaction = self.pool.begin().await?;
        let busy = sqlx::query(
            "SELECT job_id FROM jobs WHERE status IN ('claimed', 'running') AND job_id <> ? LIMIT 1",
        )
        .bind(job_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if busy.is_some() {
            transaction.rollback().await?;
            return Ok(None);
        }
        let changed = sqlx::query(
            "UPDATE jobs SET status = 'claimed', updated_at = ? WHERE job_id = ? AND status = 'queued'",
        )
        .bind(now_ms())
        .bind(job_id)
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        if changed == 0 {
            transaction.rollback().await?;
            return Ok(None);
        }
        transaction.commit().await?;
        self.get(job_id).await
    }

    pub async fn update_status(
        &self,
        job_id: &str,
        status: &str,
        sequence: i64,
        error: Option<&str>,
    ) -> Result<JobView, AppError> {
        sqlx::query(
            r#"UPDATE jobs
               SET status = ?, status_sequence = ?, error = ?, updated_at = ?
               WHERE job_id = ? AND status_sequence < ?"#,
        )
        .bind(status)
        .bind(sequence)
        .bind(error)
        .bind(now_ms())
        .bind(job_id)
        .bind(sequence)
        .execute(&self.pool)
        .await?;
        self.get(job_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("任务 {job_id} 不存在")))
    }
}

fn row_to_view(row: SqliteRow) -> Result<JobView, AppError> {
    Ok(row_to_detail(row)?.0)
}

fn row_to_detail(row: SqliteRow) -> Result<(JobView, JobCreate), AppError> {
    let request: JobCreate = serde_json::from_str(row.get("request_json"))?;
    let view = JobView {
        job_id: row.get("job_id"),
        project_id: row.get("project_id"),
        status: row.get("status"),
        status_sequence: row.get("status_sequence"),
        project_path: row.get("project_path"),
        platforms: request.platforms.clone(),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        error: row.get("error"),
    };
    Ok((view, request))
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use tempfile::tempdir;

    use super::*;
    use crate::models::{AssetInput, ContentType, PlatformId, Visibility};

    fn request() -> JobCreate {
        JobCreate {
            request_id: Some("request-1".to_owned()),
            content_type: ContentType::Video,
            title: "task".to_owned(),
            description: String::new(),
            article_content: None,
            topics: vec![],
            campaign_ids: vec![],
            platforms: vec![PlatformId::Douyin],
            scheduled_at: None,
            visibility: Visibility::Public,
            original_declare: false,
            platform_settings: BTreeMap::new(),
            fill_options: None,
            publish_mode: crate::models::PublishMode::FillOnly,
            assets: AssetInput {
                video_path: Some("/tmp/video.mp4".to_owned()),
                ..AssetInput::default()
            },
        }
    }

    #[tokio::test]
    async fn claims_one_job_and_keeps_status_sequence_monotonic() {
        let directory = tempdir().unwrap();
        let database = JobDatabase::connect(&directory.path().join("jobs.sqlite3"))
            .await
            .unwrap();
        database
            .insert("job-1", "project-1", "/workspace/project-1", &request())
            .await
            .unwrap();

        assert_eq!(
            database.claim("job-1").await.unwrap().unwrap().status,
            "claimed"
        );
        assert_eq!(
            database
                .update_status("job-1", "running", 1, None)
                .await
                .unwrap()
                .status,
            "running"
        );
        assert_eq!(
            database
                .update_status("job-1", "completed", 3, None)
                .await
                .unwrap()
                .status,
            "completed"
        );
        assert_eq!(
            database
                .update_status("job-1", "running", 2, None)
                .await
                .unwrap()
                .status,
            "completed"
        );
    }
}
