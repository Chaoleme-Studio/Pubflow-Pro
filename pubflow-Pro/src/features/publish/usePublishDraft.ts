import { ref, type Ref } from 'vue';
import { DEFAULT_DRAFT } from '../../storage/draftStorage';
import {
  cleanupFileTransfer,
  cleanupVideoTransfer,
  storeFileForTransfer,
  storeVideoForTransfer,
} from '../../storage/videoTransferStorage';
import {
  importProjectAsset,
  createProjectId,
  loadProjectAssetFiles,
  loadProjectManifest,
  loadWorkspaceSettings,
  writeProjectManifest,
} from '../../storage/workspaceStorage';
import { PLATFORM_CONFIGS, supportsContentType } from '../../platforms';
import { normalizeScheduledAt } from '../../domain/content';
import type { ContentDraft, PlatformId, VideoRecord, WorkspaceSettings } from '../../types';

/** 恢复单条发布记录时只返回其目标平台，避免误重试同一项目的其他平台。 */
export function getRestorablePlatformIds(
  video: VideoRecord,
  contentType: ContentDraft['contentType'],
  targetPlatformId?: PlatformId,
) {
  return video.platforms
    .filter((item) => !targetPlatformId || item.platformId === targetPlatformId)
    .filter((item) => item.status !== 'published' && item.status !== 'skipped')
    .filter((item) => supportsContentType(PLATFORM_CONFIGS[item.platformId], contentType || 'video'))
    .map((item) => item.platformId);
}

/** 复刻会重新发布源项目选择过的平台，不继承这些平台原来的完成状态。 */
export function getReplicaPlatformIds(
  video: VideoRecord,
  contentType: ContentDraft['contentType'],
) {
  return video.platforms
    .filter((item) => item.status !== 'skipped')
    .filter((item) => supportsContentType(PLATFORM_CONFIGS[item.platformId], contentType || 'video'))
    .map((item) => item.platformId);
}

/** 平台设置本身会持久化为 JSON，用 JSON 转换可同时去掉所有层级的 Vue Proxy。 */
export function clonePlatformSettings(
  settings: VideoRecord['platformSettings'],
): NonNullable<VideoRecord['platformSettings']> {
  return JSON.parse(JSON.stringify(settings || {})) as NonNullable<VideoRecord['platformSettings']>;
}

