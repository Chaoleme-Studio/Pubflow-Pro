import { AI_PROVIDER_PRESETS } from '../features/settings/aiPresets';
import { DEFAULT_TOPIC_INTERVAL_MS } from '../domain/fillSettings';
import { PLATFORM_ORDER } from '../platforms';
import { STORAGE_KEYS } from '../types';
import type { AIProviderSettings, GlobalSettings, LicensingSettings, PlatformId, PlatformSettings, ServerConfig } from '../types';
import { loadSecret, pruneSecrets, saveSecret } from './secretStorage';
import { readDataFile, mergeDataFile } from './workspaceStorage';

// 平台默认开关集中放在这里，避免入口页里散落默认值。
export const defaultPlatformSettings = PLATFORM_ORDER.reduce(
  (settings, platformId) => {
    settings[platformId] = {
      enabled: platformId !== 'x' && platformId !== 'youtube',
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
  topicIntervalMs: DEFAULT_TOPIC_INTERVAL_MS,
};

export const defaultServerConfig: ServerConfig = {
  apiUrl: '',
  apiKey: '',
  pollingInterval: 30,
  connected: false,
};

export const defaultLicensingSettings: LicensingSettings = {
  apiBaseUrl: __PUBFLOW_DEFAULT_LICENSE_API_BASE_URL__,
  activationCode: '',
  clientInstallId: '',
  machineHash: '',
  leaseToken: '',
  features: [],
  status: 'unconfigured',
};

const LOCAL_LICENSE_API_BASE_URLS = new Set([
  'http://124.222.232.50:30009',
  'http://127.0.0.1:3001',
  'http://localhost:3001',
  'http://127.0.0.1:5189',
  'http://localhost:5189',
]);

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

/** 兼容早期默认 OpenAI 配置，避免升级后旧用户被卡在旧 preset。 */
function isLegacyOpenAIDefaultProvider(provider: Partial<AIProviderSettings['providers'][number]> | undefined) {
  if (!provider) return false;
  return provider.builtinId === 'openai'
    && (provider.name || '') === 'OpenAI'
    && (provider.baseUrl || '') === 'https://api.openai.com/v1'
    && (provider.apiKey || '') === ''
    && (provider.textModel || '') === 'gpt-4o-mini'
    && (provider.imageModel || '') === 'gpt-image-1';
}

/** 构建默认 DeepSeek 设置，保留用户已修改的开关项。 */
function buildDefaultDeepSeekSettings(stored: Partial<AIProviderSettings>) {
  return {
    ...defaultAISettings,
    enabled: stored.enabled ?? defaultAISettings.enabled,
    useForTitle: stored.useForTitle ?? defaultAISettings.useForTitle,
    useForDescription: stored.useForDescription ?? defaultAISettings.useForDescription,
    useForCover: stored.useForCover ?? defaultAISettings.useForCover,
  } satisfies AIProviderSettings;
}

/** 统一把旧结构、单 provider 结构和当前 providers 数组结构归一成标准 AI 设置。 */
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

/** 从本地设置中合并服务端 API Key（兼容旧版明文存储）。 */
function mergeServerSecretFromLocal(source: ServerConfig, local: unknown): ServerConfig {
  const localServer = (local || {}) as Partial<ServerConfig>;
  return {
    ...source,
    apiKey: source.apiKey || localServer.apiKey || '',
  };
}

/** 移除服务端配置中的 API Key，避免明文写入存储。 */
function withoutServerSecret(config: ServerConfig): ServerConfig {
  return {
    ...config,
    apiKey: '',
  };
}

/** 移除所有 AI 提供商的 API Key，避免明文写入存储。 */
function withoutAISecrets(settings: AIProviderSettings): AIProviderSettings {
  return {
    ...settings,
    providers: settings.providers.map((provider) => ({
      ...provider,
      apiKey: '',
    })),
  };
}

/** 返回服务端 API Key 在加密存储中的 ID。 */
function serverSecretId() {
  return 'server:api-key';
}

/** 返回指定 AI 提供商 API Key 在加密存储中的 ID。 */
function aiProviderSecretId(providerId: string) {
  return `ai-provider:${providerId}:api-key`;
}

/** 返回 AI 提供商密钥在加密存储中的前缀。 */
function aiProviderSecretPrefix() {
  return 'ai-provider:';
}

/** 返回授权字段在加密存储中的 ID。 */
function licensingSecretId(name: 'activation-code' | 'client-install-id' | 'machine-hash' | 'lease-token') {
  return `licensing:${name}`;
}

/** 从加密存储读取服务端 API Key 并合并到配置中。 */
async function resolveServerSecret(source: ServerConfig, local: unknown): Promise<ServerConfig> {
  const legacyMerged = mergeServerSecretFromLocal(source, local);
  const encrypted = await loadSecret(serverSecretId()).catch(() => '');
  return {
    ...legacyMerged,
    apiKey: encrypted || legacyMerged.apiKey || '',
  };
}

/** 移除授权配置中的敏感字段，避免明文写入 storage 和工作区文件。 */
function withoutLicensingSecrets(settings: LicensingSettings): LicensingSettings {
  return {
    ...settings,
    activationCode: '',
    clientInstallId: '',
    machineHash: '',
    leaseToken: '',
  };
}

/** 从加密存储恢复授权敏感字段，并兼容旧版 machineHash 字段。 */
async function resolveLicensingSecrets(source: LicensingSettings, local: unknown): Promise<LicensingSettings> {
  const localLicensing = (local || {}) as Partial<LicensingSettings>;
  const activationCode = await loadSecret(licensingSecretId('activation-code')).catch(() => '');
  const clientInstallId = await loadSecret(licensingSecretId('client-install-id')).catch(() => '');
  const legacyMachineHash = await loadSecret(licensingSecretId('machine-hash')).catch(() => '');
  const leaseToken = await loadSecret(licensingSecretId('lease-token')).catch(() => '');
  const resolvedClientInstallId =
    clientInstallId ||
    source.clientInstallId ||
    localLicensing.clientInstallId ||
    legacyMachineHash ||
    source.machineHash ||
    localLicensing.machineHash ||
    '';

  return {
    ...source,
    apiBaseUrl: resolveLicensingApiBaseUrl(source.apiBaseUrl),
    activationCode: activationCode || source.activationCode || localLicensing.activationCode || '',
    clientInstallId: resolvedClientInstallId,
    machineHash: '',
    leaseToken: leaseToken || source.leaseToken || localLicensing.leaseToken || '',
  };
}

function resolveLicensingApiBaseUrl(apiBaseUrl: string): string {
  const defaultApiBaseUrl = normalizeApiBaseUrl(defaultLicensingSettings.apiBaseUrl);
  const storedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  if (shouldUseDefaultLicensingApiBaseUrl(storedApiBaseUrl, defaultApiBaseUrl)) {
    return defaultApiBaseUrl;
  }
  return storedApiBaseUrl || defaultApiBaseUrl;
}

function shouldUseDefaultLicensingApiBaseUrl(storedApiBaseUrl: string, defaultApiBaseUrl: string): boolean {
  return Boolean(
    defaultApiBaseUrl &&
    !LOCAL_LICENSE_API_BASE_URLS.has(defaultApiBaseUrl) &&
    LOCAL_LICENSE_API_BASE_URLS.has(storedApiBaseUrl),
  );
}

function hasLegacyLicensingApiBaseUrl(settings: unknown): boolean {
  const licensing = (settings || {}) as Partial<LicensingSettings>;
  return shouldUseDefaultLicensingApiBaseUrl(
    normalizeApiBaseUrl(licensing.apiBaseUrl),
    normalizeApiBaseUrl(defaultLicensingSettings.apiBaseUrl),
  );
}

function normalizeApiBaseUrl(value?: string): string {
  return (value || '').trim().replace(/\/+$/, '');
}

/** 从加密存储读取各 AI 提供商的 API Key 并合并到配置中。 */
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

/** 判断配置对象中是否包含服务端 API Key。 */
function hasServerSecret(config: unknown): boolean {
  return !!(config as Partial<ServerConfig> | undefined)?.apiKey;
}

/** 判断 AI 设置中是否任一提供商包含 API Key。 */
function hasAISecrets(settings: unknown): boolean {
  return normalizeAISettings(settings).providers.some((provider) => !!provider.apiKey);
}

/** 判断授权配置中是否存在需要迁移的明文敏感字段。 */
function hasLicensingSecrets(settings: unknown): boolean {
  const licensing = (settings || {}) as Partial<LicensingSettings>;
  return Boolean(licensing.activationCode || licensing.clientInstallId || licensing.machineHash || licensing.leaseToken);
}

/** 如果来源中存在明文密钥，则触发一次迁移保存到加密存储。 */
async function migratePlaintextSecretsIfNeeded(settings: {
  platformSettings: Record<PlatformId, PlatformSettings>;
  globalSettings: GlobalSettings;
  serverConfig: ServerConfig;
  licensingSettings: LicensingSettings;
  aiSettings: AIProviderSettings;
}, sources: Array<{
  serverConfig?: unknown;
  licensingSettings?: unknown;
  aiSettings?: unknown;
}>) {
  const needsMigration = sources.some((source) =>
    hasServerSecret(source.serverConfig) ||
    hasLicensingSecrets(source.licensingSettings) ||
    hasAISecrets(source.aiSettings) ||
    hasLegacyLicensingApiBaseUrl(source.licensingSettings),
  );
  if (!needsMigration) {
    return;
  }
  await saveSettings(settings);
}

/** 加载完整设置，优先从工作区读取并恢复加密存储中的密钥。 */
export async function loadSettings() {
  // 优先从工作区读
  const dataFile = await readDataFile();
  const src = dataFile?.settings;

  const stored = await browser.storage.local.get([
    STORAGE_KEYS.platformSettings,
    STORAGE_KEYS.globalSettings,
    STORAGE_KEYS.serverConfig,
    STORAGE_KEYS.licensingSettings,
    STORAGE_KEYS.aiSettings,
    STORAGE_KEYS.workspaceSettings,
  ]);

  const serverConfig = {
    ...defaultServerConfig,
    ...(src?.serverConfig || stored[STORAGE_KEYS.serverConfig] || {}),
  } as ServerConfig;
  const aiSettings = normalizeAISettings(src?.aiSettings || stored[STORAGE_KEYS.aiSettings]);
  const licensingSettings = {
    ...defaultLicensingSettings,
    ...(src?.licensingSettings || stored[STORAGE_KEYS.licensingSettings] || {}),
  } as LicensingSettings;
  const restoredServerConfig = await resolveServerSecret(serverConfig, stored[STORAGE_KEYS.serverConfig]);
  const restoredLicensingSettings = await resolveLicensingSecrets(
    licensingSettings,
    stored[STORAGE_KEYS.licensingSettings],
  );
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
    licensingSettings: restoredLicensingSettings,
    aiSettings: restoredAISettings,
  };
  await migratePlaintextSecretsIfNeeded(resolvedSettings, [
    {
      serverConfig: stored[STORAGE_KEYS.serverConfig],
      licensingSettings: stored[STORAGE_KEYS.licensingSettings],
      aiSettings: stored[STORAGE_KEYS.aiSettings],
    },
    {
      serverConfig: src?.serverConfig,
      licensingSettings: src?.licensingSettings,
      aiSettings: src?.aiSettings,
    },
  ]);
  return resolvedSettings;
}

/** 保存完整设置，将密钥写入加密存储，配置本体写入工作区和 chrome.storage.local。 */
export async function saveSettings(settings: {
  platformSettings: Record<PlatformId, PlatformSettings>;
  globalSettings: GlobalSettings;
  serverConfig: ServerConfig;
  licensingSettings: LicensingSettings;
  aiSettings: AIProviderSettings;
}) {
  await saveSecret(serverSecretId(), settings.serverConfig.apiKey);
  await saveSecret(licensingSecretId('activation-code'), settings.licensingSettings.activationCode);
  await saveSecret(licensingSecretId('client-install-id'), settings.licensingSettings.clientInstallId);
  await saveSecret(licensingSecretId('machine-hash'), '');
  await saveSecret(licensingSecretId('lease-token'), settings.licensingSettings.leaseToken);
  const providerSecretIds = new Set(settings.aiSettings.providers.map((provider) => aiProviderSecretId(provider.id)));
  for (const provider of settings.aiSettings.providers) {
    await saveSecret(aiProviderSecretId(provider.id), provider.apiKey);
  }
  await pruneSecrets(aiProviderSecretPrefix(), providerSecretIds);

  const serverConfig = withoutServerSecret(settings.serverConfig);
  const licensingSettings = withoutLicensingSecrets(settings.licensingSettings);
  const aiSettings = withoutAISecrets(settings.aiSettings);

  // 同步写 chrome.storage.local，避免未授权工作区时丢配置；密钥只写入加密 secret store。
  await browser.storage.local.set({
    [STORAGE_KEYS.platformSettings]: settings.platformSettings,
    [STORAGE_KEYS.globalSettings]: settings.globalSettings,
    [STORAGE_KEYS.serverConfig]: serverConfig,
    [STORAGE_KEYS.licensingSettings]: licensingSettings,
    [STORAGE_KEYS.aiSettings]: aiSettings,
  });

  // 工作区文件只是跨项目同步副本；浏览器不允许写入目录时不能阻断授权凭证保存。
  await mergeDataFile({
    settings: {
      platformSettings: settings.platformSettings,
      globalSettings: settings.globalSettings as unknown as Record<string, unknown>,
      serverConfig: serverConfig as unknown as Record<string, unknown>,
      licensingSettings: licensingSettings as unknown as Record<string, unknown>,
      aiSettings: aiSettings as unknown as Record<string, unknown>,
    },
  }).catch((error) => {
    console.warn('[PubFlow] 工作区设置同步失败，已保留浏览器本地设置。', error);
  });
}
