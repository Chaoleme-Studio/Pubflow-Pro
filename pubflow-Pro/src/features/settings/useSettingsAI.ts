import { computed, ref } from 'vue';
import { AI_PROVIDER_PRESETS } from './aiPresets';
import type { AIProviderConfig, AIProviderSettings } from '../../types';

/** 组合式函数：管理 AI 设置页的提供商增删、预设应用和模型拉取。 */
export function useSettingsAI(aiSettings: AIProviderSettings) {
  const aiModelOptions = ref<string[]>([]);
  const aiModelsLoading = ref(false);

  // 设置页所有操作都围绕“当前生效供应商”展开。
  const activeAIProvider = computed(() => {
    const provider = aiSettings.providers.find((item) => item.id === aiSettings.activeProviderId);
    return provider || aiSettings.providers[0] || null;
  });

  /** 根据内置 preset 创建一个新的 AI 提供商配置。 */
  function createProviderPreset(builtinId: AIProviderConfig['builtinId']): AIProviderConfig {
    return {
      id: `${builtinId}-${crypto.randomUUID().slice(0, 8)}`,
      apiKey: '',
      enabled: true,
      ...AI_PROVIDER_PRESETS[builtinId],
    };
  }

  /** 添加一个内置类型的 AI 提供商并设为当前活跃。 */
  function addAIProvider(builtinId: AIProviderConfig['builtinId']) {
    const provider = createProviderPreset(builtinId);
    aiSettings.providers.push(provider);
    aiSettings.activeProviderId = provider.id;
  }

  /** 移除指定 AI 提供商，返回错误信息或 null。 */
  function removeAIProvider(providerId: string): string | null {
    if (aiSettings.providers.length <= 1) {
      return '至少保留一个 AI 供应商。';
    }
    aiSettings.providers = aiSettings.providers.filter((provider) => provider.id !== providerId);
    if (aiSettings.activeProviderId === providerId) {
      aiSettings.activeProviderId = aiSettings.providers[0]?.id || '';
    }
    return null;
  }

  /** 将某个提供商重置为其内置 preset 的默认名称、地址和模型。 */
  function applyProviderPreset(provider: AIProviderConfig) {
    const preset = createProviderPreset(provider.builtinId);
    Object.assign(provider, {
      name: preset.name,
      baseUrl: preset.baseUrl,
      textModel: preset.textModel,
      imageModel: preset.imageModel,
    });
  }

  /** 规范化用户输入的 Base URL（如 DeepSeek 自动补 /v1）。 */
  function resolveBaseUrl(provider: AIProviderConfig) {
    const baseUrl = provider.baseUrl.trim().replace(/\/+$/, '');
    if (!baseUrl) return '';
    if (provider.builtinId === 'deepseek' && !/\/v1$/i.test(baseUrl)) {
      return `${baseUrl}/v1`;
    }
    return baseUrl;
  }

  /** 从当前活跃提供商拉取可用模型列表。 */
  async function fetchAIModels(): Promise<string> {
    // 当前仅拉取 OpenAI Compatible 的 /models，用来填充模型下拉框。
    if (aiModelsLoading.value) return '';
    aiModelsLoading.value = true;
    try {
      const provider = activeAIProvider.value;
      if (!provider) throw new Error('请先添加 AI 供应商');
      const baseUrl = resolveBaseUrl(provider);
      if (!baseUrl) throw new Error('请先填写 Base URL');
      if (baseUrl !== provider.baseUrl) {
        provider.baseUrl = baseUrl;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (provider.apiKey.trim()) {
        headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
      }

      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers,
      });
      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`获取模型失败：HTTP ${response.status} ${bodyText.slice(0, 160)}`);
      }

      const data = JSON.parse(bodyText || '{}') as { data?: Array<{ id?: string; name?: string }> };
      const models = (data.data || [])
        .map((model) => model.id || model.name || '')
        .filter((model): model is string => !!model)
        .slice(0, 200);

      if (!models.length) throw new Error('接口没有返回可用模型');
      aiModelOptions.value = models;
      if (!provider.textModel) provider.textModel = models[0];
      return `已获取 ${models.length} 个模型。`;
    } finally {
      aiModelsLoading.value = false;
    }
  }

  return {
    aiModelOptions,
    aiModelsLoading,
    activeAIProvider,
    addAIProvider,
    removeAIProvider,
    applyProviderPreset,
    fetchAIModels,
  };
}
