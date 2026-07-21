import { PLATFORM_CONFIGS, PLATFORM_ORDER, supportsContentType } from '../platforms';
import { STORAGE_KEYS } from '../types';
import type { ContentDraft } from '../types';
import { normalizeScheduledAt } from '../domain/content';
import { readDataFile, mergeDataFile } from './workspaceStorage';

export const DEFAULT_DRAFT: ContentDraft = {
  contentType: 'video',
  title: '',
  description: '',
  topicsText: '',
  selectedPlatforms: ['douyin', 'xiaohongshu', 'kuaishou'],
  selectedCampaignIds: [],
  sourceVideoId: '',
  replicaSourceProjectId: '',
  projectId: '',
  videoCacheId: '',
  coverCacheId: '',
  imageCacheIds: [],
  videoFileName: '',
  coverFileName: '',
  musicFileName: '',
  musicName: '',
  articleContent: '',
  imageFileNames: [],
  videoSize: 0,
  coverSize: 0,
  musicSize: 0,
  scheduledAt: 0,
  visibility: 'public',
  originalDeclare: false,
  platformSettings: {},
};

/** 将数组或类数组对象规范化成字符串数组。 */
function normalizeArrayLike(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, item]) => item)
    .filter((item): item is string => typeof item === 'string');
}

/** 将原始草稿数据规范化成完整有效的 ContentDraft。 */
function normalizeDraft(raw: Partial<ContentDraft> | undefined): ContentDraft {
  if (!raw) return { ...DEFAULT_DRAFT };
  const imageFileNames = normalizeArrayLike(raw.imageFileNames);
  const imageCacheIds = normalizeArrayLike(raw.imageCacheIds);
  const selectedCampaignIds = normalizeArrayLike(raw.selectedCampaignIds);
  const contentType = raw.contentType || (imageFileNames.length || imageCacheIds.length ? 'image' : 'video');
  const selectedPlatforms = raw.selectedPlatforms?.length
    ? PLATFORM_ORDER.filter((id) =>
      raw.selectedPlatforms!.includes(id) &&
      supportsContentType(PLATFORM_CONFIGS[id], contentType),
    )
    : DEFAULT_DRAFT.selectedPlatforms.filter((id) => supportsContentType(PLATFORM_CONFIGS[id], contentType));
  return {
    contentType,
    title: raw.title || '',
    description: raw.description || '',
    topicsText: raw.topicsText || '',
    selectedCampaignIds,
    sourceVideoId: raw.sourceVideoId || '',
    replicaSourceProjectId: raw.replicaSourceProjectId || '',
    projectId: raw.projectId || '',
    videoCacheId: raw.videoCacheId || '',
    coverCacheId: raw.coverCacheId || '',
    imageCacheIds,
    videoFileName: raw.videoFileName || '',
    coverFileName: raw.coverFileName || '',
    musicFileName: raw.musicFileName || '',
    musicName: raw.musicName || '',
    articleContent: raw.articleContent || '',
    imageFileNames,
    videoSize: raw.videoSize || 0,
    coverSize: raw.coverSize || 0,
    musicSize: raw.musicSize || 0,
    scheduledAt: normalizeScheduledAt(raw.scheduledAt),
    visibility: raw.visibility || 'public',
    originalDeclare: raw.originalDeclare ?? false,
    platformSettings: raw.platformSettings || {},
    selectedPlatforms,
  };
}

/** 加载当前内容草稿，优先从工作区读取。 */
export async function loadContentDraft(): Promise<ContentDraft> {
  // 优先从工作区读
  const dataFile = await readDataFile();
  if (dataFile?.draft && Object.keys(dataFile.draft).length > 0) {
    return normalizeDraft(dataFile.draft as Partial<ContentDraft>);
  }

  // fallback: chrome.storage.local
  const stored = await browser.storage.local.get(STORAGE_KEYS.draft);
  return normalizeDraft(stored[STORAGE_KEYS.draft] as Partial<ContentDraft> | undefined);
}

/** 保存当前内容草稿到工作区和 chrome.storage.local。 */
export async function saveContentDraft(draft: ContentDraft) {
  const contentType = draft.contentType || (draft.imageFileNames?.length || draft.imageCacheIds?.length ? 'image' : 'video');
  const clean = {
    ...draft,
    contentType,
    selectedPlatforms: PLATFORM_ORDER.filter((id) =>
      draft.selectedPlatforms.includes(id) &&
      supportsContentType(PLATFORM_CONFIGS[id], contentType),
    ),
  };

  // 写工作区
  await mergeDataFile({ draft: clean });

  // 同步写 chrome.storage.local（作为 fallback）
  await browser.storage.local.set({ [STORAGE_KEYS.draft]: clean });
}