/** 组合式函数：管理发布页草稿的媒体文件、缓存和从项目恢复。 */
export function usePublishDraft(params: {
  draft: ContentDraft;
  workspaceSettings: WorkspaceSettings;
  notice: Ref<string>;
  busy: Ref<boolean>;
  persistDraft: () => Promise<void>;
}) {
  const { draft, workspaceSettings, notice, busy, persistDraft } = params;

  const videoFile = ref<File | null>(null);
  const videoPreviewUrl = ref('');
  const coverFile = ref<File | null>(null);
  const coverPreviewUrl = ref('');
  const imagePreviewUrls = ref<string[]>([]);
  const imageFiles = ref<File[]>([]);
  const musicFile = ref<File | null>(null);
  const musicPreviewUrl = ref('');
  const previewMusicPlaying = ref(false);
  const previewAudio = ref<HTMLAudioElement | null>(null);
  /** 文章正文的文件路径版本（图片用路径而非 base64），用于写入 project.json */
  let persistArticleContent = '';

  /** 设置持久化文章正文内容 */
  function setPersistArticleContent(content: string) {
    persistArticleContent = content;
  }

  /** 持久化草稿并同步写入项目清单 */
  async function persistDraftAndManifest() {
    await persistDraft();
    try {
      await writeProjectManifest(draft, persistArticleContent);
      Object.assign(workspaceSettings, await loadWorkspaceSettings());
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '同步工作区失败';
    }
  }

  /** 从文件输入事件设置封面文件 */
  function setCoverFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    applyCoverFile(file);
    // 允许用户连续选择同一个文件进行重新上传。
    input.value = '';
  }

  /** 应用封面文件并更新预览和草稿状态 */
  function applyCoverFile(file: File | null) {
    if (coverPreviewUrl.value) URL.revokeObjectURL(coverPreviewUrl.value);
    coverFile.value = file;
    coverPreviewUrl.value = file ? URL.createObjectURL(file) : '';
    draft.coverFileName = file?.name || '';
    draft.coverSize = file?.size || 0;
    void cacheCoverAndPersist(file);
  }

  /** 清除当前封面选择；封面属于具体视频，更换视频时不能沿用上一条视频的封面。 */
  function clearCoverSelection() {
    const previousCacheId = draft.coverCacheId;
    if (coverPreviewUrl.value) URL.revokeObjectURL(coverPreviewUrl.value);
    coverFile.value = null;
    coverPreviewUrl.value = '';
    draft.coverCacheId = '';
    draft.coverFileName = '';
    draft.coverSize = 0;
    if (previousCacheId) void cleanupFileTransfer(previousCacheId);
  }

  /** 更新视频文件并触发缓存持久化 */
  function onVideoFileUpdate(file: File | null) {
    clearCoverSelection();
    if (videoPreviewUrl.value) URL.revokeObjectURL(videoPreviewUrl.value);
    videoFile.value = file;
    videoPreviewUrl.value = file ? URL.createObjectURL(file) : '';
    draft.videoFileName = file?.name || '';
    draft.videoSize = file?.size || 0;
    void cacheVideoAndPersist(file);
  }

  /** 更新封面文件 */
  function onCoverFileUpdate(file: File | null) {
    applyCoverFile(file);
  }

  /** 从图片 URL 设置封面预览 */
  function onCoverUrlFromImage(url: string) {
    if (coverPreviewUrl.value && coverPreviewUrl.value !== url) URL.revokeObjectURL(coverPreviewUrl.value);
    coverPreviewUrl.value = url;
  }

  /** 更新图片预览 URL 列表 */
  function onImageUrlsUpdate(urls: string[]) {
    imagePreviewUrls.value = urls;
  }

  /** 更新图片文件并触发导入和持久化 */
  function onImageFilesUpdate(files: File[]) {
    imageFiles.value = [...files];
    draft.contentType = 'image';
    draft.imageFileNames = files.map((file) => file.name);
    void importImagesAndPersist(files);
  }

  /** 从文件输入事件设置背景音乐文件 */
  function setMusicFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] || null;
    if (musicPreviewUrl.value) URL.revokeObjectURL(musicPreviewUrl.value);
    stopPreviewMusic();
    musicFile.value = file;
    musicPreviewUrl.value = file ? URL.createObjectURL(file) : '';
    draft.musicFileName = file?.name || '';
    draft.musicSize = file?.size || 0;
    void importAssetAndPersist(file, 'music');
  }

  /** 导入素材到工作区并持久化草稿 */
  async function importAssetAndPersist(file: File | null, kind: 'video' | 'cover' | 'music') {
    if (!file) {
      await persistDraftAndManifest();
      return;
    }

    try {
      const imported = await importProjectAsset(draft, file, kind);
      if (imported) {
        draft.projectId = imported.projectId;
        if (kind === 'video') draft.videoFileName = imported.fileName;
        if (kind === 'cover') draft.coverFileName = imported.fileName;
        if (kind === 'music') draft.musicFileName = imported.fileName;
      }
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '导入素材到工作区失败';
    } finally {
      await persistDraftAndManifest();
    }
  }

  /** 缓存视频文件并持久化到工作区 */
  async function cacheVideoAndPersist(file: File | null) {
    const previousCacheId = draft.videoCacheId;
    if (!file) {
      draft.videoCacheId = '';
      await cleanupVideoTransfer(previousCacheId);
      await importAssetAndPersist(null, 'video');
      return;
    }

    busy.value = true;
    notice.value = '正在准备自动上传缓存，视频较大时需要稍等。';
    try {
      const meta = await storeVideoForTransfer(file, previousCacheId);
      draft.videoCacheId = meta.id;
      await importAssetAndPersist(file, 'video');
      notice.value = `视频已缓存，可用于自动上传：${meta.name}`;
    } catch (error) {
      draft.videoCacheId = '';
      notice.value = error instanceof Error ? error.message : '视频缓存失败，将只能手动上传。';
      await importAssetAndPersist(file, 'video');
    } finally {
      busy.value = false;
    }
  }

  /** 缓存封面文件并持久化到工作区 */
  async function cacheCoverAndPersist(file: File | null) {
    const previousCacheId = draft.coverCacheId;
    if (!file) {
      draft.coverCacheId = '';
      await cleanupFileTransfer(previousCacheId);
      await importAssetAndPersist(null, 'cover');
      return;
    }

    try {
      const meta = await storeFileForTransfer(file, previousCacheId);
      draft.coverCacheId = meta.id;
      await importAssetAndPersist(file, 'cover');
    } catch (error) {
      draft.coverCacheId = '';
      notice.value = error instanceof Error ? error.message : '封面缓存失败，将只能手动上传。';
      await importAssetAndPersist(file, 'cover');
    }
  }

  /** 导入图片到工作区并持久化 */
  async function importImagesAndPersist(files: File[]) {
    const previousCacheIds = [...(draft.imageCacheIds || [])];
    draft.imageCacheIds = [];

    if (!files.length) {
      await Promise.allSettled(previousCacheIds.map((cacheId) => cleanupFileTransfer(cacheId)));
      await persistDraftAndManifest();
      return;
    }

    try {
      const importedNames: string[] = [];
      const cacheIds: string[] = [];
      for (const file of files) {
        const previousCacheId = previousCacheIds.shift();
        const meta = await storeFileForTransfer(file, previousCacheId);
        cacheIds.push(meta.id);

        const imported = await importProjectAsset(draft, file, 'image');
        if (imported) {
          draft.projectId = imported.projectId;
          importedNames.push(imported.fileName);
        } else {
          importedNames.push(file.name);
        }
      }
      draft.imageFileNames = importedNames;
      draft.imageCacheIds = cacheIds;
      await Promise.allSettled(previousCacheIds.map((cacheId) => cleanupFileTransfer(cacheId)));
    } catch (error) {
      draft.imageCacheIds = [];
      notice.value = error instanceof Error ? error.message : '导入图片到工作区失败';
    } finally {
      await persistDraftAndManifest();
    }
  }

  /** 切换背景音乐预览播放状态 */
  function togglePreviewMusic() {
    if (!musicPreviewUrl.value) return;
    if (!previewAudio.value || previewAudio.value.src !== musicPreviewUrl.value) {
      previewAudio.value = new Audio(musicPreviewUrl.value);
      previewAudio.value.loop = true;
    }

    if (previewMusicPlaying.value) {
      previewAudio.value.pause();
      previewMusicPlaying.value = false;
      return;
    }

    void previewAudio.value.play().then(() => {
      previewMusicPlaying.value = true;
    });
  }

  /** 停止背景音乐预览 */
  function stopPreviewMusic() {
    previewAudio.value?.pause();
    previewMusicPlaying.value = false;
  }

  /** 部分更新草稿字段并持久化 */
  function onDraftPartialUpdate(partial: Partial<ContentDraft>) {
    Object.assign(draft, partial);
    void persistDraftAndManifest();
  }

  /** 释放所有预览 URL 并清理缓存 */
  function revokeAllUrls() {
    if (videoPreviewUrl.value) URL.revokeObjectURL(videoPreviewUrl.value);
    if (coverPreviewUrl.value) URL.revokeObjectURL(coverPreviewUrl.value);
    videoPreviewUrl.value = '';
    coverPreviewUrl.value = '';
    imagePreviewUrls.value = [];
    imageFiles.value = [];
    if (musicPreviewUrl.value) URL.revokeObjectURL(musicPreviewUrl.value);
    musicPreviewUrl.value = '';
    void cleanupVideoTransfer(draft.videoCacheId);
    void cleanupFileTransfer(draft.coverCacheId);
    (draft.imageCacheIds || []).forEach((cacheId) => {
      void cleanupFileTransfer(cacheId);
    });
    draft.imageCacheIds = [];
    videoFile.value = null;
    coverFile.value = null;
    imageFiles.value = [];
    musicFile.value = null;
    stopPreviewMusic();
  }

  /** 释放所有预览 URL 并重置预览状态 */
  function resetPreviewUrls() {
    if (videoPreviewUrl.value) URL.revokeObjectURL(videoPreviewUrl.value);
    if (coverPreviewUrl.value) URL.revokeObjectURL(coverPreviewUrl.value);
    if (musicPreviewUrl.value) URL.revokeObjectURL(musicPreviewUrl.value);
    imagePreviewUrls.value.forEach((url) => URL.revokeObjectURL(url));
    videoPreviewUrl.value = '';
    coverPreviewUrl.value = '';
    musicPreviewUrl.value = '';
    imagePreviewUrls.value = [];
    stopPreviewMusic();
  }

  /** 重置草稿为默认状态并清理所有资源 */
  function resetDraft() {
    revokeAllUrls();
    Object.assign(draft, { ...DEFAULT_DRAFT });
    void persistDraft();
  }

  /**
   * 分发任务启动后准备下一条草稿。
   * 保留可复用的文案与平台配置，只清除本次项目身份和媒体引用；不删除传输缓存，
   * 因为后台分发任务仍需通过本次 content 中的 cacheId 读取这些文件。
   */
  function prepareDraftForNextPublication() {
    resetPreviewUrls();
    videoFile.value = null;
    coverFile.value = null;
    imageFiles.value = [];
    musicFile.value = null;
    persistArticleContent = '';
    Object.assign(draft, {
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
      imageFileNames: [],
      videoSize: 0,
      coverSize: 0,
      musicSize: 0,
      articleContent: '',
      scheduledAt: 0,
    } satisfies Partial<ContentDraft>);
    void persistDraft();
  }

  /** 从视频记录恢复草稿；复刻只复用发布信息，不恢复或复制素材。 */
  async function restoreDraft(
    video: VideoRecord,
    targetPlatformId?: PlatformId,
    asReplica = false,
  ) {
    const reuseReplicaProject = Boolean(asReplica && draft.replicaSourceProjectId && draft.projectId);
    const replicaProjectId = reuseReplicaProject ? draft.projectId! : createProjectId();
    const previousReplicaVideoCacheId = reuseReplicaProject ? draft.videoCacheId : '';
    const previousReplicaCoverCacheId = reuseReplicaProject ? draft.coverCacheId : '';
    const previousReplicaImageCacheIds = reuseReplicaProject ? [...(draft.imageCacheIds || [])] : [];
    const restoredPlatformSettings = clonePlatformSettings(video.platformSettings);

    draft.sourceVideoId = video.id;
    draft.contentType = video.contentType || (video.imageFileNames?.length ? 'image' : 'video');
    draft.title = video.title;
    draft.description = video.description;
    draft.topicsText = video.topics.join(' ');
    draft.selectedCampaignIds = [...(video.campaignIds || [])];
    draft.projectId = asReplica ? replicaProjectId : video.projectId;
    draft.replicaSourceProjectId = asReplica ? video.projectId : '';
    draft.videoCacheId = asReplica ? '' : video.videoCacheId || '';
    draft.coverCacheId = asReplica ? '' : video.coverCacheId || '';
    draft.imageCacheIds = asReplica ? [] : [...(video.imageCacheIds || [])];
    draft.videoFileName = asReplica ? '' : video.videoFileName || '';
    draft.coverFileName = asReplica ? '' : video.coverFileName || '';
    draft.musicFileName = asReplica ? '' : video.musicFileName || '';
    draft.musicName = asReplica ? '' : video.musicName || '';
    draft.imageFileNames = asReplica ? [] : [...(video.imageFileNames || [])];
    draft.videoSize = asReplica ? 0 : video.videoSize || 0;
    draft.coverSize = asReplica ? 0 : video.coverSize || 0;
    draft.musicSize = asReplica ? 0 : video.musicSize || 0;
    draft.scheduledAt = asReplica ? 0 : normalizeScheduledAt(video.scheduledAt);
    draft.visibility = video.visibility || 'public';
    draft.originalDeclare = video.originalDeclare ?? false;
    draft.platformSettings = restoredPlatformSettings;
    // articleContent 存在 project.json manifest 中，不在 VideoRecord 里
    try {
      const manifest = video.projectId ? await loadProjectManifest(video.projectId) : null;
      const restoredArticleContent = manifest?.articleContent ?? video.articleContent ?? '';
      draft.articleContent = restoredArticleContent;
      persistArticleContent = restoredArticleContent;
    } catch {
      draft.articleContent = video.articleContent || '';
      persistArticleContent = draft.articleContent;
    }
    draft.selectedPlatforms = asReplica
      ? getReplicaPlatformIds(video, draft.contentType)
      : getRestorablePlatformIds(video, draft.contentType, targetPlatformId);

    resetPreviewUrls();
    videoFile.value = null;
    coverFile.value = null;
    imageFiles.value = [];
    musicFile.value = null;

    if (asReplica) {
      await Promise.allSettled([
        previousReplicaVideoCacheId
          ? cleanupVideoTransfer(previousReplicaVideoCacheId)
          : Promise.resolve(),
        previousReplicaCoverCacheId
          ? cleanupFileTransfer(previousReplicaCoverCacheId)
          : Promise.resolve(),
        ...previousReplicaImageCacheIds.map((cacheId) => cleanupFileTransfer(cacheId)),
      ]);
      await persistDraft();
      return true;
    }

    try {
      const assets = await loadProjectAssetFiles({
        projectId: video.projectId,
        videoFileName: video.videoFileName,
        coverFileName: video.coverFileName,
        musicFileName: video.musicFileName,
        imageFileNames: video.imageFileNames,
      });

      if (assets.videoFile) {
        videoFile.value = assets.videoFile;
        videoPreviewUrl.value = URL.createObjectURL(assets.videoFile);
        const meta = await storeVideoForTransfer(assets.videoFile, draft.videoCacheId);
        draft.videoCacheId = meta.id;
        draft.videoFileName = assets.videoFile.name;
        draft.videoSize = assets.videoFile.size;
      }

      if (assets.coverFile) {
        coverFile.value = assets.coverFile;
        coverPreviewUrl.value = URL.createObjectURL(assets.coverFile);
        const meta = await storeFileForTransfer(assets.coverFile, draft.coverCacheId);
        draft.coverCacheId = meta.id;
        draft.coverFileName = assets.coverFile.name;
        draft.coverSize = assets.coverFile.size;
      }

      if (assets.musicFile) {
        musicFile.value = assets.musicFile;
        musicPreviewUrl.value = URL.createObjectURL(assets.musicFile);
        draft.musicFileName = assets.musicFile.name;
        draft.musicSize = assets.musicFile.size;
      }

      if (assets.imageFiles.length) {
        imageFiles.value = [...assets.imageFiles];
        imagePreviewUrls.value = assets.imageFiles.map((file) => URL.createObjectURL(file));
        draft.imageFileNames = assets.imageFiles.map((file) => file.name);
        const previousImageCacheIds = [...(draft.imageCacheIds || [])];
        const imageCacheIds: string[] = [];
        for (let index = 0; index < assets.imageFiles.length; index += 1) {
          const meta = await storeFileForTransfer(assets.imageFiles[index], previousImageCacheIds[index]);
          imageCacheIds.push(meta.id);
        }
        draft.imageCacheIds = imageCacheIds;
        await Promise.allSettled(
          previousImageCacheIds.slice(assets.imageFiles.length).map((cacheId) => cleanupFileTransfer(cacheId)),
        );
      }
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '恢复项目素材失败';
      await persistDraft();
      return false;
    }

    await persistDraft();
    return true;
  }

  /** 编辑原项目。 */
  function restoreDraftFromVideo(video: VideoRecord, targetPlatformId?: PlatformId) {
    return restoreDraft(video, targetPlatformId, false);
  }

  /** 只将发布信息复刻到独立草稿项目；连续复刻会覆盖同一个草稿项目。 */
  function replicateDraftFromVideo(video: VideoRecord) {
    return restoreDraft(video, undefined, true);
  }

  return {
    videoFile,
    videoPreviewUrl,
    coverFile,
    coverPreviewUrl,
    imageFiles,
    imagePreviewUrls,
    musicFile,
    musicPreviewUrl,
    previewMusicPlaying,
    setCoverFile,
    onVideoFileUpdate,
    onCoverFileUpdate,
    onCoverUrlFromImage,
    onImageUrlsUpdate,
    onImageFilesUpdate,
    setMusicFile,
    togglePreviewMusic,
    onDraftPartialUpdate,
    resetDraft,
    prepareDraftForNextPublication,
    revokeAllUrls,
    restoreDraftFromVideo,
    replicateDraftFromVideo,
    setPersistArticleContent,
  };
}
