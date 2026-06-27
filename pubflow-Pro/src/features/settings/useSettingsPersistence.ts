import { onUnmounted, ref, watch } from 'vue';
import {
  loadSettings as loadStoredSettings,
  saveSettings as saveStoredSettings,
} from '../../storage/settingsStorage';
import {
  loadWorkspaceDirectory,
  loadWorkspaceSettings,
  queryWorkspacePermission,
} from '../../storage/workspaceStorage';
import type {
  AIProviderSettings,
  GlobalSettings,
  LicensingSettings,
  PlatformId,
  PlatformSettings,
  ServerConfig,
  WorkspaceSettings,
} from '../../types';

const SETTINGS_AUTOSAVE_DELAY_MS = 500;

/** 组合式函数：管理设置页的加载、自动保存和脏状态。 */
export function useSettingsPersistence(params: {
  platformSettings: Record<PlatformId, PlatformSettings>;
  globalSettings: GlobalSettings;
  serverConfig: ServerConfig;
  licensingSettings: LicensingSettings;
  aiSettings: AIProviderSettings;
  workspaceSettings: WorkspaceSettings;
  setNotice: (notice: string) => void;
}) {
  const {
    platformSettings,
    globalSettings,
    serverConfig,
    licensingSettings,
    aiSettings,
    workspaceSettings,
    setNotice,
  } = params;

  const settingsSaving = ref(false);
  const isSettingsDirty = ref(false);
  const settingsStatusText = ref('已保存');

  let settingsAutoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let settingsLoaded = false;
  let lastSavedSettingsSnapshot = '';

  /** 生成当前设置对象（不含工作区设置）的快照字符串，用于脏状态比较。 */
  function createSettingsSnapshot() {
    return JSON.stringify({
      platformSettings,
      globalSettings,
      serverConfig,
      licensingSettings,
      aiSettings,
    });
  }

  /** 从存储加载设置并回填到响应式对象中。 */
  async function loadSettings() {
    const stored = await loadStoredSettings();
    Object.assign(platformSettings, stored.platformSettings);
    Object.assign(globalSettings, stored.globalSettings);
    Object.assign(serverConfig, stored.serverConfig);
    Object.assign(licensingSettings, stored.licensingSettings);
    Object.assign(aiSettings, stored.aiSettings);
    Object.assign(workspaceSettings, await loadWorkspaceSettings());

    const storedWorkspace = await loadWorkspaceDirectory();
    if (storedWorkspace?.handle) {
      workspaceSettings.directoryName = storedWorkspace.directoryName;
      workspaceSettings.updatedAt = storedWorkspace.updatedAt;
      workspaceSettings.permission = await queryWorkspacePermission(storedWorkspace.handle);
    }
  }

  /** 将当前设置持久化到存储。 */
  async function persistSettings(showNotice = false) {
    if (!settingsLoaded || settingsSaving.value) return;

    const snapshotBeforeSave = createSettingsSnapshot();
    settingsSaving.value = true;

    try {
      await saveStoredSettings({
        platformSettings,
        globalSettings,
        serverConfig,
        licensingSettings,
        aiSettings,
      });
      lastSavedSettingsSnapshot = snapshotBeforeSave;
      isSettingsDirty.value = createSettingsSnapshot() !== lastSavedSettingsSnapshot;
      settingsStatusText.value = showNotice ? '已保存' : '已自动保存';
      if (showNotice) {
        setNotice('设置已保存。');
      }
    } finally {
      settingsSaving.value = false;
    }
  }

  /** 安排一次延迟自动保存。 */
  function scheduleSettingsAutosave() {
    if (!settingsLoaded) return;
    if (settingsAutoSaveTimer) clearTimeout(settingsAutoSaveTimer);
    settingsAutoSaveTimer = setTimeout(() => {
      settingsAutoSaveTimer = null;
      void persistSettings();
    }, SETTINGS_AUTOSAVE_DELAY_MS);
  }

  /** 立即保存设置并提示用户。 */
  async function saveSettings(showNotice = true) {
    if (settingsAutoSaveTimer) {
      clearTimeout(settingsAutoSaveTimer);
      settingsAutoSaveTimer = null;
    }
    await persistSettings(showNotice);
  }

  /** 标记设置已加载完成，重置脏状态。 */
  function markSettingsLoaded() {
    lastSavedSettingsSnapshot = createSettingsSnapshot();
    isSettingsDirty.value = false;
    settingsStatusText.value = '已保存';
    settingsLoaded = true;
  }

  watch(
    () => createSettingsSnapshot(),
    (snapshot) => {
      if (!settingsLoaded) return;
      isSettingsDirty.value = snapshot !== lastSavedSettingsSnapshot;
      settingsStatusText.value = isSettingsDirty.value ? '有未保存改动' : '已保存';
      if (!isSettingsDirty.value) return;
      scheduleSettingsAutosave();
    },
  );

  onUnmounted(() => {
    if (settingsAutoSaveTimer) clearTimeout(settingsAutoSaveTimer);
  });

  return {
    settingsSaving,
    isSettingsDirty,
    settingsStatusText,
    loadSettings,
    saveSettings,
    markSettingsLoaded,
  };
}
