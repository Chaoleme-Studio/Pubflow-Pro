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
  loadProjectAssetFiles,
  loadProjectManifestByVideo,
  loadWorkspaceSettings,
  writeProjectManifest,
} from '../../storage/workspaceStorage';
import { PLATFORM_CONFIGS, supportsContentType } from '../../platforms';
import type { ContentDraft, VideoRecord, WorkspaceSettings } from '../../types';

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

  function setPersistArticleContent(content: string) {
    persistArticleContent = content;
  }

  async function persistDraftAndManifest() {
    await persistDraft();
    try {
      await writeProjectManifest(draft, persistArticleContent);
      Object.assign(workspaceSettings, await loadWorkspaceSettings());
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '同步工作区失败';
    }
  }

  function setCoverFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] || null;
    applyCoverFile(file);
  }

  function applyCoverFile(file: File | null) {
    if (coverPreviewUrl.value) URL.revokeObjectURL(coverPreviewUrl.value);
    coverFile.value = file;
    coverPreviewUrl.value = file ? URL.createObjectURL(file) : '';
    draft.coverFileName = file?.name || '';
    draft.coverSize = file?.size || 0;
    void cacheCoverAndPersist(file);
  }

  function onVideoFileUpdate(file: File | null) {
    if (videoPreviewUrl.value) URL.revokeObjectURL(videoPreviewUrl.value);
    videoFile.value = file;
    videoPreviewUrl.value = file ? URL.createObjectURL(file) : '';
    draft.videoFileName = file?.name || '';
    draft.videoSize = file?.size || 0;
    void cacheVideoAndPersist(file);
  }

  function onCoverFileUpdate(file: File | null) {
    applyCoverFile(file);
  }

  function onCoverUrlFromImage(url: string) {
    if (coverPreviewUrl.value && coverPreviewUrl.value !== url) URL.revokeObjectURL(coverPreviewUrl.value);
    coverPreviewUrl.value = url;
  }

  function onImageUrlsUpdate(urls: string[]) {
    imagePreviewUrls.value = urls;
  }

  function onImageFilesUpdate(files: File[]) {
    imageFiles.value = [...files];
    draft.contentType = 'image';
    draft.imageFileNames = files.map((file) => file.name);
    void importImagesAndPersist(files);
  }

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

  function stopPreviewMusic() {
    previewAudio.value?.pause();
    previewMusicPlaying.value = false;
  }

  function onDraftPartialUpdate(partial: Partial<ContentDraft>) {
    Object.assign(draft, partial);
    void persistDraftAndManifest();
  }

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

  function resetDraft() {
    revokeAllUrls();
    Object.assign(draft, { ...DEFAULT_DRAFT });
    void persistDraft();
  }

  async function restoreDraftFromVideo(video: VideoRecord) {
    draft.sourceVideoId = video.id;
    draft.contentType = video.contentType || (video.imageFileNames?.length ? 'image' : 'video');
    draft.title = video.title;
    draft.description = video.description;
    draft.topicsText = video.topics.join(' ');
    draft.selectedCampaignIds = [...(video.campaignIds || [])];
    draft.projectId = video.projectId || '';
    draft.videoCacheId = video.videoCacheId || '';
    draft.coverCacheId = video.coverCacheId || '';
    draft.imageCacheIds = [...(video.imageCacheIds || [])];
    draft.videoFileName = video.videoFileName || '';
    draft.coverFileName = video.coverFileName || '';
    draft.musicFileName = video.musicFileName || '';
    draft.imageFileNames = [...(video.imageFileNames || [])];
    draft.videoSize = video.videoSize || 0;
    draft.coverSize = video.coverSize || 0;
    draft.musicSize = video.musicSize || 0;
    draft.scheduledAt = video.scheduledAt || 0;
    draft.visibility = video.visibility || 'public';
    draft.originalDeclare = video.originalDeclare ?? false;
    draft.platformSettings = video.platformSettings || {};
    // articleContent 存在 project.json manifest 中，不在 VideoRecord 里
    try {
      const manifest = await loadProjectManifestByVideo(video.projectId || video.id, video.title);
      const restoredArticleContent = manifest?.articleContent ?? video.articleContent ?? '';
      draft.articleContent = restoredArticleContent;
      if (restoredArticleContent) {
        persistArticleContent = restoredArticleContent;
      }
    } catch {
      draft.articleContent = video.articleContent || '';
      persistArticleContent = draft.articleContent;
    }
    draft.selectedPlatforms = video.platforms
      .filter((item) => item.status !== 'published' && item.status !== 'skipped')
      .filter((item) => supportsContentType(PLATFORM_CONFIGS[item.platformId], draft.contentType || 'video'))
      .map((item) => item.platformId);

    resetPreviewUrls();
    videoFile.value = null;
    coverFile.value = null;
    musicFile.value = null;

    try {
      const assets = await loadProjectAssetFiles({
        projectId: video.projectId,
        title: video.title,
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
    revokeAllUrls,
    restoreDraftFromVideo,
    setPersistArticleContent,
  };
}
