<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, reactive, ref } from 'vue';

const PublishView = defineAsyncComponent(() => import('./views/PublishView.vue'));
const DashboardView = defineAsyncComponent(() => import('./views/DashboardView.vue'));
const VideosView = defineAsyncComponent(() => import('./views/VideosView.vue'));
const RecordsView = defineAsyncComponent(() => import('./views/RecordsView.vue'));
const SettingsView = defineAsyncComponent(() => import('./views/SettingsView.vue'));
import { useDistributionLauncher } from '../../src/features/distribution/useDistributionLauncher';
import { usePublishDraft } from '../../src/features/publish/usePublishDraft';
import { useWorkspaceManager } from '../../src/features/workspace/useWorkspaceManager';
import { PLATFORM_CONFIGS, PLATFORM_ORDER, supportsContentType, type CampaignRecommendation } from '../../src/platforms';
import {
  getCampaignById,
  recommendCampaigns,
} from '../../src/platforms/campaigns';
import { hasContent, parseTopics } from '../../src/domain/content';
import { DEFAULT_DRAFT, loadContentDraft, saveContentDraft } from '../../src/storage/draftStorage';
import {
  defaultAISettings,
  defaultGlobalSettings,
  defaultLicensingSettings,
  defaultPlatformSettings,
  defaultServerConfig,
} from '../../src/storage/settingsStorage';
import {
  defaultWorkspaceSettings,
  importProjectAsset,
  loadProjectAssetFiles,
} from '../../src/storage/workspaceStorage';
import type {
  AIProviderSettings,
  DistributionTask,
  GlobalSettings,
  ContentDraft,
  LicensingSettings,
  PlatformId,
  PlatformSettings,
  PublishRecord,
  ServerConfig,
  VideoRecord,
  WorkspaceSettings,
} from '../../src/types';
import { useLibraryRecords } from '../../src/features/library/useLibraryRecords';
import { useLibraryActions } from '../../src/features/library/useLibraryActions';
import { useCoverUrlCache } from '../../src/features/library/useCoverUrlCache';
import { useSettingsAI } from '../../src/features/settings/useSettingsAI';
import { useSettingsPersistence } from '../../src/features/settings/useSettingsPersistence';
import { useSidePanelStatus } from '../../src/features/sidepanel/useSidePanelStatus';
import { useRuntimeTask } from '../../src/features/tasks/useRuntimeTask';
import {
  campaignTypeText,
  formatBytes,
  formatDate,
  formatViews,
  navIcon,
  navItems,
  statusClass,
  statusText,
  type ViewKey,
  viewDescription,
} from './lib/dashboardPresentation';

const sidebarCollapsed = ref(false);
const officialSiteUrl = computed(() =>
  (__PUBFLOW_OFFICIAL_SITE_URL__ || __PUBFLOW_DEFAULT_LICENSE_API_BASE_URL__ || 'https://github.com/Chaoleme/PubFlow').replace(/\/+$/, ''),
);
const extensionVersion = browser.runtime.getManifest().version || '0.0.0';

const draft = reactive<ContentDraft>({ ...DEFAULT_DRAFT });
const { task, refreshTask } = useRuntimeTask();
const notice = ref('');
const busy = ref(false);
const activeView = ref<ViewKey>('dashboard');
const videoSearch = ref('');
const recordSearch = ref('');
const recordPlatform = ref<'all' | PlatformId>('all');
const recordStatus = ref<'all' | PublishRecord['status']>('all');
const uploadTab = ref<'video' | 'image' | 'article'>(draft.contentType || 'video');
const platforms = computed(() => PLATFORM_ORDER.map((id) => PLATFORM_CONFIGS[id]));

