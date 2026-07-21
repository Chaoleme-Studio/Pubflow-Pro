import { reactive, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DRAFT } from '../../storage/draftStorage';
import { createProjectId, loadProjectAssetFiles } from '../../storage/workspaceStorage';
import type { ContentDraft, VideoRecord, WorkspaceSettings } from '../../types';
import {
  clonePlatformSettings,
  getReplicaPlatformIds,
  getRestorablePlatformIds,
  usePublishDraft,
} from './usePublishDraft';

vi.mock('../../storage/workspaceStorage', async () => {
  const actual = await vi.importActual<typeof import('../../storage/workspaceStorage')>(
    '../../storage/workspaceStorage',
  );
  return {
    ...actual,
    createProjectId: vi.fn(() => 'replica-project-1'),
    loadProjectAssetFiles: vi.fn(async () => ({
      videoFile: null,
      coverFile: null,
      musicFile: null,
      imageFiles: [],
    })),
    loadProjectManifest: vi.fn(async () => null),
    loadWorkspaceSettings: vi.fn(async () => ({ directoryName: '', permission: 'unknown' })),
    writeProjectManifest: vi.fn(async () => null),
  };
});

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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createProjectId).mockReturnValue('replica-project-1');
  });

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
      replicaSourceProjectId: '',
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
      projectId: 'video-1',
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

  it('does not restore an expired scheduled publication from an old workspace project', async () => {
    const draft = reactive(populatedDraft());
    const { restoreDraftFromVideo } = setup(draft);
    const video = {
      id: 'video-1',
      projectId: 'project-1',
      title: '旧项目',
      description: '',
      topics: [],
      campaignIds: [],
      scheduledAt: Date.now() - 60_000,
      platforms: [{ platformId: 'douyin', status: 'error' }],
      createdAt: 1,
      updatedAt: 2,
    } satisfies VideoRecord;

    await restoreDraftFromVideo(video);

    expect(draft.scheduledAt).toBe(0);
  });

  it('restores original media metadata when platform settings contain nested Vue proxies', async () => {
    const draft = reactive(populatedDraft());
    const { restoreDraftFromVideo } = setup(draft);
    const nestedSettings = reactive({ declaration: '原创内容' });
    const video = reactive({
      contentType: 'video',
      id: 'source-1',
      projectId: 'source-project-1',
      title: '原项目',
      description: '原描述',
      topics: ['原话题'],
      campaignIds: [],
      videoFileName: 'source.mp4',
      coverFileName: 'source-cover.jpg',
      platformSettings: { douyin: nestedSettings },
      platforms: [{ platformId: 'douyin', status: 'error' }],
      createdAt: 1,
      updatedAt: 2,
    } satisfies VideoRecord);

    await expect(restoreDraftFromVideo(video)).resolves.toBe(true);

    expect(loadProjectAssetFiles).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'source-project-1',
      videoFileName: 'source.mp4',
      coverFileName: 'source-cover.jpg',
    }));
    expect(draft.videoFileName).toBe('source.mp4');
    expect(draft.coverFileName).toBe('source-cover.jpg');
    expect(draft.platformSettings).toEqual({ douyin: { declaration: '原创内容' } });
  });

  it('reuses one replica draft project when another source is replicated before distribution', async () => {
    const draft = reactive(populatedDraft());
    const {
      coverFile,
      imageFiles,
      musicFile,
      replicateDraftFromVideo,
      videoFile,
    } = setup(draft);
    const first = {
      contentType: 'video',
      id: 'source-1',
      projectId: 'source-project-1',
      title: '源项目一',
      description: '描述一',
      topics: ['话题一'],
      campaignIds: [],
      videoCacheId: 'source-video-cache',
      coverCacheId: 'source-cover-cache',
      imageCacheIds: ['source-image-cache'],
      videoFileName: 'source.mp4',
      coverFileName: 'source-cover.jpg',
      musicFileName: 'source-music.mp3',
      musicName: '源项目音乐',
      imageFileNames: ['source-image.jpg'],
      videoSize: 100,
      coverSize: 20,
      musicSize: 30,
      platformSettings: { douyin: { autoSubmit: true } },
      scheduledAt: Date.now() + 60_000,
      platforms: [
        { platformId: 'douyin', status: 'published' },
        { platformId: 'zhihu', status: 'error' },
        { platformId: 'bilibili', status: 'skipped' },
      ],
      createdAt: 1,
      updatedAt: 2,
    } satisfies VideoRecord;
    const second = {
      ...first,
      id: 'source-2',
      projectId: 'source-project-2',
      title: '源项目二',
      description: '描述二',
      topics: ['话题二'],
    } satisfies VideoRecord;

    await replicateDraftFromVideo(reactive(first));
    const replicaProjectId = draft.projectId!;
    await replicateDraftFromVideo(reactive(second));

    expect(createProjectId).toHaveBeenCalledOnce();
    expect(draft).toMatchObject({
      projectId: replicaProjectId,
      replicaSourceProjectId: 'source-project-2',
      title: '源项目二',
      description: '描述二',
      topicsText: '话题二',
      scheduledAt: 0,
      selectedPlatforms: ['douyin', 'zhihu'],
      platformSettings: { douyin: { autoSubmit: true } },
      videoCacheId: '',
      coverCacheId: '',
      imageCacheIds: [],
      videoFileName: '',
      coverFileName: '',
      musicFileName: '',
      musicName: '',
      imageFileNames: [],
      videoSize: 0,
      coverSize: 0,
      musicSize: 0,
    });
    expect(videoFile.value).toBeNull();
    expect(coverFile.value).toBeNull();
    expect(musicFile.value).toBeNull();
    expect(imageFiles.value).toEqual([]);
    expect(loadProjectAssetFiles).not.toHaveBeenCalled();

    await replicateDraftFromVideo({
      ...second,
      id: replicaProjectId,
      projectId: replicaProjectId,
    });
    expect(loadProjectAssetFiles).not.toHaveBeenCalled();
  });
});

describe('getReplicaPlatformIds', () => {
  it('restarts published and failed source platforms while excluding skipped platforms', () => {
    const video = {
      id: 'source-1',
      projectId: 'source-1',
      title: '源项目',
      description: '',
      topics: [],
      campaignIds: [],
      platforms: [
        { platformId: 'douyin', status: 'published' },
        { platformId: 'zhihu', status: 'error' },
        { platformId: 'bilibili', status: 'skipped' },
      ],
      createdAt: 1,
      updatedAt: 2,
    } satisfies VideoRecord;

    expect(getReplicaPlatformIds(video, 'video')).toEqual(['douyin', 'zhihu']);
  });
});

describe('clonePlatformSettings', () => {
  it('removes proxies nested inside an otherwise plain object', () => {
    const nestedSettings = reactive({ declaration: '无需标注' });
    const source = { douyin: nestedSettings };

    expect(() => structuredClone(source)).toThrow();
    expect(clonePlatformSettings(source)).toEqual({ douyin: { declaration: '无需标注' } });
  });
});
