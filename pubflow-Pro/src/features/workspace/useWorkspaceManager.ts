import type { Ref } from 'vue';
import { clearLibraryData, saveLibraryData } from '../../storage/libraryStorage';
import {
  clearWorkspaceDirectory,
  defaultWorkspaceSettings,
  invalidateWorkspaceCache,
  loadAllWorkspaceProjects,
  readDataFile,
  saveWorkspaceDirectory,
  writeDataFile,
} from '../../storage/workspaceStorage';
import { seedDemoWorkspace } from '../library/seedDemoWorkspace';
import type {
  AIProviderSettings,
  ContentDraft,
  DistributionTask,
  GlobalSettings,
  LicensingSettings,
  PlatformId,
  PlatformSettings,
  PublishRecord,
  ServerConfig,
  VideoRecord,
  WorkspaceSettings,
} from '../../types';

/** 组合式函数：提供工作区选择、清空、演示数据种子和导出功能。 */
export function useWorkspaceManager(params: {
  draft: ContentDraft;
  platformSettings: Record<PlatformId, PlatformSettings>;
  globalSettings: GlobalSettings;
  serverConfig: ServerConfig;
  licensingSettings: LicensingSettings;
  aiSettings: AIProviderSettings;
  workspaceSettings: WorkspaceSettings;
  videos: Ref<VideoRecord[]>;
  records: Ref<PublishRecord[]>;
  task: Ref<DistributionTask | null>;
  notice: Ref<string>;
  busy: Ref<boolean>;
  hydrate: () => Promise<void>;
  resetDraft: () => void;
}) {
  const {
    draft,
    platformSettings,
    globalSettings,
    serverConfig,
    licensingSettings,
    aiSettings,
    workspaceSettings,
    videos,
    records,
    task,
    notice,
    busy,
    hydrate,
    resetDraft,
  } = params;

  /** 选择本地文件夹作为工作区，并初始化或载入工作区数据 */
  async function selectWorkspace() {
    const picker = (window as Window & {
      showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;

    if (!picker) {
      notice.value = '当前浏览器不支持选择本地工作区，请使用新版 Chrome / Edge。';
      return;
    }

    try {
      const handle = await picker({ mode: 'readwrite' });
      await saveWorkspaceDirectory(handle);
      invalidateWorkspaceCache();

      const existingData = await readDataFile();
      if (!existingData) {
        await writeDataFile({
          draft: { ...draft },
          settings: {
            platformSettings: { ...platformSettings } as Record<string, unknown>,
            globalSettings: { ...globalSettings } as Record<string, unknown>,
            serverConfig: { ...serverConfig } as Record<string, unknown>,
            licensingSettings: { ...licensingSettings } as Record<string, unknown>,
            aiSettings: { ...aiSettings } as Record<string, unknown>,
          },
          projectIndex: videos.value.map((video) => ({
            projectId: video.projectId || video.id,
            path: `projects/${video.projectId || video.id}`,
            title: video.title,
            updatedAt: video.updatedAt,
          })),
        });
        await saveLibraryData(videos.value, records.value);
        await hydrate();
        notice.value = `工作区已设置为：${handle.name}，并已用当前浏览器数据初始化。`;
        return;
      }

      await hydrate();
      notice.value = `工作区已设置为：${handle.name}，已载入工作区数据。`;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      notice.value = error instanceof Error ? error.message : '选择工作区失败';
    }
  }

  /** 清除已设置的工作区目录，回退到浏览器内部缓存 */
  async function clearWorkspace() {
    await clearWorkspaceDirectory();
    invalidateWorkspaceCache();
    Object.assign(workspaceSettings, defaultWorkspaceSettings);
    notice.value = '工作区连接已清除，当前将回退到浏览器内部缓存。';
  }

  /** 清空浏览器本地缓存的所有数据（视频、发布记录、草稿等） */
  async function clearLocalData() {
    await clearLibraryData();
    videos.value = [];
    records.value = [];
    task.value = null;
    resetDraft();
    notice.value = workspaceSettings.directoryName
      ? '浏览器缓存已清空，工作区数据不受影响（重新加载即可恢复）。'
      : '浏览器内部数据已清空。';
  }

  /** 从工作区目录读取所有项目并恢复到当前会话中 */
  async function restoreFromWorkspace() {
    busy.value = true;
    notice.value = '正在从工作区读取项目…';
    try {
      const projects = await loadAllWorkspaceProjects();
      if (!projects.length) {
        notice.value = '工作区里没有找到任何项目，请先在设置里选择工作区文件夹并导入过素材。';
        return;
      }

      const restored: VideoRecord[] = projects.map((project) => project.video);
      const restoredRecords: PublishRecord[] = projects.flatMap((project) => project.records || []);

      videos.value = restored;
      records.value = restoredRecords;
      await saveLibraryData(restored, restoredRecords);
      notice.value = `已从工作区恢复 ${restored.length} 个项目。`;
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '恢复失败';
    } finally {
      busy.value = false;
    }
  }

  /** 初始化内置的演示工作区，导入样例项目数据 */
  async function initializeDemoWorkspace() {
    busy.value = true;
    notice.value = '正在初始化样例工作区…';
    try {
      const seeded = await seedDemoWorkspace();
      await saveLibraryData(seeded.videos, seeded.records);
      await hydrate();
      notice.value = seeded.skippedProjects > 0
        ? `样例工作区已初始化，${seeded.skippedProjects} 个项目已存在，已跳过重复拷贝。`
        : `样例工作区已初始化，共 ${seeded.projectCount} 个项目。`;
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '初始化样例工作区失败';
    } finally {
      busy.value = false;
    }
  }

  return {
    selectWorkspace,
    clearWorkspace,
    clearLocalData,
    restoreFromWorkspace,
    initializeDemoWorkspace,
  };
}
