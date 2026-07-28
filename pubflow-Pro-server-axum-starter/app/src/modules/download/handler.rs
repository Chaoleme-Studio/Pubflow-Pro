use aide::transform::TransformOperation;
use axum::{
    body::Body,
    extract::{Path, State},
    http::header,
    response::Response,
};
use std::sync::Arc;
use tokio_util::io::ReaderStream;

use crate::{AppError, AppState};

const ALLOWED_FILENAMES: [&str; 6] = [
    "pubflow-extension.zip",
    "pubflow-extension.crx",
    "pubflow-pro-native-mac-arm64.zip",
    "pubflow-pro-native-mac-x64.zip",
    "pubflow-pro-native-win-x64.zip",
    "pubflow-pro-native-linux-x64.zip",
];

pub async fn download_file(
    State(state): State<Arc<AppState>>,
    Path(filename): Path<String>,
) -> Result<Response, AppError> {
    if !is_allowed_filename(&filename) {
        return Err(crate::error::PubFlowError::DownloadNotFound.into());
    }

    let base_dir = state.config.downloads_fs_path.clone();
    if base_dir.is_empty() {
        return Err(crate::error::PubFlowError::DownloadNotFound.into());
    }

    let path = std::path::PathBuf::from(&base_dir).join(&filename);
    let canonical_base = std::fs::canonicalize(&base_dir)
        .map_err(|_| crate::error::PubFlowError::DownloadNotFound)?;
    let canonical_path =
        std::fs::canonicalize(&path).map_err(|_| crate::error::PubFlowError::DownloadNotFound)?;

    // 安全检查：确保请求文件在 base_dir 内，防止目录穿越
    if !canonical_path.starts_with(&canonical_base) {
        return Err(crate::error::PubFlowError::DownloadNotFound.into());
    }

    let content_type = if filename.ends_with(".zip") {
        "application/zip"
    } else if filename.ends_with(".crx") {
        "application/x-chrome-extension"
    } else {
        "application/octet-stream"
    };

    let disposition = format!(r#"attachment; filename="{}""#, filename);
    let file = tokio::fs::File::open(&canonical_path)
        .await
        .map_err(|_| crate::error::PubFlowError::DownloadNotFound)?;
    let meta = file
        .metadata()
        .await
        .map_err(|_| crate::error::PubFlowError::DownloadNotFound)?;
    let body = Body::from_stream(ReaderStream::new(file));

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_DISPOSITION, disposition)
        .header(header::CONTENT_LENGTH, meta.len().to_string())
        .body(body)
        .map_err(|e| {
            crate::AppError::PubFlow(crate::error::PubFlowError::Internal(e.to_string()))
        })?)
}

pub fn download_file_docs(op: TransformOperation) -> TransformOperation {
    op.description("下载浏览器扩展或 Native 安装包")
        .tag("PubFlow Download")
        .response::<200, ()>()
}

fn is_allowed_filename(filename: &str) -> bool {
    ALLOWED_FILENAMES.contains(&filename)
}

#[cfg(test)]
mod tests {
    use super::is_allowed_filename;

    #[test]
    fn only_known_release_packages_are_downloadable() {
        assert!(is_allowed_filename("pubflow-extension.zip"));
        assert!(is_allowed_filename("pubflow-pro-native-mac-arm64.zip"));
        assert!(is_allowed_filename("pubflow-pro-native-win-x64.zip"));
        assert!(!is_allowed_filename("../pubflow-pro-native-win-x64.zip"));
        assert!(!is_allowed_filename("unregistered.zip"));
    }
}