const platformSettings = reactive<Record<PlatformId, PlatformSettings>>({
  ...defaultPlatformSettings,
});
const globalSettings = reactive<GlobalSettings>({ ...defaultGlobalSettings });
const serverConfig = reactive<ServerConfig>({ ...defaultServerConfig });
const licensingSettings = reactive<LicensingSettings>({ ...defaultLicensingSettings });
const aiSettings = reactive<AIProviderSettings>({ ...defaultAISettings });
const enabledPlatforms = computed(() => platforms.value.filter((p) => platformSettings[p.id]?.enabled !== false));
const workspaceSettings = reactive<WorkspaceSettings>({ ...defaultWorkspaceSettings });
const {
  aiModelOptions,
  aiModelsLoading,
  addAIProvider,
  removeAIProvider: removeAIProviderInternal,
  applyProviderPreset,
  fetchAIModels: fetchAIModelsInternal,
} = useSettingsAI(aiSettings);
const topicCount = computed(() => parseTopics(draft.topicsText).length);
const canStart = computed(() => draft.selectedPlatforms.length > 0 && hasContent(draft));
const selectedCampaignIds = computed(() =>
  Array.isArray(draft.selectedCampaignIds) ? draft.selectedCampaignIds : [],
);
const selectedPlatformNames = computed(() =>
  draft.selectedPlatforms.map((id) => PLATFORM_CONFIGS[id].name).join('、'),
);
const campaignRecommendations = computed<CampaignRecommendation[]>(() =>
  recommendCampaigns({
    title: draft.title,
    description: draft.description,
    topics: parseTopics(draft.topicsText),
    selectedPlatforms: draft.selectedPlatforms,
    limitPerPlatform: 2,
  }),
);
const selectedCampaigns = computed(() =>
  selectedCampaignIds.value
    .map((id) => getCampaignById(id))
    .filter((campaign) => !!campaign),
);
const {
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
} = useLibraryRecords({
  task,
  videoSearch,
  recordSearch,
  recordPlatform,
  recordStatus,
});
const videoById = computed(() => new Map(videos.value.map((video) => [video.id, video] as const)));
const {
  preloadVideoCovers,
  getCoverUrlForVideo,
  getCoverUrlForRecord,
  disposeCoverUrls,
} = useCoverUrlCache({ videos, videoById });
const enabledPlatformCount = computed(
  () => PLATFORM_ORDER.filter((id) => platformSettings[id]?.enabled).length,
);
const {
  settingsSaving,
  isSettingsDirty,
  settingsStatusText,
  loadSettings,
  saveSettings,
  markSettingsLoaded,
} = useSettingsPersistence({
  platformSettings,
  globalSettings,
  serverConfig,
  licensingSettings,
  aiSettings,
  workspaceSettings,
  setNotice: (message) => {
    notice.value = message;
  },
});

async function hydrate() {
  const loaded = await loadContentDraft();
  Object.assign(draft, loaded);
  uploadTab.value = draft.contentType || 'video';
  await Promise.all([refreshTask(), loadLibraryData(), loadSettings()]);
  await preloadVideoCovers();
}

async function persistDraft() {
  await saveContentDraft(draft);
}

/** 保存文章的文件路径版本到 project.json（不含 base64） */
function onPersistContentUpdate(content: string) {
  setPersistArticleContent(content);
}

/** 保存文章图片到项目 assets/images/ 目录，返回相对路径 */
async function saveArticleImage(file: File, fileName: string): Promise<string> {
  const result = await importProjectAsset(draft, file, 'image');
  if (!result) throw new Error('保存图片失败：无法访问工作区');
  return result.relativePath;
}

/** 从项目 assets/images/ 读取图片，返回可用于 <img src> 的 object URL */
async function loadArticleImageUrl(relativePath: string): Promise<string> {
  // relativePath 格式: "projects/{name}/assets/images/{file}"
  const parts = relativePath.split('/');
  const fileName = parts[parts.length - 1];
  const assets = await loadProjectAssetFiles({
    projectId: draft.projectId,
    title: draft.title,
    imageFileNames: [fileName],
  });
  if (assets.imageFiles[0]) {
    return URL.createObjectURL(assets.imageFiles[0]);
  }
  return relativePath;
}

function setUploadTab(tab: 'video' | 'image' | 'article') {
  uploadTab.value = tab;
  const supportedSelected = draft.selectedPlatforms.filter((id) => supportsContentType(PLATFORM_CONFIGS[id], tab));
  const nextSelected = supportedSelected.length
    ? supportedSelected
    : PLATFORM_ORDER.filter((id) =>
      platformSettings[id]?.enabled !== false &&
      supportsContentType(PLATFORM_CONFIGS[id], tab),
    );
  onDraftPartialUpdate({
    contentType: tab,
    selectedPlatforms: nextSelected,
  });
}

const {
  videoFile,
  videoPreviewUrl,
  coverPreviewUrl,
  imageFiles,
  imagePreviewUrls,
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
  setPersistArticleContent,
} = usePublishDraft({
  draft,
  workspaceSettings,
  notice,
  busy,
  persistDraft,
});

const {
  selectWorkspace,
  initializeDemoWorkspace,
  clearWorkspace,
  clearLocalData,
  restoreFromWorkspace,
} = useWorkspaceManager({
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
});
const { startDistribution } = useDistributionLauncher({
  draft,
  canStart,
  busy,
  notice,
  platformSettings,
  videos,
  task,
  persistDraft,
  beforeStart: () => toggleSidePanel().catch(() => undefined),
  onStarted: () => {
    prepareDraftForNextPublication();
    activeView.value = 'dashboard';
  },
});

