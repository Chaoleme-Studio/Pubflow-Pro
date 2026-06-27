import { STORAGE_KEYS } from '../types';
import type { PlatformStatus, PublishRecord, VideoRecord } from '../types';
import { deleteProjectData, loadAllWorkspaceProjects, writeProjectData } from './workspaceStorage';

/** 从工作区或 chrome.storage.local 加载视频与发布记录的对照数据。 */
async function loadPersistedLibraryPairs() {
  const projects = await loadAllWorkspaceProjects();
  if (projects.length) {
    return {
      videos: projects.map((project) => normalizeVideoRecord(project.video)),
      records: projects.flatMap((project) => project.records || []),
    };
  }

  const stored = await browser.storage.local.get([STORAGE_KEYS.videos, STORAGE_KEYS.records]);
  return {
    videos: ((stored[STORAGE_KEYS.videos] as VideoRecord[] | undefined) || []).map(normalizeVideoRecord),
    records: (stored[STORAGE_KEYS.records] as PublishRecord[] | undefined) || [],
  };
}

/** 筛选出与指定视频关联的发布记录。 */
function recordsForVideo(records: PublishRecord[], video: VideoRecord) {
  return records.filter((record) => record.videoId === video.id);
}

/** 规范化视频记录字段，补齐旧数据缺失的 projectId、topics 等字段。 */
function normalizeVideoRecord(record: VideoRecord): VideoRecord {
  return {
    ...record,
    // 旧记录可能没有 projectId（restoreFromWorkspace 早期版本漏了），回填为 id
    projectId: record.projectId || record.id,
    topics: Array.isArray(record.topics) ? record.topics : [],
    campaignIds: Array.isArray(record.campaignIds) ? record.campaignIds : [],
    platforms: Array.isArray(record.platforms) ? record.platforms : [],
  };
}

/**
 * 去重：同一视频文件的多条记录合并为一条，保留最新记录，合并平台发布状态。
 */
function deduplicateVideos(videos: VideoRecord[]): VideoRecord[] {
  // videoFileName 优先（同文件名即同视频），其次 projectId，最后 title+size 兜底
  const getKey = (v: VideoRecord) =>
    v.videoFileName || v.projectId || `${v.title}|${v.videoSize || 0}`;

  const groups = new Map<string, VideoRecord[]>();
  for (const v of videos) {
    const key = getKey(v);
    const arr = groups.get(key);
    if (arr) arr.push(v);
    else groups.set(key, [v]);
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
    // 从旧记录中合并已发布的平台状态
    for (let i = 1; i < arr.length; i++) {
      for (const oldPlatform of arr[i].platforms) {
        if (oldPlatform.status === 'published' && oldPlatform.publishedUrl) {
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
  return 'pending';
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
    status: recordStatusFromPlatform(platform),
    error: platform.error,
  };
}

/** 合并已有记录和视频生成的记录，保留最完整的发布状态。 */
function mergeRecordsFromVideos(videos: VideoRecord[], records: PublishRecord[]): PublishRecord[] {
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
      byKey.set(key, {
        ...generated,
        ...existing,
        id: existing?.id || generated.id,
        title: video.title,
        coverFileName: video.coverFileName,
        status: existing?.status === 'published' ? 'published' : generated.status,
        publishedUrl: existing?.publishedUrl || generated.publishedUrl,
        publishedAt: existing?.publishedAt || generated.publishedAt,
        error: generated.error || existing?.error,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
}

/** 生成发布记录的稳定签名，用于判断记录集合是否发生变化。 */
function publishRecordSignature(record: PublishRecord) {
  return [
    record.id,
    record.videoId,
    record.platformId,
    record.title,
    record.coverFileName || '',
    record.publishedUrl || '',
    record.publishedAt || 0,
    record.status,
    record.error || '',
  ].join('\u001f');
}

/** 比较两组发布记录是否不同。 */
function recordsChanged(next: PublishRecord[], previous: PublishRecord[]) {
  if (next.length !== previous.length) return true;
  for (let index = 0; index < next.length; index++) {
    if (publishRecordSignature(next[index]) !== publishRecordSignature(previous[index])) {
      return true;
    }
  }
  return false;
}

/** 加载并去重后的视频库和发布记录。 */
export async function loadLibraryData() {
  const persisted = await loadPersistedLibraryPairs();
  const videos = persisted.videos;
  const records = persisted.records;

  const deduped = deduplicateVideos(videos);
  const mergedRecords = mergeRecordsFromVideos(deduped, records);
  // 去重或规范化后数据有变化则回写
  const videosChanged = deduped.length < videos.length || deduped.some((v, i) => v !== videos[i]);
  const publishRecordsChanged = recordsChanged(mergedRecords, records);
  if (videosChanged || publishRecordsChanged) {
    await saveLibraryData(deduped, mergedRecords);
  }

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

/** 删除指定视频及其关联的发布记录，同时清理工作区中的项目目录。 */
export async function deleteVideoRecord(videoId: string) {
  const persisted = await loadPersistedLibraryPairs();
  const target = persisted.videos.find((video) => video.id === videoId);
  const videos = persisted.videos.filter((video) => video.id !== videoId);
  const records = persisted.records.filter((record) => record.videoId !== videoId);

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
