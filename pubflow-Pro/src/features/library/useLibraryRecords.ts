import { computed, ref } from 'vue';
import { PLATFORM_CONFIGS, PLATFORM_ORDER } from '../../platforms';
import { loadLibraryData as loadStoredLibraryData } from '../../storage/libraryStorage';
import { isCurrentMonth, isToday } from '../../shared/date';
import type { DistributionTask, PlatformId, PublishRecord, VideoRecord } from '../../types';

/** 组合式函数：提供素材库页面的数据加载、筛选和统计。 */
export function useLibraryRecords(params: {
  task: { value: DistributionTask | null };
  videoSearch: { value: string };
  recordSearch: { value: string };
  recordPlatform: { value: 'all' | PlatformId };
  recordStatus: { value: 'all' | PublishRecord['status'] };
}) {
  const videos = ref<VideoRecord[]>([]);
  const records = ref<PublishRecord[]>([]);

  /** 今日已发布记录数量 */
  const todayPublished = computed(
    () =>
      records.value.filter(
        (record) => record.status === 'published' && record.publishedAt && isToday(record.publishedAt),
      ).length,
  );

  /** 等待确认的平台数量 */
  const waitingConfirm = computed(
    () => params.task.value?.platforms.filter((item) => item.status === 'filled').length || 0,
  );

  /** 本月已发布记录数量 */
  const monthPublished = computed(
    () =>
      records.value.filter(
        (record) =>
          record.status === 'published' && record.publishedAt && isCurrentMonth(record.publishedAt),
      ).length,
  );

  /** 总浏览量 */
  const totalViews = computed(() =>
    records.value.reduce((sum, r) => sum + (r.stats?.views || 0), 0),
  );

  /** 总点赞数 */
  const totalLikes = computed(() =>
    records.value.reduce((sum, r) => sum + (r.stats?.likes || 0), 0),
  );

  /** 总评论数 */
  const totalComments = computed(() =>
    records.value.reduce((sum, r) => sum + (r.stats?.comments || 0), 0),
  );

  /** 最近发布的 8 条记录 */
  const recentRecords = computed(() =>
    [...records.value]
      .sort((a, b) => (b.publishedAt || b.updatedAt || 0) - (a.publishedAt || a.updatedAt || 0))
      .slice(0, 8),
  );

  /** 各平台发布状态汇总 */
  const platformSummaries = computed(() =>
    PLATFORM_ORDER.map((platformId) => {
      const platformRecords = records.value.filter((record) => record.platformId === platformId);
      return {
        platformId,
        published: platformRecords.filter((record) => record.status === 'published').length,
        pending: platformRecords.filter((record) => record.status === 'pending' || record.status === 'filled').length,
        error: platformRecords.filter((record) => record.status === 'error').length,
        views: platformRecords.reduce((sum, record) => sum + (record.stats?.views || 0), 0),
      };
    }),
  );

  /** 最近更新的 8 个视频 */
  const topVideos = computed(() =>
    [...videos.value]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8),
  );

  /** 当前进行中的分发任务 */
  const activeTasks = computed(() => {
    if (!params.task.value) return [];
    const completed = params.task.value.platforms.filter((item) =>
      ['filled', 'published', 'skipped'].includes(item.status),
    ).length;
    return [
      {
        id: params.task.value.id.slice(0, 8),
        title: params.task.value.content.title || '未命名内容',
        detail: `${completed}/${params.task.value.platforms.length} 平台已完成`,
        status: params.task.value.status,
      },
    ];
  });

  /** 根据搜索关键词过滤后的视频列表 */
  const filteredVideos = computed(() => {
    const keyword = params.videoSearch.value.trim().toLowerCase();
    if (!keyword) return videos.value;
    return videos.value.filter((video) =>
      [video.title, video.description, video.topics.join(' ')].some((text) =>
        text.toLowerCase().includes(keyword),
      ),
    );
  });

  /** 根据平台、状态和关键词过滤后的发布记录 */
  const filteredRecords = computed(() => {
    const keyword = params.recordSearch.value.trim().toLowerCase();
    return records.value.filter((record) => {
      const platformMatched =
        params.recordPlatform.value === 'all' || record.platformId === params.recordPlatform.value;
      const statusMatched =
        params.recordStatus.value === 'all' || record.status === params.recordStatus.value;
      const keywordMatched =
        !keyword ||
        record.title.toLowerCase().includes(keyword) ||
        PLATFORM_CONFIGS[record.platformId].name.toLowerCase().includes(keyword);
      return platformMatched && statusMatched && keywordMatched;
    });
  });

  /** 从存储加载素材库数据 */
  async function loadLibraryData() {
    const stored = await loadStoredLibraryData();
    videos.value = stored.videos;
    records.value = stored.records;
  }

  /** 获取指定视频的所有发布记录 */
  function getVideoRecords(videoId: string) {
    return records.value.filter((record) => record.videoId === videoId);
  }

  /** 计算指定视频的总浏览量 */
  function videoViews(videoId: string) {
    return getVideoRecords(videoId).reduce((sum, record) => sum + (record.stats?.views || 0), 0);
  }

  /** 计算指定视频的总点赞数 */
  function videoLikes(videoId: string) {
    return getVideoRecords(videoId).reduce((sum, record) => sum + (record.stats?.likes || 0), 0);
  }

  /** 计算指定视频的总评论数 */
  function videoComments(videoId: string) {
    return getVideoRecords(videoId).reduce((sum, record) => sum + (record.stats?.comments || 0), 0);
  }

  return {
    videos,
    records,
    todayPublished,
    waitingConfirm,
    monthPublished,
    totalViews,
    totalLikes,
    totalComments,
    recentRecords,
    platformSummaries,
    topVideos,
    activeTasks,
    filteredVideos,
    filteredRecords,
    loadLibraryData,
    videoViews,
    videoLikes,
    videoComments,
  };
}
