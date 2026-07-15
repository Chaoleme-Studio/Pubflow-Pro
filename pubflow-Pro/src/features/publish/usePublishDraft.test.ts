import { reactive, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DRAFT } from '../../storage/draftStorage';
import type { ContentDraft, VideoRecord, WorkspaceSettings } from '../../types';
import { getRestorablePlatformIds, usePublishDraft } from './usePublishDraft';

function populatedDraft(): ContentDraft {
  return {
    ...DEFAULT_DRAFT,
    selectedPlatforms: [...DEFAULT_DRAFT.selectedPlatforms],
    selectedCampaignIds: ['campaign-1'],
    title: '保留的标题',
    description: '保留的描述',
    topicsText: '#保留的话题',
    sourceVideoId: 'video-1',
    projectId: 'project-1',
    videoCacheId: 'video-cache-1',
    coverCacheId: 'cover-cache-1',
    imageCacheIds: ['image-cache-1'],
    videoFileName: 'video.mp4',
    coverFileName: 'cover.jpg',
    imageFileNames: ['image.jpg'],
    videoSize: 100,
    coverSize: 20,
    articleContent: '旧文章',
    scheduledAt: Date.now() + 60_000,
  };
}

function setup(draft: ContentDraft) {
  const persistDraft = vi.fn().mockResolvedValue(undefined);
  const result = usePublishDraft({
    draft,
    workspaceSettings: reactive<WorkspaceSettings>({ directoryName: '', permission: 'unknown' }),
    notice: ref(''),
    busy: ref(false),
    persistDraft,
  });
  return { ...result, persistDraft };
}

describe('usePublishDraft publication lifecycle', () => {
  it('prepares an independent next publication while retaining reusable copy', () => {
    const draft = reactive(populatedDraft());
    const { prepareDraftForNextPublication, persistDraft } = setup(draft);

    prepareDraftForNextPublication();

    expect(draft).toMatchObject({
      title: '保留的标题',
      description: '保留的描述',
      topicsText: '#保留的话题',
      selectedCampaignIds: ['campaign-1'],
      sourceVideoId: '',
      projectId: '',
      videoCacheId: '',
      coverCacheId: '',
      imageCacheIds: [],
      videoFileName: '',
      coverFileName: '',
      imageFileNames: [],
      videoSize: 0,
      coverSize: 0,
      articleContent: '',
      scheduledAt: 0,
    });
    expect(persistDraft).toHaveBeenCalledOnce();
  });

  it('clears the previous cover as soon as the selected video changes', () => {
    const draft = reactive(populatedDraft());
    const { onVideoFileUpdate } = setup(draft);

    onVideoFileUpdate(null);

    expect(draft.coverCacheId).toBe('');
    expect(draft.coverFileName).toBe('');
    expect(draft.coverSize).toBe(0);
  });

  it('restores only the platform selected from a publication record', () => {
    const video = {
      id: 'video-1',
      title: '标题',
      description: '',
      topics: [],
      campaignIds: [],
      platforms: [
        { platformId: 'douyin', status: 'error' },
        { platformId: 'zhihu', status: 'filled' },
        { platformId: 'bilibili', status: 'published' },
      ],
      createdAt: 1,
      updatedAt: 2,
    } satisfies VideoRecord;

    expect(getRestorablePlatformIds(video, 'video')).toEqual(['douyin', 'zhihu']);
    expect(getRestorablePlatformIds(video, 'video', 'douyin')).toEqual(['douyin']);
    expect(getRestorablePlatformIds(video, 'video', 'bilibili')).toEqual([]);
  });
});
