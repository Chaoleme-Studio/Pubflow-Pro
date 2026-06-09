import type { Ref } from 'vue';
import { deleteVideoRecord } from '../../storage/libraryStorage';
import type { PublishRecord, VideoRecord } from '../../types';

export function useLibraryActions(params: {
  videos: Ref<VideoRecord[]>;
  records: Ref<PublishRecord[]>;
  filteredRecords: Ref<PublishRecord[]>;
  busy: Ref<boolean>;
  notice: Ref<string>;
  loadLibraryData: () => Promise<void>;
  preloadVideoCovers: () => Promise<void>;
}) {
  const {
    videos,
    records,
    filteredRecords,
    busy,
    notice,
    loadLibraryData,
    preloadVideoCovers,
  } = params;

  async function exportRecords() {
    const payload = JSON.stringify(filteredRecords.value, null, 2);
    await navigator.clipboard.writeText(payload);
    notice.value = '当前发布记录已复制为 JSON。';
  }

  async function syncData(scope: 'videos' | 'records') {
    await loadLibraryData();
    if (scope === 'videos') await preloadVideoCovers();
    notice.value = scope === 'videos' ? '视频数据已同步。' : '发布记录已同步。';
  }

  async function deleteVideo(video: VideoRecord) {
    const ok = window.confirm(`确定删除「${video.title}」吗？项目会移入工作区 Trash，浏览器列表和发布记录会同步移除。`);
    if (!ok) return;

    busy.value = true;
    try {
      const deleted = await deleteVideoRecord(video.id);
      videos.value = deleted.videos;
      records.value = deleted.records;
      await preloadVideoCovers();
      notice.value = '视频项目已删除，工作区项目已尽量移入 Trash。';
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '删除视频失败';
    } finally {
      busy.value = false;
    }
  }

  return {
    exportRecords,
    syncData,
    deleteVideo,
  };
}
