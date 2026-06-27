import type { Ref } from 'vue';
import { deleteVideoRecord } from '../../storage/libraryStorage';
import type { PublishRecord, VideoRecord } from '../../types';

/** 组合式函数：提供作品库的导出、同步和删除操作。 */
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

  /** 将当前筛选后的发布记录导出为 JSON 并复制到剪贴板 */
  async function exportRecords() {
    const payload = JSON.stringify(filteredRecords.value, null, 2);
    await navigator.clipboard.writeText(payload);
    notice.value = '当前发布记录已复制为 JSON。';
  }

  /** 同步指定范围的数据（视频或发布记录） */
  async function syncData(scope: 'videos' | 'records') {
    await loadLibraryData();
    if (scope === 'videos') await preloadVideoCovers();
    notice.value = scope === 'videos' ? '视频数据已同步。' : '发布记录已同步。';
  }

  /** 删除指定视频项目，同步更新列表和工作区 Trash */
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
