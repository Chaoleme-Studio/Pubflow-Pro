import { computed, ref } from 'vue';
import { PLATFORM_CONFIGS, PLATFORM_ORDER } from '../../platforms';
import { loadLibraryData as loadStoredLibraryData } from '../../storage/libraryStorage';
import { isCurrentMonth, isToday } from '../../shared/date';
import type { DistributionTask, PlatformId, PublishRecord, VideoRecord } from '../../types';

export function useLibraryRecords(params: {
  task: { value: DistributionTask | null };
  videoSearch: { value: string };
  recordSearch: { value: string };
  recordPlatform: { value: 'all' | PlatformId };
  recordStatus: { value: 'all' | PublishRecord['status'] };
}) {
  const videos = ref<VideoRecord[]>([]);
  const records = ref<PublishRecord[]>([]);

  const todayPublished = computed(
    () =>
      records.value.filter(
        (record) => record.status === 'published' && record.publishedAt && isToday(record.publishedAt),
      ).length,
  );

  const waitingConfirm = computed(
    () => params.task.value?.platforms.filter((item) => item.status === 'filled').length || 0,
  );

  const monthPublished = computed(
    () =>
      records.value.filter(
        (record) =>
          record.status === 'published' && record.publishedAt && isCurrentMonth(record.publishedAt),
      ).length,
  );

  const totalViews = computed(() =>
    records.value.reduce((sum, r) => sum + (r.stats?.views || 0), 0),
  );

  const totalLikes = computed(() =>
    records.value.reduce((sum, r) => sum + (r.stats?.likes || 0), 0),
  );

  const totalComments = computed(() =>
    records.value.reduce((sum, r) => sum + (r.stats?.comments || 0), 0),
  );

  const recentRecords = computed(() =>
    [...records.value]
      .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
      .slice(0, 8),
  );

  const platformSummaries = computed(() =>
    PLATFORM_ORDER.map((platformId) => {
      const platformRecords = records.value.filter((record) => record.platformId === platformId);
      return {
        platformId,
        published: platformRecords.filter((record) => record.status === 'published').length,
        pending: platformRecords.filter((record) => record.status === 'pending').length,
        error: platformRecords.filter((record) => record.status === 'error').length,
        views: platformRecords.reduce((sum, record) => sum + (record.stats?.views || 0), 0),
      };
    }),
  );

  const topVideos = computed(() =>
    [...videos.value]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8),
  );

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

  const filteredVideos = computed(() => {
    const keyword = params.videoSearch.value.trim().toLowerCase();
    if (!keyword) return videos.value;
    return videos.value.filter((video) =>
      [video.title, video.description, video.topics.join(' ')].some((text) =>
        text.toLowerCase().includes(keyword),
      ),
    );
  });

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

  async function loadLibraryData() {
    const stored = await loadStoredLibraryData();
    videos.value = stored.videos;
    records.value = stored.records;
  }

  function getVideoRecords(videoId: string) {
    return records.value.filter((record) => record.videoId === videoId);
  }

  function videoViews(videoId: string) {
    return getVideoRecords(videoId).reduce((sum, record) => sum + (record.stats?.views || 0), 0);
  }

  function videoLikes(videoId: string) {
    return getVideoRecords(videoId).reduce((sum, record) => sum + (record.stats?.likes || 0), 0);
  }

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