function togglePlatform(platformId: PlatformId) {
  if (!supportsContentType(PLATFORM_CONFIGS[platformId], uploadTab.value)) return;
  const exists = draft.selectedPlatforms.includes(platformId);
  draft.selectedPlatforms = exists
    ? draft.selectedPlatforms.filter((id) => id !== platformId)
    : [...draft.selectedPlatforms, platformId];
  void persistDraft();
}

function toggleCampaign(campaignId: string) {
  const exists = selectedCampaignIds.value.includes(campaignId);
  draft.selectedCampaignIds = exists
    ? selectedCampaignIds.value.filter((id) => id !== campaignId)
    : [...selectedCampaignIds.value, campaignId];
  void persistDraft();
}

function openCampaign(url: string) {
  void window.open(url, '_blank', 'noopener,noreferrer');
}

function removeAIProvider(providerId: string) {
  const error = removeAIProviderInternal(providerId);
  if (error) {
    notice.value = error;
  }
}

async function fetchAIModels() {
  notice.value = '';
  try {
    notice.value = await fetchAIModelsInternal();
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '获取模型失败';
  }
}

async function verifyLicense() {
  busy.value = true;
  notice.value = '';
  licensingSettings.statusMessage = '';
  try {
    await saveSettings(false);
    const response = await browser.runtime.sendMessage({
      type: 'VERIFY_LICENSE',
      payload: {
        licensingSettings: { ...licensingSettings },
      },
    });
    if (!response?.ok) throw new Error(response?.error || '授权验证失败');
    Object.assign(licensingSettings, response.data);
    licensingSettings.statusMessage = response.data.statusMessage || '授权验证成功。';
    await saveSettings(false);
  } catch (error) {
    licensingSettings.status = 'invalid';
    licensingSettings.statusMessage = error instanceof Error ? error.message : '授权验证失败';
  } finally {
    busy.value = false;
  }
}

async function resetLicenseSettings() {
  Object.assign(licensingSettings, {
    ...defaultLicensingSettings,
    status: 'unconfigured',
    statusMessage: '',
  });
  await saveSettings(false);
  notice.value = '授权配置已重置。';
}

function hasLicenseCredentials() {
  return Boolean(
    licensingSettings.apiBaseUrl &&
    (licensingSettings.activationCode || (licensingSettings.leaseToken && licensingSettings.clientInstallId)),
  );
}

async function startFromVideo(video: VideoRecord, targetPlatformId?: PlatformId) {
  uploadTab.value = video.contentType || (video.imageFileNames?.length ? 'image' : 'video');
  activeView.value = 'publish';
  notice.value = '正在恢复项目内容…';
  const restored = await restoreDraftFromVideo(video, targetPlatformId);
  if (restored) {
    notice.value = '已恢复到发布页，可继续编辑或重新分发。';
  }
}

function startFromRecord(record: PublishRecord) {
  const video = videoById.value.get(record.videoId);
  if (!video) {
    notice.value = '未找到这条记录对应的视频项目，请先同步工作区数据。';
    return;
  }
  void startFromVideo(video, record.platformId);
}

const {
  sidePanelOpen,
  refreshSidePanelStatus,
  toggleSidePanel,
  handleRuntimeMessage,
} = useSidePanelStatus();

const {
  exportRecords,
  syncData,
  deleteVideo,
} = useLibraryActions({
  videos,
  records,
  filteredRecords,
  busy,
  notice,
  loadLibraryData,
  preloadVideoCovers,
});

function getCampaignLabel(campaignId: string) {
  return getCampaignById(campaignId)?.简称 || '活动';
}

onMounted(async () => {
  await hydrate();
  await refreshSidePanelStatus().catch(() => undefined);
  browser.runtime.onMessage.addListener(handleRuntimeMessage);
  if (!hasLicenseCredentials()) {
    activeView.value = 'settings';
  }
  markSettingsLoaded();
});

onUnmounted(() => {
  browser.runtime.onMessage.removeListener(handleRuntimeMessage);
  revokeAllUrls();
  disposeCoverUrls();
});
</script>

