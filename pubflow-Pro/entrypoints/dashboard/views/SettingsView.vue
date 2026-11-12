<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { PlatformConfig } from '../../../src/platforms';
import { LOCAL_MODE } from '../../../src/licensing/localMode';
import type { AIProviderConfig, AIProviderSettings, GlobalSettings, LicensingSettings, PlatformId, PlatformSettings, ServerConfig, WorkspaceSettings } from '../../../src/types';

export interface ReservedPlatform {
  id: string;
  name: string;
  icon: string;
  note: string;
}

const RESERVED_PLATFORMS: ReservedPlatform[] = [
  { id: 'toutiao',     name: '今日头条', icon: 'TT',  note: '图文/视频发布' },
  { id: 'acfun',       name: 'A站',     icon: 'AC',  note: '弹幕视频' },
  { id: 'pinduoduo',   name: '拼多多',   icon: 'PDD', note: '短视频/商品' },
  { id: 'taobao',      name: '淘宝',    icon: 'TB',  note: '逛逛/短视频' },
  { id: 'jingdong',    name: '京东',    icon: 'JD',  note: '短视频/商品' },
  { id: 'netease',     name: '网易云音乐', icon: 'NE', note: 'Mlog/视频' },
  { id: 'douyu',       name: '斗鱼',    icon: 'DY',  note: '短视频/回放' },
  { id: 'huya',        name: '虎牙',    icon: 'HY',  note: '短视频/回放' },
  { id: 'fanqie',      name: '番茄',    icon: 'FQ',  note: '短剧/短视频' },
  { id: 'qidian',      name: '起点',    icon: 'QD',  note: '推书/短视频' },
  { id: 'soul',        name: 'Soul',    icon: 'SO',  note: '瞬间/视频' },
  { id: 'tantan',      name: '探探',    icon: 'TT2', note: '动态/视频' },
];

const props = defineProps<{
  platforms: PlatformConfig[];
  platformSettings: Record<PlatformId, PlatformSettings>;
  globalSettings: GlobalSettings;
  serverConfig: ServerConfig;
  licensingSettings: LicensingSettings;
  aiSettings: AIProviderSettings;
  workspaceSettings: WorkspaceSettings;
  aiModelOptions: string[];
  aiModelsLoading: boolean;
}>();

const emit = defineEmits<{
  addAiProvider: [builtinId: AIProviderConfig['builtinId']];
  removeAiProvider: [providerId: string];
  applyProviderPreset: [provider: AIProviderConfig];
  fetchAiModels: [];
  verifyLicense: [];
  resetLicenseSettings: [];
  selectWorkspace: [];
  clearWorkspace: [];
  restoreFromWorkspace: [];
  initializeDemoWorkspace: [];
  clearLocalData: [];
}>();

const showServerKey = ref(false);
const showActivationCode = ref(false);
const editingActivationCode = ref(false);
const activationCodeInput = ref<HTMLInputElement | null>(null);
const devWorkspacePath = import.meta.env.DEV ? __PUBFLOW_DEV_WORKSPACE_PATH__ : '';
const expandedProviderId = ref('');
const visibleAIProviderIds = ref<string[]>([]);
const cardClass = 'pf-card-padded';
const titleClass = 'pf-panel-title';
const fieldLabelClass = 'pf-label';
const inputClass = 'pf-input';
const selectClass = 'pf-select';
const builtinModelOptions: Partial<Record<AIProviderConfig['builtinId'], string[]>> = {
  deepseek: ['Deepseek-V4-Flash', 'Deepseek-V4-Pro'],
};

function togglePlatformChannel(platform: PlatformConfig) {
  const settings = props.platformSettings[platform.id];
  settings.enabled = !settings.enabled;
}

const activeProvider = computed(() =>
  props.aiSettings.providers.find((provider) => provider.id === props.aiSettings.activeProviderId)
  || props.aiSettings.providers[0]
  || null,
);

