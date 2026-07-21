import { STORAGE_KEYS } from '../types';
import type { PlatformStatus, PublishRecord, VideoRecord } from '../types';
import {
  deleteProjectData,
  loadAllWorkspaceProjects,
  loadWorkspaceDirectory,
  writeProjectData,
} from './workspaceStorage';

/** 从工作区或 chrome.storage.local 加载视频与发布记录的对照数据。 */
async function loadPersistedLibraryPairs() {
  const workspace = await loadWorkspaceDirectory();
  const projects = await loadAllWorkspaceProjects();
  if (workspace?.handle) {
    return {
      videos: projects.map((project) => normalizeVideoRecord(project.video)),
      records: projects.flatMap((project) => project.records || []),
    };
  }

  const stored = await browser.storage.local.get([STORAGE_KEYS.videos, STORAGE_KEYS.records]);
  const rawVideos = (stored[STORAGE_KEYS.videos] as VideoRecord[] | undefined) || [];
  const projectIdByVideoId = new Map(
    rawVideos.map((video) => [video.id, video.projectId] as const),
  );
  const videos = rawVideos.map(normalizeVideoRecord);
  const records = ((stored[STORAGE_KEYS.records] as PublishRecord[] | undefined) || []).map((record) => {
    const projectId = projectIdByVideoId.get(record.videoId) || record.videoId;
    return { ...record, id: `${projectId}:${record.platformId}`, videoId: projectId };
  });
  return { videos, records };
}

/** 筛选出与指定视频关联的发布记录。 */
function recordsForVideo(records: PublishRecord[], video: VideoRecord) {
  return records.filter((record) => record.videoId === video.id);
}

/** 将视频记录收敛到 projectId 唯一身份。 */
function normalizeVideoRecord(record: VideoRecord): VideoRecord {
  const projectId = record.projectId;
  return {
    ...record,
    id: projectId,
    projectId,
    topics: Array.isArray(record.topics) ? record.topics : [],
    campaignIds: Array.isArray(record.campaignIds) ? record.campaignIds : [],
    platforms: Array.isArray(record.platforms) ? record.platforms : [],
  };
}

/**
 * projectId 是唯一身份；同一项目出现多个目录快照时只保留最新状态。
 */
