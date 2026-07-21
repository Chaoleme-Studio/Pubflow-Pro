import type { ContentData, ContentDraft } from '../types';

const TRAILING_TOPIC_GROUP = /(?:^|\s)((?:#[^\s#]+(?:\s+|$))+?)$/u;
const TOPIC_TOKEN = /#([^\s#]+)/gu;
const TRAILING_TOPIC_PUNCTUATION = /[，,。.!！?？；;:：]+$/u;

/** 将话题文本按常见分隔符拆分成去重的话题数组。 */
export function parseTopics(topicsText: string): string[] {
  return Array.from(
    new Set(
      topicsText
        .split(/[\s,，、\n]+/)
        .map((topic) => topic.trim().replace(/^#+/, ''))
        .filter(Boolean),
    ),
  );
}

/**
 * 将描述末尾已经拼接的 #话题 拆出，并与独立话题字段合并去重。
 * 这样平台编辑器只会一次性粘贴纯描述，话题交给逐个确认流程处理。
 */
export function splitDescriptionAndTopics(description: string, topics: string[]) {
  const trimmedDescription = description.trim();
  const trailingGroup = trimmedDescription.match(TRAILING_TOPIC_GROUP);
  const embeddedTopics = trailingGroup
    ? Array.from(trailingGroup[1].matchAll(TOPIC_TOKEN), (match) => match[1])
    : [];
  const plainDescription = trailingGroup
    ? trimmedDescription.slice(0, trailingGroup.index).trimEnd()
    : trimmedDescription;

  const normalizedTopics = Array.from(new Set(
    [...embeddedTopics, ...topics]
      .map((topic) => topic.trim().replace(/^#+/, '').replace(TRAILING_TOPIC_PUNCTUATION, ''))
      .filter(Boolean),
  ));

  return {
    description: plainDescription,
    topics: normalizedTopics,
  };
}

/** 只有未来的有效时间才代表开启定时发布，旧项目中的过期时间统一视为立即发布。 */
export function normalizeScheduledAt(value: unknown, now = Date.now()) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= now) return 0;
  return parsed;
}

/** 把草稿表单数据组装成统一的内容数据结构。 */
export function buildContent(draft: ContentDraft): ContentData {
  const contentType = draft.contentType || (draft.imageCacheIds?.length ? 'image' : 'video');
  return {
    contentType,
    title: draft.title.trim(),
    description: draft.description.trim(),
    topics: parseTopics(draft.topicsText),
    campaignIds: draft.selectedCampaignIds,
    projectId: draft.projectId,
    videoCacheId: draft.videoCacheId,
    coverCacheId: draft.coverCacheId,
    imageCacheIds: draft.imageCacheIds,
    videoFileName: draft.videoFileName,
    coverFileName: draft.coverFileName,
    musicFileName: draft.musicFileName,
    imageFileNames: draft.imageFileNames,
    videoSize: draft.videoSize,
    coverSize: draft.coverSize,
    musicSize: draft.musicSize,
    scheduledAt: normalizeScheduledAt(draft.scheduledAt) || undefined,
    visibility: draft.visibility,
    originalDeclare: draft.originalDeclare,
    platformSettings: draft.platformSettings,
    articleContent: draft.articleContent || undefined,
  };
}

/** 判断草稿中是否至少有一项可发布内容（标题、正文、媒体等）。 */
export function hasContent(draft: ContentDraft): boolean {
  return (
    !!draft.title.trim() ||
    !!draft.description.trim() ||
    parseTopics(draft.topicsText).length > 0 ||
    !!draft.videoCacheId ||
    !!draft.coverCacheId ||
    !!draft.imageCacheIds?.length ||
    !!draft.articleContent?.trim()
  );
}
