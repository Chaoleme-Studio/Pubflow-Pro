import { AI_PROVIDER_PRESETS } from '../features/settings/aiPresets';
import { PLATFORM_ORDER } from '../platforms';
import { STORAGE_KEYS } from '../types';
import type { AIProviderSettings, GlobalSettings, PlatformId, PlatformSettings, ServerConfig } from '../types';
import { loadSecret, pruneSecrets, saveSecret } from './secretStorage';
import { readDataFile, mergeDataFile } from './workspaceStorage';

// 平台默认开关集中放在这里，避免入口页里散落默认值。
export const defaultPlatformSettings = PLATFORM_ORDER.reduce(
  (settings, platformId) => {
    settings[platformId] = {
      enabled: true,
      autoSubmit: false,
      defaultTopics: [],
    };
    return settings;
  },
  {} as Record<PlatformId, PlatformSettings>,
);

export const defaultGlobalSettings: GlobalSettings = {
  fillSpeed: 'normal',
  autoSubmit: false,
  distributionInterval: 3,
};

export const defaultServerConfig: ServerConfig = {
  apiUrl: '',
  apiKey: '',
  pollingInterval: 30,
  connected: false,
};

export const defaultAISettings: AIProviderSettings = {
  enabled: false,
  activeProviderId: 'deepseek',
  providers: [
    {
      id: 'deepseek',
      builtinId: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      textModel: 'Deepseek-V4-Flash',
      imageModel: '',
      enabled: true,
    },
  ],
  useForTitle: true,
  useForDescription: true,
  useForCover: true,
};

// 兼容早期默认 OpenAI 配置，避免升级后把旧用户卡死在旧 preset。
function isLegacyOpenAIDefaultProvider(provider: Partial<AIProviderSettings['providers'][number]> | undefined) {
  if (!provider) return false;
  return provider.builtinId === 'openai'
    && (provider.name || '') === 'OpenAI'
    && (provider.baseUrl || '') === 'https://api.openai.com/v1'
    && (provider.apiKey || '') === ''
    && (provider.textModel || '') === 'gpt-4o-mini'
    && (provider.imageModel || '') === 'gpt-image-1';
}

function buildDefaultDeepSeekSettings(stored: Partial<AIProviderSettings>) {
  return {
    ...defaultAISettings,
    enabled: stored.enabled ?? defaultAISettings.enabled,
    useForTitle: stored.useForTitle ?? defaultAISettings.useForTitle,
    useForDescription: stored.useForDescription ?? defaultAISettings.useForDescription,
    useForCover: stored.useForCover ?? defaultAISettings.useForCover,
  } satisfies AIProviderSettings;
}

// 统一把旧结构、单 provider 结构和当前 providers 数组结构归一成一套数据。
function normalizeAISettings(settings: unknown): AIProviderSettings {
  const stored = (settings || {}) as Partial<AIProviderSettings> & {
    builtinId?: AIProviderSettings['providers'][number]['builtinId'];
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    textModel?: string;
    imageModel?: string;
  };

  if (
    Array.isArray(stored.providers)
    && stored.providers.length === 1
    && isLegacyOpenAIDefaultProvider(stored.providers[0])
    && (!stored.activeProviderId || stored.activeProviderId === 'openai')
  ) {
    return buildDefaultDeepSeekSettings(stored);
  }

  if (
    !Array.isArray(stored.providers)
    && isLegacyOpenAIDefaultProvider({
      builtinId: stored.builtinId,
      name: stored.name,
      baseUrl: stored.baseUrl,
      apiKey: stored.apiKey,
      textModel: stored.textModel,
      imageModel: stored.imageModel,
    })
  ) {
    return buildDefaultDeepSeekSettings(stored);
  }

  const fallbackBuiltinId = stored.builtinId || 'deepseek';
  const fallbackPreset = AI_PROVIDER_PRESETS[fallbackBuiltinId];

  const providers = Array.isArray(stored.providers) && stored.providers.length
    ? stored.providers
    : [
        {
          id: fallbackBuiltinId,
          builtinId: fallbackBuiltinId,
          name: stored.name || fallbackPreset.name,
          baseUrl: stored.baseUrl || fallbackPreset.baseUrl,
          apiKey: stored.apiKey || '',
          textModel: stored.textModel || fallbackPreset.textModel,
          imageModel: stored.imageModel || fallbackPreset.imageModel,
          enabled: true,
        },
      ];

  const normalizedProviders = providers.map((provider) => ({
    ...provider,
    textModel:
      provider.builtinId === 'deepseek' && provider.textModel === 'deepseek-chat'
        ? AI_PROVIDER_PRESETS.deepseek.textModel
        : provider.textModel,
  }));

  const activeProviderId = stored.activeProviderId || normalizedProviders[0]?.id || defaultAISettings.activeProviderId;

  return {
    ...defaultAISettings,
    ...stored,
    activeProviderId,
    providers: normalizedProviders,
  };
}