const workspaceStateText = computed(() => {
  if (!props.workspaceSettings.directoryName) return '未选择';
  const permissionText: Record<WorkspaceSettings['permission'], string> = {
    granted: '已授权',
    denied: '未授权',
    prompt: '需确认',
    unsupported: '当前浏览器不支持',
    unknown: '未知',
  };
  return permissionText[props.workspaceSettings.permission] || '未知';
});

const licenseFeedbackClass = computed(() => {
  if (props.licensingSettings.status === 'active') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (props.licensingSettings.status === 'restricted') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (
    props.licensingSettings.status === 'invalid'
    || props.licensingSettings.status === 'expired'
    || props.licensingSettings.status === 'device_mismatch'
  ) {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  return 'border-amber-200 bg-amber-50 text-amber-700';
});

const licenseFeedbackText = computed(() => {
  return props.licensingSettings.statusMessage || '';
});

const licenseBadgeText = computed(() => {
  if (LOCAL_MODE) return '本地模式';
  if (props.licensingSettings.status === 'active') return '已授权';
  if (props.licensingSettings.status === 'restricted') return '受限模式';
  return '未授权';
});

const licenseBadgeClass = computed(() => {
  if (LOCAL_MODE) return 'border-blue-200 bg-blue-50 text-blue-700';
  if (props.licensingSettings.status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (props.licensingSettings.status === 'restricted') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
});

const licenseValidUntilText = computed(() => {
  const value = props.licensingSettings.validUntil;
  if (typeof value !== 'number' || value <= 0) return '';
  return new Date(value * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
});

const licenseLeaseNotice = computed(() => {
  if (props.licensingSettings.status === 'restricted') {
    return props.licensingSettings.statusMessage || '授权验证已到期，请联网重新验证后继续发布。';
  }
  if (props.licensingSettings.status !== 'active') return '';
  const validUntil = props.licensingSettings.validUntil;
  if (typeof validUntil !== 'number' || validUntil <= 0) return '';
  const secondsLeft = validUntil - Math.floor(Date.now() / 1000);
  if (secondsLeft <= 0) return '授权验证已到期，请联网重新验证后继续发布。';
  const daysLeft = Math.ceil(secondsLeft / 86400);
  if (daysLeft <= 7) return `授权验证将在 ${daysLeft} 天内到期，请保持联网完成续租。`;
  return '';
});

const licenseLeaseNoticeClass = computed(() => {
  const validUntil = props.licensingSettings.validUntil;
  if (typeof validUntil !== 'number' || validUntil <= 0) return 'border-amber-200 bg-amber-50 text-amber-700';
  const secondsLeft = validUntil - Math.floor(Date.now() / 1000);
  if (secondsLeft <= 0) return 'border-red-200 bg-red-50 text-red-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
});

function hasModelOptions(providerId: string) {
  const provider = props.aiSettings.providers.find((item) => item.id === providerId);
  return getModelOptions(provider).length > 0;
}

function getModelOptions(provider?: AIProviderConfig) {
  if (!provider) return [];
  const fetched = provider.id === props.aiSettings.activeProviderId ? props.aiModelOptions : [];
  const builtin = builtinModelOptions[provider.builtinId] || [];
  return Array.from(new Set([...fetched, ...builtin, provider.textModel, provider.imageModel].filter(Boolean)));
}

/** 仅用于只读脱敏展示；激活码的星号文本不会进入真实编辑 input。 */
function maskSecret(value: string) {
  if (!value) return '';
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

function toggleProviderPanel(providerId: string) {
  expandedProviderId.value = expandedProviderId.value === providerId ? '' : providerId;
}

function isAIKeyVisible(providerId: string) {
  return visibleAIProviderIds.value.includes(providerId);
}

function toggleAIKey(providerId: string) {
  if (isAIKeyVisible(providerId)) {
    visibleAIProviderIds.value = visibleAIProviderIds.value.filter((id) => id !== providerId);
    return;
  }
  visibleAIProviderIds.value = [...visibleAIProviderIds.value, providerId];
}

function toggleServerKey() {
  showServerKey.value = !showServerKey.value;
}

function updateActivationCode(event: Event) {
  props.licensingSettings.activationCode = (event.target as HTMLInputElement).value;
  props.licensingSettings.leaseToken = '';
  props.licensingSettings.validUntil = undefined;
  props.licensingSettings.serverTime = undefined;
  props.licensingSettings.serverTimeCheckedAt = undefined;
  props.licensingSettings.status = 'unconfigured';
  props.licensingSettings.statusMessage = '';
}

function beginEditActivationCode() {
  editingActivationCode.value = true;
  void nextTick(() => {
    const input = activationCodeInput.value;
    input?.focus();
    const end = input?.value.length || 0;
    input?.setSelectionRange(end, end);
  });
}

function finishEditActivationCode() {
  if (!showActivationCode.value) editingActivationCode.value = false;
}

function toggleActivationCodeVisibility() {
  showActivationCode.value = !showActivationCode.value;
  if (!showActivationCode.value) {
    editingActivationCode.value = false;
  }
}

function updateProviderApiKey(provider: AIProviderConfig, event: Event) {
  provider.apiKey = (event.target as HTMLInputElement).value;
}

function updateServerApiKey(event: Event) {
  props.serverConfig.apiKey = (event.target as HTMLInputElement).value;
}

watch(
  () => [props.aiSettings.activeProviderId, props.aiSettings.providers.map((provider) => provider.id).join(',')],
  () => {
    if (!props.aiSettings.providers.length) {
      expandedProviderId.value = '';
      visibleAIProviderIds.value = [];
      return;
    }
    const exists = props.aiSettings.providers.some((provider) => provider.id === expandedProviderId.value);
    if (!exists) {
      expandedProviderId.value = props.aiSettings.activeProviderId || props.aiSettings.providers[0]?.id || '';
    }
    visibleAIProviderIds.value = visibleAIProviderIds.value.filter((providerId) =>
      props.aiSettings.providers.some((provider) => provider.id === providerId),
    );
  },
  { immediate: true },
);
</script>

<template>
  <div class="grid gap-5">
    <section :class="cardClass">
      <div class="flex items-center justify-between">
        <h2 :class="titleClass">渠道管理</h2>
        <span class="text-xs font-medium text-slate-400">点击卡片切换</span>
      </div>

      <!-- 已接入平台 -->
      <div class="mt-4 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        <button
          v-for="platform in platforms"
          :key="platform.id"
          class="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition"
          :class="platformSettings[platform.id].enabled
            ? 'border-rose-200 bg-rose-50/60 hover:bg-rose-50'
            : 'border-slate-200 bg-white opacity-55 hover:opacity-75'"
          type="button"
          @click="togglePlatformChannel(platform)"
        >
          <span
            class="grid h-8 w-10 shrink-0 place-items-center rounded text-[10px] font-black"
            :class="platformSettings[platform.id].enabled ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-400'"
          >{{ platform.icon }}</span>

          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-bold" :class="platformSettings[platform.id].enabled ? 'text-slate-900' : 'text-slate-500'">{{ platform.name }}</div>
            <div class="truncate text-[10px] text-slate-400">{{ platform.matchHosts.join(' / ') }}</div>
          </div>

          <span
            class="relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors duration-200"
            :class="platformSettings[platform.id].enabled ? 'bg-rose-500' : 'bg-slate-300'"
          >
            <span
              class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200"
              :class="platformSettings[platform.id].enabled ? 'translate-x-4' : 'translate-x-0'"
            />
          </span>
        </button>
      </div>

      <!-- 预留平台 -->
      <div class="mt-4 border-t border-slate-100 pt-3">
        <div class="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">规划中</div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
          <div
            v-for="reserved in RESERVED_PLATFORMS"
            :key="reserved.id"
            class="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 opacity-45"
          >
            <span class="grid h-8 w-10 shrink-0 place-items-center rounded bg-slate-100 text-[10px] font-black text-slate-400">{{ reserved.icon }}</span>

            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-bold text-slate-500">{{ reserved.name }}</div>
              <div class="truncate text-[10px] text-slate-400">{{ reserved.note }}</div>
            </div>

            <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">待开发</span>
          </div>
        </div>
      </div>
    </section>

    <section :class="cardClass">
      <h2 :class="titleClass">通用设置</h2>
      <div class="mt-4 grid gap-4">
        <label class="grid grid-cols-[140px_1fr] items-center gap-4">
          <span :class="fieldLabelClass">填充速度</span>
          <div class="relative w-48">
            <select v-model="globalSettings.fillSpeed" :class="selectClass">
              <option value="slow">慢速</option>
              <option value="normal">正常</option>
              <option value="fast">快速</option>
            </select>
            <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
              <svg class="h-4 w-4" viewBox="0 0 20 20" fill="none">
                <path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </div>
        </label>
        <label class="grid grid-cols-[140px_1fr] items-center gap-4">
          <span :class="fieldLabelClass">自动发布</span>
          <input v-model="globalSettings.autoSubmit" class="h-4 w-4" type="checkbox" />
        </label>
        <label class="grid grid-cols-[140px_1fr] items-center gap-4">
          <span :class="fieldLabelClass">分发间隔</span>
          <input v-model.number="globalSettings.distributionInterval" class="pf-input w-28" min="1" type="number" />
        </label>
        <label class="grid grid-cols-[140px_1fr] items-center gap-4">
          <span :class="fieldLabelClass">话题步骤间隔</span>
          <div class="flex items-center gap-2">
            <input
              v-model.number="globalSettings.topicIntervalMs"
              class="pf-input w-28"
              max="3000"
              min="100"
              step="100"
              type="number"
            />
            <span class="text-xs text-slate-400">毫秒</span>
          </div>
        </label>
      </div>
    </section>

    <section :class="cardClass">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 :class="titleClass">主工作区</h2>
          <p class="mt-1 text-sm leading-6 text-slate-500">插件会优先把设置、草稿、项目数据、素材和发布记录写到这里。换浏览器或重装后，只要重新选回同一个文件夹，就能继续使用。</p>
        </div>
        <span class="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600">{{ workspaceStateText }}</span>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <div class="min-w-64 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700">
          {{ workspaceSettings.directoryName || '尚未选择工作区目录' }}
        </div>
        <button class="pf-btn-dark" type="button" @click="emit('selectWorkspace')">选择文件夹</button>
        <button class="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-300 hover:text-red-600" type="button" @click="emit('clearWorkspace')">清除</button>
      </div>
      <p class="mt-3 text-xs leading-5 text-slate-400">这里仅显示目录名。浏览器只保存授权句柄和少量缓存；工作区根目录下的 <code class="rounded bg-slate-100 px-1 text-xs">pubflow-data.json</code> 保存草稿、设置和项目索引，<code class="rounded bg-slate-100 px-1 text-xs">projects/</code> 里的 <code class="rounded bg-slate-100 px-1 text-xs">project.json</code> 保存项目、素材引用和发布记录。</p>
      <p v-if="devWorkspacePath" class="mt-2 text-xs leading-5 text-amber-700">
        开发环境预设工作区：<code class="rounded bg-amber-50 px-1 text-xs">{{ devWorkspacePath }}</code>。首次授权一次后，后续用同一个开发 Profile 会自动恢复。
      </p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button class="pf-btn-accent" type="button" @click="emit('restoreFromWorkspace')">从项目恢复</button>
        <button
          v-if="workspaceSettings.directoryName"
          class="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100"
          type="button"
          @click="emit('initializeDemoWorkspace')"
        >
          初始化样例工作区
        </button>
        <button class="pf-btn-danger" type="button" @click="emit('clearLocalData')">清空浏览器缓存</button>
      </div>
    </section>

    <section :class="cardClass">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 :class="titleClass">AI 助手</h2>
          <p class="mt-1 text-sm leading-6 text-slate-500">可以添加多个 OpenAI Compatible 供应商，当前使用的供应商用于 AI 填写、活动推荐和封面生成。</p>
        </div>
        <label class="flex items-center gap-2 text-sm font-bold text-slate-700">
          <input v-model="aiSettings.enabled" type="checkbox" />
          {{ aiSettings.enabled ? '已启用' : '未启用' }}
        </label>
      </div>

      <div class="mt-5 grid gap-3">
        <div
          v-for="provider in aiSettings.providers"
          :key="provider.id"
          class="rounded-md border border-slate-200 bg-slate-50/60 p-4"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex items-center gap-3">
              <label class="flex items-center gap-2 text-sm font-black text-slate-900">
                <input v-model="aiSettings.activeProviderId" :value="provider.id" type="radio" />
                当前使用
              </label>
              <div class="min-w-0">
                <div class="truncate text-sm font-black text-slate-900">{{ provider.name || '未命名供应商' }}</div>
                <div class="truncate text-xs text-slate-500">{{ provider.builtinId }} · {{ provider.textModel || '未设置模型' }}</div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <label class="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input v-model="provider.enabled" type="checkbox" />
                启用
              </label>
              <button class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:border-blue-300 hover:text-blue-600" type="button" @click="emit('applyProviderPreset', provider)">套用预设</button>
              <button class="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-red-600 hover:border-red-400" type="button" @click="emit('removeAiProvider', provider.id)">删除</button>
              <button class="grid h-8 w-8 place-items-center rounded-md border border-slate-300 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-600" type="button" :title="expandedProviderId === provider.id ? '收起' : '展开'" @click="toggleProviderPanel(provider.id)">
                <svg class="h-4 w-4 transition-transform" :class="expandedProviderId === provider.id ? 'rotate-180' : ''" viewBox="0 0 20 20" fill="none">
                  <path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>

          <div v-if="expandedProviderId === provider.id" class="mt-4 grid grid-cols-2 gap-4">
            <label class="grid gap-2">
              <span :class="fieldLabelClass">Provider</span>
              <div class="flex gap-2">
                <div class="relative min-w-0 flex-1">
                  <select v-model="provider.builtinId" :class="selectClass" @change="emit('applyProviderPreset', provider)">
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai">OpenAI</option>
                    <option value="qwen">通义千问</option>
                    <option value="siliconflow">SiliconFlow</option>
                    <option value="xiaomi">小米</option>
                    <option value="custom">OpenAI Compatible</option>
                  </select>
                  <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                    <svg class="h-4 w-4" viewBox="0 0 20 20" fill="none">
                      <path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                </div>
                <button class="shrink-0 rounded-md bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800" type="button" @click="emit('addAiProvider', provider.builtinId)">添加供应商</button>
                <button class="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:border-blue-400 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="aiModelsLoading || !provider.baseUrl" type="button" @click="aiSettings.activeProviderId = provider.id; emit('fetchAiModels')">
                  {{ aiModelsLoading && aiSettings.activeProviderId === provider.id ? '获取中' : '获取模型' }}
                </button>
              </div>
            </label>
            <label class="grid gap-2">
              <span :class="fieldLabelClass">名称</span>
              <input v-model="provider.name" :class="inputClass" />
            </label>
            <label class="grid gap-2">
              <span :class="fieldLabelClass">Base URL</span>
              <input v-model="provider.baseUrl" :class="inputClass" placeholder="https://api.deepseek.com/v1" />
            </label>
            <label class="grid gap-2">
              <span class="text-sm font-bold text-slate-700">API Key</span>
              <div class="flex rounded-md border border-slate-300 bg-white focus-within:border-rose-500 focus-within:ring-2 focus-within:ring-rose-100">
                <input
                  :value="isAIKeyVisible(provider.id) ? provider.apiKey : maskSecret(provider.apiKey)"
                  class="min-w-0 flex-1 rounded-md px-3 py-2.5 text-sm outline-none"
                  type="text"
                  autocomplete="off"
                  @input="updateProviderApiKey(provider, $event)"
                />
                <button class="grid w-11 place-items-center text-slate-400 hover:text-slate-700" type="button" :title="isAIKeyVisible(provider.id) ? '隐藏' : '显示'" @click="toggleAIKey(provider.id)">
                  <svg v-if="isAIKeyVisible(provider.id)" class="h-4 w-4" viewBox="0 0 24 24">
                    <path d="M2 2l20 20M10.6 10.6A2 2 0 0012 14a2 2 0 001.4-.6M9.9 4.2A10.8 10.8 0 0112 4c5 0 9 5 10 8a13.4 13.4 0 01-3 4.7M6.2 6.2A13.7 13.7 0 002 12c1 3 5 8 10 8a10.9 10.9 0 004.1-.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                  </svg>
                  <svg v-else class="h-4 w-4" viewBox="0 0 24 24">
                    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>
                  </svg>
                </button>
              </div>
            </label>
            <label class="grid gap-2">
              <span :class="fieldLabelClass">文本模型</span>
              <template v-if="hasModelOptions(provider.id)">
                <div class="relative">
                  <select v-model="provider.textModel" :class="selectClass">
                    <option v-for="model in getModelOptions(provider)" :key="`text-${provider.id}-${model}`" :value="model">{{ model }}</option>
                  </select>
                  <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                    <svg class="h-4 w-4" viewBox="0 0 20 20" fill="none">
                      <path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                </div>
              </template>
              <input v-else v-model="provider.textModel" :class="inputClass" placeholder="Deepseek-V4-Flash" />
            </label>
            <label class="grid gap-2">
              <span :class="fieldLabelClass">图片模型</span>
              <template v-if="hasModelOptions(provider.id)">
                <div class="relative">
                  <select v-model="provider.imageModel" :class="selectClass">
                    <option value="">不设置</option>
                    <option v-for="model in getModelOptions(provider)" :key="`image-${provider.id}-${model}`" :value="model">{{ model }}</option>
                  </select>
                  <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                    <svg class="h-4 w-4" viewBox="0 0 20 20" fill="none">
                      <path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                </div>
              </template>
              <input v-else v-model="provider.imageModel" :class="inputClass" placeholder="可留空" />
            </label>
          </div>
        </div>
      </div>

      <div class="mt-5 flex flex-wrap gap-2">
        <label class="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
          <input v-model="aiSettings.useForTitle" type="checkbox" />
          自动总结标题
        </label>
        <label class="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
          <input v-model="aiSettings.useForDescription" type="checkbox" />
          自动填写简介
        </label>
        <label class="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
          <input v-model="aiSettings.useForCover" type="checkbox" />
          生成封面
        </label>
      </div>
    </section>

    <section :class="cardClass">
      <h2 :class="titleClass">远程数据服务</h2>
      <p class="mt-1 text-sm leading-6 text-slate-500">可选配置。用于把发布记录、任务状态、数据中心统计同步到你自己的服务器；不是 AI 模型接口，不配置也不影响本地发布。</p>
      <div class="mt-4 grid max-w-2xl gap-4">
        <label class="grid gap-2">
          <span :class="fieldLabelClass">服务地址</span>
          <input v-model="serverConfig.apiUrl" :class="inputClass" placeholder="https://your-platform.com/api" />
        </label>
        <label class="grid gap-2">
          <span class="text-sm font-bold text-slate-700">API Key</span>
          <div class="flex rounded-md border border-slate-300 bg-white focus-within:border-rose-500 focus-within:ring-2 focus-within:ring-rose-100">
            <input
              :value="showServerKey ? serverConfig.apiKey : maskSecret(serverConfig.apiKey)"
              class="min-w-0 flex-1 rounded-md px-3 py-2.5 text-sm outline-none"
              type="text"
              autocomplete="off"
              @input="updateServerApiKey($event)"
            />
            <button class="grid w-11 place-items-center text-slate-400 hover:text-slate-700" type="button" :title="showServerKey ? '隐藏' : '显示'" @click="toggleServerKey">
              <svg v-if="showServerKey" class="h-4 w-4" viewBox="0 0 24 24">
                <path d="M2 2l20 20M10.6 10.6A2 2 0 0012 14a2 2 0 001.4-.6M9.9 4.2A10.8 10.8 0 0112 4c5 0 9 5 10 8a13.4 13.4 0 01-3 4.7M6.2 6.2A13.7 13.7 0 002 12c1 3 5 8 10 8a10.9 10.9 0 004.1-.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
              </svg>
              <svg v-else class="h-4 w-4" viewBox="0 0 24 24">
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>
              </svg>
            </button>
          </div>
        </label>
      </div>
    </section>

    <section :class="cardClass">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 :class="titleClass">授权保护</h2>
          <p class="mt-1 text-sm leading-6 text-slate-500">{{ LOCAL_MODE ? '本地模式无需激活码，也不会联网校验授权。' : '输入激活码后会完成授权验证；未通过时不会启动分发。' }}</p>
        </div>
        <span
          class="rounded-md border px-3 py-1.5 text-xs font-bold"
          :class="licenseBadgeClass"
        >
          {{ licenseBadgeText }}
        </span>
      </div>

      <div
        v-if="LOCAL_MODE"
        class="mt-4 max-w-xl rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700"
      >
        本地模式已启用：跳过激活码、lease 验证、发布授权票据和远程策略更新，无需联网即可发布。
      </div>

      <div v-if="!LOCAL_MODE && licensingSettings.status === 'active'" class="mt-4 max-w-xl rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
        授权有效<span v-if="licenseValidUntilText">，有效期至 {{ licenseValidUntilText }}</span>
      </div>
      <div
        v-if="!LOCAL_MODE && licenseLeaseNotice"
        class="mt-3 max-w-xl rounded-md border px-3 py-2 text-sm font-semibold"
        :class="licenseLeaseNoticeClass"
      >
        {{ licenseLeaseNotice }}
      </div>

      <div v-if="!LOCAL_MODE" class="mt-4 grid max-w-xl gap-4">
        <label class="grid gap-2">
          <span :class="fieldLabelClass">激活码</span>
          <div class="flex rounded-md border border-slate-300 bg-white focus-within:border-rose-500 focus-within:ring-2 focus-within:ring-rose-100">
            <button
              v-if="!editingActivationCode && !showActivationCode"
              class="min-w-0 flex-1 rounded-md px-3 py-2.5 text-left text-sm outline-none"
              :class="licensingSettings.activationCode ? 'text-slate-900' : 'text-slate-400'"
              type="button"
              @click="beginEditActivationCode"
            >{{ licensingSettings.activationCode ? maskSecret(licensingSettings.activationCode) : '请输入激活码' }}</button>
            <input
              v-else
              ref="activationCodeInput"
              :value="licensingSettings.activationCode"
              type="text"
              class="min-w-0 flex-1 rounded-md px-3 py-2.5 text-sm outline-none"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="请输入激活码"
              @blur="finishEditActivationCode"
              @input="updateActivationCode"
            />
            <button
              class="grid w-11 place-items-center text-slate-400 hover:text-slate-700"
              type="button"
              :title="showActivationCode ? '隐藏' : '显示'"
              @mousedown.prevent
              @click="toggleActivationCodeVisibility"
            >
              <svg v-if="showActivationCode" class="h-4 w-4" viewBox="0 0 24 24">
                <path d="M2 2l20 20M10.6 10.6A2 2 0 0012 14a2 2 0 001.4-.6M9.9 4.2A10.8 10.8 0 0112 4c5 0 9 5 10 8a13.4 13.4 0 01-3 4.7M6.2 6.2A13.7 13.7 0 002 12c1 3 5 8 10 8a10.9 10.9 0 004.1-.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
              </svg>
              <svg v-else class="h-4 w-4" viewBox="0 0 24 24">
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>
              </svg>
            </button>
          </div>
        </label>
      </div>

      <div v-if="!LOCAL_MODE" class="mt-4 flex flex-wrap items-center gap-2">
        <button class="pf-btn-primary" type="button" @click="emit('verifyLicense')">激活并验证授权</button>
        <button
          class="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:border-red-300 hover:text-red-600"
          type="button"
          @click="emit('resetLicenseSettings')"
        >
          重置授权配置
        </button>
      </div>

      <div
        v-if="!LOCAL_MODE && licenseFeedbackText"
        class="mt-3 max-w-xl rounded-md border px-3 py-2 text-sm font-semibold"
        :class="licenseFeedbackClass"
      >
        {{ licenseFeedbackText }}
      </div>
    </section>

  </div>
</template>
