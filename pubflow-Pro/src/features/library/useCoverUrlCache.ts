import { ref, type Ref } from 'vue';
import { loadProjectAssetFiles } from '../../storage/workspaceStorage';
import type { PublishRecord, VideoRecord } from '../../types';

function getProjectCoverCacheKey(video: Pick<VideoRecord, 'projectId' | 'coverFileName'>) {
  if (!video.projectId || !video.coverFileName) return '';
  return `${video.projectId}:${video.coverFileName}`;
}

function revokeCoverUrls(cache: Record<string, string>) {
  Object.values(cache).forEach((url) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  });
}

export function useCoverUrlCache(params: {
  videos: Ref<VideoRecord[]>;
  videoById: Ref<Map<string, VideoRecord>>;
}) {
  const coverUrlCache = ref<Record<string, string>>({});

  async function preloadVideoCovers() {
    const targets = params.videos.value.filter((v) => v.projectId && v.coverFileName);
    const nextCache: Record<string, string> = {};

    try {
      await Promise.allSettled(
        targets.map(async (video) => {
          const assets = await loadProjectAssetFiles({
            projectId: video.projectId,
            title: video.title,
            coverFileName: video.coverFileName,
          });
          if (assets.coverFile && video.coverFileName) {
            nextCache[getProjectCoverCacheKey(video)] = URL.createObjectURL(assets.coverFile);
          }
        }),
      );

      revokeCoverUrls(coverUrlCache.value);
      coverUrlCache.value = nextCache;
    } catch (error) {
      revokeCoverUrls(nextCache);
      throw error;
    }
  }

  function getCoverUrlForVideo(video: Pick<VideoRecord, 'projectId' | 'coverFileName'>) {
    if (!video.coverFileName || !video.projectId) return '';
    return coverUrlCache.value[getProjectCoverCacheKey(video)] || '';
  }

  function getCoverUrlForRecord(record: Pick<PublishRecord, 'videoId' | 'coverFileName'>) {
    const video = params.videoById.value.get(record.videoId);
    if (video) return getCoverUrlForVideo(video);
    return '';
  }

  function disposeCoverUrls() {
    revokeCoverUrls(coverUrlCache.value);
    coverUrlCache.value = {};
  }

  return {
    preloadVideoCovers,
    getCoverUrlForVideo,
    getCoverUrlForRecord,
    disposeCoverUrls,
  };
}