function mergeServerSecretFromLocal(source: ServerConfig, local: unknown): ServerConfig {
  const localServer = (local || {}) as Partial<ServerConfig>;
  return {
    ...source,
    apiKey: source.apiKey || localServer.apiKey || '',
  };
}

function withoutServerSecret(config: ServerConfig): ServerConfig {
  return {
    ...config,
    apiKey: '',
  };
}

function withoutAISecrets(settings: AIProviderSettings): AIProviderSettings {
  return {
    ...settings,
    providers: settings.providers.map((provider) => ({
      ...provider,
      apiKey: '',
    })),
  };
}

function serverSecretId() {
  return 'server:api-key';
}

function aiProviderSecretId(providerId: string) {
  return `ai-provider:${providerId}:api-key`;
}

function aiProviderSecretPrefix() {
  return 'ai-provider:';
}

async function resolveServerSecret(source: ServerConfig, local: unknown): Promise<ServerConfig> {
  const legacyMerged = mergeServerSecretFromLocal(source, local);
  const encrypted = await loadSecret(serverSecretId()).catch(() => '');
  return {
    ...legacyMerged,
    apiKey: encrypted || legacyMerged.apiKey || '',
  };
}

async function resolveAISecrets(source: AIProviderSettings, local: unknown): Promise<AIProviderSettings> {
  const localAI = normalizeAISettings(local);
  const localProviderById = new Map(localAI.providers.map((provider) => [provider.id, provider]));
  const localProviderByBuiltin = new Map(localAI.providers.map((provider) => [provider.builtinId, provider]));
  const localProviderByEndpoint = new Map(
    localAI.providers.map((provider) => [`${provider.builtinId}:${provider.baseUrl}:${provider.name}`, provider]),
  );
  const providers = await Promise.all(source.providers.map(async (provider) => {
    const encrypted = await loadSecret(aiProviderSecretId(provider.id)).catch(() => '');
    const localByEndpoint = localProviderByEndpoint.get(`${provider.builtinId}:${provider.baseUrl}:${provider.name}`);
    const localByBuiltin = localProviderByBuiltin.get(provider.builtinId);
    const localByEndpointEncrypted = localByEndpoint
      ? await loadSecret(aiProviderSecretId(localByEndpoint.id)).catch(() => '')
      : '';
    const localByBuiltinEncrypted = localByBuiltin
      ? await loadSecret(aiProviderSecretId(localByBuiltin.id)).catch(() => '')
      : '';
    return {
      ...provider,
      apiKey:
        encrypted ||
        localByEndpointEncrypted ||
        localByBuiltinEncrypted ||
        provider.apiKey ||
        localProviderById.get(provider.id)?.apiKey ||
        localByEndpoint?.apiKey ||
        localByBuiltin?.apiKey ||
        '',
    };
  }));

  return {
    ...source,
    providers,
  };
}

function hasServerSecret(config: unknown): boolean {
  return !!(config as Partial<ServerConfig> | undefined)?.apiKey;
}

function hasAISecrets(settings: unknown): boolean {
  return normalizeAISettings(settings).providers.some((provider) => !!provider.apiKey);
}

