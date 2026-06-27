import type { Ref } from 'vue';
import { buildContent, parseTopics } from '../../domain/content';
import { sendRuntimeMessage } from '../../messaging';
import { PLATFORM_CONFIGS, PLATFORM_ORDER, supportsContentType } from '../../platforms';
import { saveVideos } from '../../storage/libraryStorage';
import type {
  ContentDraft,
  DistributionTask,
  PlatformId,
  PlatformSettings,
  VideoRecord,
} from '../../types';

/** 组合式函数：根据当前草稿创建视频记录并启动分发任务。 */
export function useDistributionLauncher(params: {
  draft: ContentDraft;
  canStart: Ref<boolean>;
  busy: Ref<boolean>;
  notice: Ref<string>;
  platformSettings: Record<PlatformId, PlatformSettings>;
  videos: Ref<VideoRecord[]>;
  task: Ref<DistributionTask | null>;
  persistDraft: () => Promise<void>;
  onStarted: () => void;
}) {
  const {
    draft,
    canStart,
    busy,
    notice,
    platformSettings,
    videos,
    task,
    persistDraft,
    onStarted,
  } = params;

  /** 根据草稿内容更新或创建视频记录，并保存到库中。 */
  async function upsertVideoFromDraft() {
    const now = Date.now();
    const contentType = draft.contentType || (draft.imageCacheIds?.length ? 'image' : 'video');
    const existingIndex = draft.sourceVideoId
      ? videos.value.findIndex((v) => v.id === draft.sourceVideoId)
      : -1;

    if (existingIndex >= 0) {
      const existing = videos.value[existingIndex];
      const updated: VideoRecord = {
        ...existing,
        contentType,
        title: draft.title.trim() || '未命名内容',
        description: draft.description.trim(),
        topics: parseTopics(draft.topicsText),
        campaignIds: [...draft.selectedCampaignIds],
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
        articleContent: draft.articleContent || undefined,
        scheduledAt: draft.scheduledAt || 0,
        visibility: draft.visibility,
        originalDeclare: draft.originalDeclare,
        platformSettings: draft.platformSettings,
        platforms: PLATFORM_ORDER.map((platformId) => {
          const prev = existing.platforms.find((p) => p.platformId === platformId);
          const selected =
            draft.selectedPlatforms.includes(platformId) &&
            supportsContentType(PLATFORM_CONFIGS[platformId], contentType);
          if (prev?.status === 'published') return prev;
          return { platformId, status: selected ? 'pending' as const : 'skipped' as const };
        }),
        updatedAt: now,
      };
      videos.value = [...videos.value.slice(0, existingIndex), updated, ...videos.value.slice(existingIndex + 1)];
      await saveVideos(videos.value);
      return updated;
    }

    const video: VideoRecord = {
      id: crypto.randomUUID(),
      contentType,
      title: draft.title.trim() || '未命名内容',
      description: draft.description.trim(),
      topics: parseTopics(draft.topicsText),
      campaignIds: [...draft.selectedCampaignIds],
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
      articleContent: draft.articleContent || undefined,
      scheduledAt: draft.scheduledAt || 0,
      visibility: draft.visibility,
      originalDeclare: draft.originalDeclare,
      platformSettings: draft.platformSettings,
      platforms: PLATFORM_ORDER.map((platformId) => ({
        platformId,
        status:
          draft.selectedPlatforms.includes(platformId) &&
          supportsContentType(PLATFORM_CONFIGS[platformId], contentType)
            ? 'pending'
            : 'skipped',
      })),
      createdAt: now,
      updatedAt: now,
    };
    videos.value = [video, ...videos.value].slice(0, 100);
    await saveVideos(videos.value);
    return video;
  }

  /** 校验条件并向后台发起 START_DISTRIBUTION 任务。 */
  async function startDistribution() {
    if (!canStart.value || busy.value) return;
    busy.value = true;
    notice.value = '';
    try {
      await persistDraft();
      const video = await upsertVideoFromDraft();
      const content = buildContent(draft);
      const enabledOnly = PLATFORM_ORDER.filter((id) => (
        draft.selectedPlatforms.includes(id) &&
        platformSettings[id]?.enabled !== false &&
        supportsContentType(PLATFORM_CONFIGS[id], content.contentType || 'video')
      ));
      if (!enabledOnly.length) {
        throw new Error('当前内容类型没有可发布的平台，请检查目标平台选择。');
      }
      console.info('[PubFlow] startDistribution', {
        contentType: content.contentType,
        title: content.title?.slice(0, 30),
        hasArticleContent: Boolean(content.articleContent),
        articleContentLength: content.articleContent?.length || 0,
      });
      const response = await sendRuntimeMessage<DistributionTask>({
        type: 'START_DISTRIBUTION',
        payload: {
          content,
          platforms: enabledOnly,
          videoId: video.id,
        },
      });
      if (!response.ok) throw new Error(response.error || '启动失败');
      task.value = response.data || null;
      onStarted();
      notice.value = '任务已启动。插件会按平台顺序自动上传并填充，遇到登录或弹窗时会等待处理。';
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '启动失败';
    } finally {
      busy.value = false;
    }
  }

  return {
    startDistribution,
  };
}