export function deduplicateVideos(videos: VideoRecord[]): VideoRecord[] {
  const groups = new Map<string, VideoRecord[]>();
  for (const v of videos) {
    const identity = v.projectId;
    const arr = groups.get(identity);
    if (arr) arr.push(v);
    else groups.set(identity, [v]);
  }

  const result: VideoRecord[] = [];
  for (const [, arr] of groups) {
    if (arr.length === 1) {
      result.push(arr[0]);
      continue;
    }
    // 按 updatedAt 降序，保留最新
    arr.sort((a, b) => b.updatedAt - a.updatedAt);
    const kept = { ...arr[0] };
    // 从较早快照中合并已发布的平台状态
    for (let i = 1; i < arr.length; i++) {
      for (const oldPlatform of arr[i].platforms) {
        if (oldPlatform.status === 'published') {
          const existing = kept.platforms.find((p) => p.platformId === oldPlatform.platformId);
          if (existing && existing.status !== 'published') {
            existing.status = 'published';
            existing.publishedUrl = oldPlatform.publishedUrl;
            existing.publishedAt = oldPlatform.publishedAt;
          }
        }
      }
    }
    result.push(kept);
  }

  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 判断某个平台状态是否需要生成发布记录。 */
function shouldHavePublishRecord(platform: PlatformStatus): boolean {
  return platform.status === 'published' || platform.status === 'filled' || platform.status === 'error';
}

/** 将平台状态映射为发布记录中的状态字段。 */
function recordStatusFromPlatform(platform: PlatformStatus): PublishRecord['status'] {
  if (platform.status === 'published') return 'published';
  if (platform.status === 'error') return 'error';
  return 'filled';
}

/** 根据视频和平台状态构造一条发布记录。 */
function buildRecordFromVideoPlatform(video: VideoRecord, platform: PlatformStatus): PublishRecord {
  return {
    id: `${video.id}:${platform.platformId}`,
    videoId: video.id,
    platformId: platform.platformId,
    title: video.title,
    coverFileName: video.coverFileName,
    publishedUrl: platform.publishedUrl,
    publishedAt: platform.publishedAt,
    updatedAt: platform.publishedAt || video.updatedAt,
    status: recordStatusFromPlatform(platform),
    error: platform.error,
  };
}

/** 合并已有记录和视频生成的记录，保留最完整的发布状态。 */
export function mergeRecordsFromVideos(videos: VideoRecord[], records: PublishRecord[]): PublishRecord[] {
  const byKey = new Map<string, PublishRecord>();
  for (const record of records) {
    byKey.set(`${record.videoId}:${record.platformId}`, record);
  }

  for (const video of videos) {
    for (const platform of video.platforms) {
      if (!shouldHavePublishRecord(platform)) continue;

      const key = `${video.id}:${platform.platformId}`;
      const existing = byKey.get(key);
      const generated = buildRecordFromVideoPlatform(video, platform);
      const stateChanged = !existing ||
        existing.status !== generated.status ||
        existing.error !== generated.error ||
        existing.publishedUrl !== generated.publishedUrl ||
        existing.publishedAt !== generated.publishedAt;
      byKey.set(key, {
        ...generated,
        ...existing,
        id: existing?.id || generated.id,
        title: video.title,
        coverFileName: video.coverFileName,
        status: existing?.status === 'published' ? 'published' : generated.status,
        publishedUrl: existing?.publishedUrl || generated.publishedUrl,
        publishedAt: existing?.publishedAt || generated.publishedAt,
        updatedAt: stateChanged ? generated.updatedAt : existing?.updatedAt || generated.updatedAt,
        error: generated.error,
      });
    }
  }

  return [...byKey.values()].sort(
    (a, b) => (b.publishedAt || b.updatedAt || 0) - (a.publishedAt || a.updatedAt || 0),
  );
}

/** 从当前工作区加载项目库；浏览器存储只作为未选择工作区时的数据源。 */
export async function loadLibraryData() {
  const persisted = await loadPersistedLibraryPairs();
  const videos = persisted.videos;
  const records = persisted.records;

  const deduped = deduplicateVideos(videos);
  const mergedRecords = mergeRecordsFromVideos(deduped, records);
  await browser.storage.local.set({
    [STORAGE_KEYS.videos]: deduped,
    [STORAGE_KEYS.records]: mergedRecords,
  });

  return { videos: deduped, records: mergedRecords };
}

/** 将视频和发布记录同时保存到工作区和 chrome.storage.local。 */
export async function saveLibraryData(videos: VideoRecord[], records: PublishRecord[]) {
  const normalizedVideos = videos.map(normalizeVideoRecord);
  for (const video of normalizedVideos) {
    await writeProjectData(video, recordsForVideo(records, video));
  }
  await browser.storage.local.set({
    [STORAGE_KEYS.videos]: videos,
    [STORAGE_KEYS.records]: records,
  });
}

/** 保存视频列表，并同步更新每条视频在工作区中的项目数据。 */
export async function saveVideos(videos: VideoRecord[]) {
  const persisted = await loadPersistedLibraryPairs();
  const normalizedVideos = videos.map(normalizeVideoRecord);
  for (const video of normalizedVideos) {
    await writeProjectData(video, recordsForVideo(persisted.records, video));
  }
  await browser.storage.local.set({ [STORAGE_KEYS.videos]: videos });
}

/** 保存发布记录，并同步更新相关视频在工作区中的项目数据。 */
export async function saveRecords(records: PublishRecord[]) {
  const persisted = await loadPersistedLibraryPairs();
  for (const video of persisted.videos) {
    await writeProjectData(video, recordsForVideo(records, video));
  }
  await browser.storage.local.set({ [STORAGE_KEYS.records]: records });
}

/** 删除指定项目及其关联发布记录，同时清理工作区项目目录。 */
export async function deleteVideoRecord(projectId: string) {
  const persisted = await loadPersistedLibraryPairs();
  const target = persisted.videos.find((video) => video.projectId === projectId);
  const videos = persisted.videos.filter((video) => video.projectId !== projectId);
  const records = persisted.records.filter((record) => record.videoId !== projectId);

  if (target) {
    await deleteProjectData(target);
  }

  await browser.storage.local.set({
    [STORAGE_KEYS.videos]: videos,
    [STORAGE_KEYS.records]: records,
  });

  return { videos, records };
}

/** 清空浏览器缓存的视频、记录、任务和草稿数据，不删除工作区文件。 */
export async function clearLibraryData() {
  // 只清浏览器缓存，不动工作区文件（工作区数据由用户在设置中显式管理）
  await browser.storage.local.remove([
    STORAGE_KEYS.videos,
    STORAGE_KEYS.records,
    STORAGE_KEYS.currentTask,
    STORAGE_KEYS.draft,
  ]);
}

/** 导出 chrome.storage.local 中的所有数据，用于备份。 */
export async function exportAllStoredData() {
  return browser.storage.local.get(null);
}