<template>
  <main class="h-screen overflow-hidden bg-[#f5f6f8] text-slate-900">
    <div class="grid h-screen transition-all duration-200" :class="sidebarCollapsed ? 'grid-cols-[68px_minmax(0,1fr)]' : 'grid-cols-[232px_minmax(0,1fr)]'">
      <aside class="relative border-r border-slate-200 bg-[#f1f2f5] transition-all duration-200" :class="sidebarCollapsed ? 'w-[68px]' : 'w-[232px]'">
        <div class="flex h-screen flex-col overflow-hidden">
          <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-4" :class="sidebarCollapsed ? 'justify-center' : ''">
            <div v-if="!sidebarCollapsed" class="min-w-0 flex-1">
              <div class="truncate text-lg font-black text-slate-950">PubFlow</div>
              <div class="text-[11px] text-slate-400">创作者中心</div>
            </div>
            <button
              class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-slate-600"
              type="button"
              :title="sidebarCollapsed ? '展开' : '收起'"
              @click="sidebarCollapsed = !sidebarCollapsed"
            >
              <svg class="h-4 w-4 transition-transform" :class="sidebarCollapsed ? 'rotate-180' : ''" viewBox="0 0 24 24">
                <path d="M15 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
              </svg>
            </button>
          </div>

          <nav class="grid gap-0.5 p-2">
            <button
              v-for="item in navItems"
              :key="item.key"
              class="flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-semibold transition"
              :class="[
                activeView === item.key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:bg-white/70 hover:text-slate-950',
                sidebarCollapsed ? 'justify-center' : '',
              ]"
              :title="sidebarCollapsed ? item.label : ''"
              type="button"
              @click="activeView = item.key"
            >
              <svg
                class="h-5 w-5 shrink-0"
                :class="activeView === item.key ? 'text-rose-500' : 'text-slate-400'"
                viewBox="0 0 24 24"
                v-html="navIcon(item.key)"
              />
              <span v-if="!sidebarCollapsed">{{ item.label }}</span>
            </button>
          </nav>

          <div class="mt-auto border-t border-slate-200 p-3">
            <button
              class="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition"
              :class="sidePanelOpen ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-rose-500 text-white hover:bg-rose-600'"
              type="button"
              @click="toggleSidePanel"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
                <line x1="15" y1="3" x2="15" y2="21" stroke="currentColor" stroke-width="2"/>
              </svg>
              <span v-if="!sidebarCollapsed">{{ sidePanelOpen ? '收起 Panel' : 'Side Panel' }}</span>
            </button>
            <div v-if="!sidebarCollapsed" class="mt-2 text-center text-[11px] text-slate-400">
              <a
                class="hover:text-slate-600 hover:underline"
                :href="officialSiteUrl"
                target="_blank"
                rel="noopener noreferrer"
              >v{{ extensionVersion }} · CopyRight © 2026</a>
            </div>
          </div>
        </div>
      </aside>

      <section class="flex min-w-0 flex-col overflow-hidden">
        <header class="sticky top-0 z-10 border-b border-slate-200 bg-white/92 px-8 py-4 backdrop-blur">
          <div class="flex items-center justify-between gap-6">
            <div>
              <h1 class="text-xl font-black tracking-normal text-slate-950">
                {{ navItems.find((item) => item.key === activeView)?.label }}
              </h1>
              <p class="mt-1 text-sm text-slate-500">{{ viewDescription(activeView) }}</p>
            </div>
            <div class="flex items-center gap-3">
              <template v-if="activeView === 'settings'">
                <span
                  v-if="settingsSaving"
                  class="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-600"
                >
                  自动保存中...
                </span>
                <span
                  v-else
                  class="rounded-md border px-3 py-2 text-xs font-bold"
                  :class="isSettingsDirty
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-slate-50 text-slate-500'"
                >
                  {{ settingsStatusText }}
                </span>
                <button
                  v-if="isSettingsDirty"
                  class="pf-btn-primary"
                  type="button"
                  @click="saveSettings()"
                >
                  保存
                </button>
              </template>
              <button
                v-if="activeView === 'publish'"
                class="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:border-red-300 hover:text-red-600"
                type="button"
                @click="resetDraft"
              >
                清空
              </button>
              <button
                v-if="activeView === 'publish'"
                class="pf-btn-primary"
                :disabled="!canStart || busy"
                type="button"
                @click="startDistribution"
              >
                {{ busy ? '启动中...' : '开始分发' }}
              </button>
            </div>
          </div>
        </header>

        <div class="flex-1 overflow-y-auto p-8">
          <p v-if="notice" class="mb-5 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
            {{ notice }}
          </p>

          <DashboardView
            v-if="activeView === 'dashboard'"
            :today-published="todayPublished"
            :waiting-confirm="waitingConfirm"
            :month-published="monthPublished"
            :total-views="totalViews"
            :total-likes="totalLikes"
            :total-comments="totalComments"
            :top-videos="topVideos"
            :platform-summaries="platformSummaries"
            :records="records"
            :active-tasks="activeTasks"
            :recent-records="recentRecords"
            :task="task"
            :format-date="formatDate"
            :format-bytes="formatBytes"
            :format-views="formatViews"
            :get-cover-url-for-video="getCoverUrlForVideo"
            :video-views="videoViews"
            :video-likes="videoLikes"
            :video-comments="videoComments"
            :status-text="statusText"
            @open-videos="activeView = 'videos'"
            @start-from-video="startFromVideo"
            @toggle-side-panel="toggleSidePanel"
            @task-updated="task = $event"
            @notice="notice = $event"
          />

          <PublishView
            v-else-if="activeView === 'publish'"
            :draft="draft"
            :upload-tab="uploadTab"
            :platforms="enabledPlatforms"
            :topic-count="topicCount"
            :video-preview-url="videoPreviewUrl"
            :video-file="videoFile"
            :cover-preview-url="coverPreviewUrl"
            :image-files="imageFiles"
            :image-preview-urls="imagePreviewUrls"
            :music-preview-url="musicPreviewUrl"
            :preview-music-playing="previewMusicPlaying"
            :active-tasks="activeTasks"
            :status-text="statusText"
            :campaign-recommendations="campaignRecommendations"
            :selected-campaign-ids="selectedCampaignIds"
            :selected-campaigns="selectedCampaigns"
            :campaign-type-text="campaignTypeText"
            :save-image-file="saveArticleImage"
            :load-image-url="loadArticleImageUrl"
            @update:upload-tab="setUploadTab"
            @update:video="onVideoFileUpdate"
            @update:cover="onCoverFileUpdate"
            @update:cover-url="onCoverUrlFromImage"
            @update:image-urls="onImageUrlsUpdate"
            @update:image-files="onImageFilesUpdate"
            @update:draft="onDraftPartialUpdate"
            @persist-draft="persistDraft"
            @update:persist-content="onPersistContentUpdate"
            @set-cover-file="setCoverFile"
            @set-music-file="setMusicFile"
            @toggle-preview-music="togglePreviewMusic"
            @toggle-platform="togglePlatform"
            @toggle-campaign="toggleCampaign"
            @open-campaign="openCampaign"
          />

          <VideosView
            v-else-if="activeView === 'videos'"
            :video-search="videoSearch"
            :filtered-videos="filteredVideos"
            :format-date="formatDate"
            :format-bytes="formatBytes"
            :format-views="formatViews"
            :get-cover-url-for-video="getCoverUrlForVideo"
            :get-campaign-label="getCampaignLabel"
            :video-views="videoViews"
            :video-likes="videoLikes"
            :video-comments="videoComments"
            :status-text="statusText"
            :status-class="statusClass"
            @update:video-search="videoSearch = $event"
            @sync-data="syncData('videos')"
            @open-publish="activeView = 'publish'"
            @open-records="activeView = 'records'"
            @start-from-video="startFromVideo"
            @delete-video="deleteVideo"
          />

          <RecordsView
            v-else-if="activeView === 'records'"
            :record-search="recordSearch"
            :record-platform="recordPlatform"
            :record-status="recordStatus"
            :platforms="enabledPlatforms"
            :filtered-records="filteredRecords"
            :get-cover-url-for-record="getCoverUrlForRecord"
            :format-date="formatDate"
            :format-views="formatViews"
            :status-text="statusText"
            :status-class="statusClass"
            @update:record-search="recordSearch = $event"
            @update:record-platform="recordPlatform = $event"
            @update:record-status="recordStatus = $event"
            @export-records="exportRecords"
            @sync-data="syncData('records')"
            @start-from-record="startFromRecord"
          />

          <SettingsView
            v-else
            :platforms="platforms"
            :platform-settings="platformSettings"
            :global-settings="globalSettings"
            :server-config="serverConfig"
            :licensing-settings="licensingSettings"
            :ai-settings="aiSettings"
            :workspace-settings="workspaceSettings"
            :ai-model-options="aiModelOptions"
            :ai-models-loading="aiModelsLoading"
            @add-ai-provider="addAIProvider"
            @remove-ai-provider="removeAIProvider"
            @apply-provider-preset="applyProviderPreset"
            @fetch-ai-models="fetchAIModels"
            @verify-license="verifyLicense"
            @reset-license-settings="resetLicenseSettings"
            @select-workspace="selectWorkspace"
            @initialize-demo-workspace="initializeDemoWorkspace"
            @clear-workspace="clearWorkspace"
            @restore-from-workspace="restoreFromWorkspace"
            @clear-local-data="clearLocalData"
          />
        </div>
      </section>
    </div>
  </main>
</template>
