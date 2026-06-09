import type { ContentData, ContentDraft } from '../types';

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
    scheduledAt: draft.scheduledAt || undefined,
    visibility: draft.visibility,
    originalDeclare: draft.originalDeclare,
    platformSettings: draft.platformSettings,
    articleContent: draft.articleContent || undefined,
  };
}

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
