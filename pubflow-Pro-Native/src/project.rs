use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow, bail};
use chrono::{SecondsFormat, Utc};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::models::{ContentType, JobCreate};

const MAX_VIDEO_BYTES: u64 = 20 * 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_MUSIC_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug)]
pub struct BuiltProject {
    pub project_id: String,
    pub project_path: PathBuf,
}

#[derive(Debug)]
struct CopiedAsset {
    name: String,
    size: u64,
}

#[derive(Debug)]
struct CopiedAssets {
    video: Option<CopiedAsset>,
    cover: Option<CopiedAsset>,
    music: Option<CopiedAsset>,
    images: Vec<CopiedAsset>,
}

pub fn build_project(
    workspace_root: &Path,
    project_id: &str,
    request: &JobCreate,
) -> Result<BuiltProject> {
    let now_ms = Utc::now().timestamp_millis();
    let projects_dir = workspace_root.join("projects");
    fs::create_dir_all(&projects_dir)?;
    let mut root_data = read_or_create_workspace_data(workspace_root, now_ms)?;

    let folder_name = format!(
        "{}-{}-{}",
        &project_id[..project_id.len().min(8)],
        slug(&request.title),
        content_type_name(request.content_type),
    );
    let final_dir = projects_dir.join(&folder_name);
    if final_dir.exists() {
        bail!("Project 目录已存在：{}", final_dir.display());
    }
    let temporary_dir = projects_dir.join(format!(".{folder_name}.tmp-{}", Uuid::new_v4()));

    let result = (|| -> Result<BuiltProject> {
        let assets = copy_assets(request, &temporary_dir)?;
        let platform_statuses = request
            .platforms
            .iter()
            .map(|platform| json!({ "platformId": platform, "status": "pending" }))
            .collect::<Vec<_>>();
        let image_names = assets
            .images
            .iter()
            .map(|asset| asset.name.clone())
            .collect::<Vec<_>>();
        let manifest = json!({
            "version": 2,
            "id": project_id,
            "updatedAt": iso_now(),
            "deletedAt": Value::Null,
            "video": {
                "contentType": request.content_type,
                "id": project_id,
                "title": request.title,
                "description": request.description,
                "articleContent": request.article_content,
                "topics": request.topics,
                "campaignIds": request.campaign_ids,
                "projectId": project_id,
                "videoCacheId": "",
                "coverCacheId": "",
                "imageCacheIds": [],
                "videoFileName": asset_name(&assets.video),
                "coverFileName": asset_name(&assets.cover),
                "musicFileName": asset_name(&assets.music),
                "musicName": asset_name(&assets.music),
                "imageFileNames": image_names,
                "videoSize": asset_size(&assets.video),
                "coverSize": asset_size(&assets.cover),
                "musicSize": asset_size(&assets.music),
                "scheduledAt": request.scheduled_at.unwrap_or(0),
                "visibility": request.visibility,
                "originalDeclare": request.original_declare,
                "platformSettings": request.platform_settings,
                "fillOptions": request.fill_options,
                "platforms": platform_statuses,
                "createdAt": now_ms,
                "updatedAt": now_ms
            },
            "records": [],
            "articleContent": request.article_content
        });
        atomic_json_write(&temporary_dir.join("project.json"), &manifest)?;
        fs::rename(&temporary_dir, &final_dir).with_context(|| {
            format!(
                "无法提交 Project 目录 {} -> {}",
                temporary_dir.display(),
                final_dir.display()
            )
        })?;

        merge_project_index(
            &mut root_data,
            project_id,
            &folder_name,
            &request.title,
            now_ms,
        )?;
        if let Err(error) = atomic_json_write(&workspace_root.join("pubflow-data.json"), &root_data)
        {
            let _ = fs::remove_dir_all(&final_dir);
            return Err(error);
        }
        Ok(BuiltProject {
            project_id: project_id.to_owned(),
            project_path: final_dir,
        })
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&temporary_dir);
    }
    result
}

fn copy_assets(request: &JobCreate, project_dir: &Path) -> Result<CopiedAssets> {
    let asset_root = project_dir.join("assets");
    for directory in ["video", "cover", "music", "images"] {
        fs::create_dir_all(asset_root.join(directory))?;
    }
    let video = request
        .assets
        .video_path
        .as_deref()
        .map(|path| copy_asset(path, &asset_root.join("video"), AssetKind::Video))
        .transpose()?;
    let cover = request
        .assets
        .cover_path
        .as_deref()
        .map(|path| copy_asset(path, &asset_root.join("cover"), AssetKind::Image))
        .transpose()?;
    let music = request
        .assets
        .music_path
        .as_deref()
        .map(|path| copy_asset(path, &asset_root.join("music"), AssetKind::Music))
        .transpose()?;
    let images = request
        .assets
        .image_paths
        .iter()
        .map(|path| copy_asset(path, &asset_root.join("images"), AssetKind::Image))
        .collect::<Result<Vec<_>>>()?;
    Ok(CopiedAssets {
        video,
        cover,
        music,
        images,
    })
}

#[derive(Clone, Copy)]
enum AssetKind {
    Video,
    Image,
    Music,
}

