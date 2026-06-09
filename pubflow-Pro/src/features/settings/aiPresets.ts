import type { AIProviderConfig } from '../../types';

export const AI_PROVIDER_PRESETS: Record<
  AIProviderConfig['builtinId'],
  Omit<AIProviderConfig, 'id' | 'apiKey' | 'enabled'>
> = {
  openai: {
    builtinId: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    textModel: 'gpt-4o-mini',
    imageModel: 'gpt-image-1',
  },
  deepseek: {
    builtinId: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    textModel: 'Deepseek-V4-Flash',
    imageModel: '',
  },
  qwen: {
    builtinId: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    textModel: 'qwen-plus',
    imageModel: 'wanx2.1-t2i-turbo',
  },
  siliconflow: {
    builtinId: 'siliconflow',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    textModel: 'Qwen/Qwen2.5-72B-Instruct',
    imageModel: '',
  },
  xiaomi: {
    builtinId: 'xiaomi',
    name: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    textModel: 'mimo-v2-pro',
    imageModel: '',
  },
  custom: {
    builtinId: 'custom',
    name: 'OpenAI Compatible',
    baseUrl: '',
    textModel: '',
    imageModel: '',
  },
};