async function migratePlaintextSecretsIfNeeded(settings: {
  platformSettings: Record<PlatformId, PlatformSettings>;
  globalSettings: GlobalSettings;
  serverConfig: ServerConfig;
  aiSettings: AIProviderSettings;
}, sources: Array<{
  serverConfig?: unknown;
  aiSettings?: unknown;
}>) {
  const hasPlaintextSecret = sources.some((source) =>
    hasServerSecret(source.serverConfig) || hasAISecrets(source.aiSettings),
  );
  if (!hasPlaintextSecret) {
    return;
  }
  await saveSettings(settings);
}

export async function loadSettings() {
  // 优先从工作区读
  const dataFile = await readDataFile();
  const src = dataFile?.settings;

  const stored = await browser.storage.local.get([
    STORAGE_KEYS.platformSettings,
    STORAGE_KEYS.globalSettings,
    STORAGE_KEYS.serverConfig,
    STORAGE_KEYS.aiSettings,
    STORAGE_KEYS.workspaceSettings,
  ]);

  const serverConfig = {
    ...defaultServerConfig,
    ...(src?.serverConfig || stored[STORAGE_KEYS.serverConfig] || {}),
  } as ServerConfig;
  const aiSettings = normalizeAISettings(src?.aiSettings || stored[STORAGE_KEYS.aiSettings]);
  const restoredServerConfig = await resolveServerSecret(serverConfig, stored[STORAGE_KEYS.serverConfig]);
  const restoredAISettings = await resolveAISecrets(aiSettings, stored[STORAGE_KEYS.aiSettings]);

  const resolvedSettings = {
    platformSettings: {
      ...defaultPlatformSettings,
      ...(src?.platformSettings || stored[STORAGE_KEYS.platformSettings] || {}),
    } as Record<PlatformId, PlatformSettings>,
    globalSettings: {
      ...defaultGlobalSettings,
      ...(src?.globalSettings || stored[STORAGE_KEYS.globalSettings] || {}),
    } as GlobalSettings,
    serverConfig: restoredServerConfig,
    aiSettings: restoredAISettings,
  };
  await migratePlaintextSecretsIfNeeded(resolvedSettings, [
    {
      serverConfig: stored[STORAGE_KEYS.serverConfig],
      aiSettings: stored[STORAGE_KEYS.aiSettings],
    },
    {
      serverConfig: src?.serverConfig,
      aiSettings: src?.aiSettings,
    },
  ]);
  return resolvedSettings;
}

export async function saveSettings(settings: {
  platformSettings: Record<PlatformId, PlatformSettings>;
  globalSettings: GlobalSettings;
  serverConfig: ServerConfig;
  aiSettings: AIProviderSettings;
}) {
  await saveSecret(serverSecretId(), settings.serverConfig.apiKey);
  const providerSecretIds = new Set(settings.aiSettings.providers.map((provider) => aiProviderSecretId(provider.id)));
  for (const provider of settings.aiSettings.providers) {
    await saveSecret(aiProviderSecretId(provider.id), provider.apiKey);
  }
  await pruneSecrets(aiProviderSecretPrefix(), providerSecretIds);

  const serverConfig = withoutServerSecret(settings.serverConfig);
  const aiSettings = withoutAISecrets(settings.aiSettings);

  // 工作区根配置文件优先，浏览器本地只做兜底和快速恢复。
  await mergeDataFile({
    settings: {
      platformSettings: settings.platformSettings,
      globalSettings: settings.globalSettings as unknown as Record<string, unknown>,
      serverConfig: serverConfig as unknown as Record<string, unknown>,
      aiSettings: aiSettings as unknown as Record<string, unknown>,
    },
  });

  // 同步写 chrome.storage.local，避免未授权工作区时丢配置；密钥只写入加密 secret store。
  await browser.storage.local.set({
    [STORAGE_KEYS.platformSettings]: settings.platformSettings,
    [STORAGE_KEYS.globalSettings]: settings.globalSettings,
    [STORAGE_KEYS.serverConfig]: serverConfig,
    [STORAGE_KEYS.aiSettings]: aiSettings,
  });
}
