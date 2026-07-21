import { ref, type Ref } from 'vue';
import { loadProjectAssetFiles } from '../../storage/workspaceStorage';
import type { PublishRecord, VideoRecord } from '../../types';

/** 根据视频项目ID和封面文件名生成缓存键 */
function getProjectCoverCacheKey(video: Pick<VideoRecord, 'projectId' | 'coverFileName'>) {
  if (!video.projectId || !video.coverFileName) return '';
  return `${video.projectId}:${video.coverFileName}`;
}

/** 释放缓存中所有 blob URL 对象 */
function revokeCoverUrls(cache: Record<string, string>) {
  Object.values(cache).forEach((url) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  });
}

/** 组合式函数：管理视频封面图片的 blob URL 缓存。 */
export function useCoverUrlCache(params: {
  videos: Ref<VideoRecord[]>;
  videoById: Ref<Map<string, VideoRecord>>;
}) {
  const coverUrlCache = ref<Record<string, string>>({});

  /** 预加载所有视频的封面图片到缓存 */
  async function preloadVideoCovers() {
    const targets = params.videos.value.filter((v) => v.projectId && v.coverFileName);
    const nextCache: Record<string, string> = {};

    try {
      await Promise.allSettled(
        targets.map(async (video) => {
          const assets = await loadProjectAssetFiles({
            projectId: video.projectId,
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

  /** 获取指定视频的封面 URL */
  function getCoverUrlForVideo(video: Pick<VideoRecord, 'projectId' | 'coverFileName'>) {
    if (!video.coverFileName || !video.projectId) return '';
    return coverUrlCache.value[getProjectCoverCacheKey(video)] || '';
  }

  /** 根据发布记录获取对应视频的封面 URL */
  function getCoverUrlForRecord(record: Pick<PublishRecord, 'videoId' | 'coverFileName'>) {
    const video = params.videoById.value.get(record.videoId);
    if (video) return getCoverUrlForVideo(video);
    return '';
  }

  /** 释放所有缓存的封面 URL 并清空缓存 */
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