fn copy_asset(raw_path: &str, destination_dir: &Path, kind: AssetKind) -> Result<CopiedAsset> {
    let source = PathBuf::from(raw_path)
        .canonicalize()
        .with_context(|| format!("素材不存在：{raw_path}"))?;
    if !source.is_file() {
        bail!("素材不是文件：{}", source.display());
    }
    let metadata = source.metadata()?;
    if metadata.len() == 0 {
        bail!("素材文件为空：{}", source.display());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let (allowed, max_size, label): (&[&str], u64, &str) = match kind {
        AssetKind::Video => (
            &["mp4", "mov", "m4v", "webm", "avi", "mkv"],
            MAX_VIDEO_BYTES,
            "视频",
        ),
        AssetKind::Image => (
            &["jpg", "jpeg", "png", "webp", "gif", "bmp"],
            MAX_IMAGE_BYTES,
            "图片",
        ),
        AssetKind::Music => (
            &["mp3", "wav", "m4a", "aac", "flac", "ogg"],
            MAX_MUSIC_BYTES,
            "音乐",
        ),
    };
    if !allowed.contains(&extension.as_str()) {
        bail!("{label}素材扩展名不受支持：{}", source.display());
    }
    if metadata.len() > max_size {
        bail!("{label}素材超过本地 Agent 大小限制：{}", source.display());
    }

    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| anyhow!("素材文件名不是有效 UTF-8：{}", source.display()))?;
    let mut destination = destination_dir.join(file_name);
    let mut counter = 2;
    while destination.exists() {
        let stem = source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("asset");
        destination = destination_dir.join(format!("{stem}-{counter}.{extension}"));
        counter += 1;
    }
    fs::copy(&source, &destination)?;
    Ok(CopiedAsset {
        name: destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(file_name)
            .to_owned(),
        size: metadata.len(),
    })
}

fn read_or_create_workspace_data(workspace_root: &Path, now_ms: i64) -> Result<Value> {
    let path = workspace_root.join("pubflow-data.json");
    if path.exists() {
        let value: Value = serde_json::from_slice(&fs::read(&path)?)?;
        if value.get("version").and_then(Value::as_i64) != Some(2) {
            bail!("现有 pubflow-data.json 不是 v2 工作区");
        }
        if !value.is_object() {
            bail!("pubflow-data.json 根节点必须是对象");
        }
        return Ok(value);
    }
    Ok(json!({
        "version": 2,
        "updatedAt": iso_now(),
        "draft": {},
        "settings": {
            "platformSettings": {},
            "globalSettings": {},
            "serverConfig": {},
            "aiSettings": {}
        },
        "projectIndex": [],
        "createdAt": now_ms
    }))
}

fn merge_project_index(
    root_data: &mut Value,
    project_id: &str,
    folder_name: &str,
    title: &str,
    updated_at: i64,
) -> Result<()> {
    let object = root_data
        .as_object_mut()
        .ok_or_else(|| anyhow!("pubflow-data.json 根节点必须是对象"))?;
    let index = object
        .entry("projectIndex")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or_else(|| anyhow!("pubflow-data.json projectIndex 必须是数组"))?;
    index.retain(|item| item.get("projectId").and_then(Value::as_str) != Some(project_id));
    index.insert(
        0,
        json!({
            "projectId": project_id,
            "path": format!("projects/{folder_name}"),
            "title": title,
            "updatedAt": updated_at
        }),
    );
    object.insert("updatedAt".to_owned(), json!(iso_now()));
    Ok(())
}

fn atomic_json_write(path: &Path, value: &Value) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("data.json");
    let temporary = path.with_file_name(format!(".{file_name}.tmp-{}", Uuid::new_v4()));
    fs::write(&temporary, serde_json::to_vec_pretty(value)?)?;
    fs::rename(&temporary, path)?;
    Ok(())
}

fn asset_name(asset: &Option<CopiedAsset>) -> &str {
    asset
        .as_ref()
        .map(|value| value.name.as_str())
        .unwrap_or("")
}

fn asset_size(asset: &Option<CopiedAsset>) -> u64 {
    asset.as_ref().map(|value| value.size).unwrap_or(0)
}

fn content_type_name(content_type: ContentType) -> &'static str {
    match content_type {
        ContentType::Video => "video",
        ContentType::Image => "image",
        ContentType::Article => "article",
    }
}

fn slug(title: &str) -> String {
    let value = title
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(['-', '_'])
        .chars()
        .take(48)
        .collect::<String>();
    if value.is_empty() {
        "untitled".to_owned()
    } else {
        value
    }
}

fn iso_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs};

    use tempfile::tempdir;

    use super::*;
    use crate::models::{AssetInput, PlatformId, Visibility};

    #[test]
    fn builds_v2_project_and_copies_video() {
        let root = tempdir().unwrap();
        let source = root.path().join("source.mp4");
        fs::write(&source, b"video").unwrap();
        let request = JobCreate {
            request_id: Some("request-1".to_owned()),
            content_type: ContentType::Video,
            title: "Rust 本地任务".to_owned(),
            description: "description".to_owned(),
            article_content: None,
            topics: vec!["topic".to_owned()],
            campaign_ids: vec![],
            platforms: vec![PlatformId::Douyin, PlatformId::Xiaohongshu],
            scheduled_at: None,
            visibility: Visibility::Public,
            original_declare: false,
            platform_settings: BTreeMap::new(),
            fill_options: None,
            publish_mode: crate::models::PublishMode::FillOnly,
            assets: AssetInput {
                video_path: Some(source.to_string_lossy().into_owned()),
                ..AssetInput::default()
            },
        };
        let workspace = root.path().join("workspace");
        let built = build_project(&workspace, "project-1", &request).unwrap();
        let manifest: Value =
            serde_json::from_slice(&fs::read(built.project_path.join("project.json")).unwrap())
                .unwrap();
        assert_eq!(manifest["version"], 2);
        assert_eq!(manifest["id"], "project-1");
        assert!(built.project_path.join("assets/video/source.mp4").exists());
        assert!(workspace.join("pubflow-data.json").exists());
    }
}
