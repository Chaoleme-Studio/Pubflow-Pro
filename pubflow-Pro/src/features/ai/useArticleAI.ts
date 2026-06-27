import { ref, type Ref } from 'vue';
import { streamChat, type ChatMessage } from '../../ai/streamChat';
import {
  POLISH_SYSTEM,
  FORMAT_SYSTEM,
  buildPolishUserPrompt,
  buildFormatUserPrompt,
} from '../../ai/prompts';
import { loadSettings } from '../../storage/settingsStorage';
import type { AIProviderConfig } from '../../types';

export type AIMode = 'polish' | 'format' | null;

/** 组合式函数：管理文章 AI 润色/排版的流式请求状态。 */
export function useArticleAI(params: {
  markdownText: Ref<string>;
  onApply: (newText: string) => void;
}) {
  const { markdownText, onApply } = params;

  const aiMode = ref<AIMode>(null);
  const aiStreaming = ref(false);
  const aiResult = ref('');
  const aiError = ref('');
  let abortController: AbortController | null = null;

  /** 从设置中读取当前可用的 AI 提供商配置。 */
  async function getActiveProvider(): Promise<AIProviderConfig | null> {
    const settings = await loadSettings();
    const aiSettings = settings.aiSettings;
    // providers 可能是对象（storage 序列化）或数组，统一转为数组
    const list: AIProviderConfig[] = Array.isArray(aiSettings.providers)
      ? aiSettings.providers
      : Object.values(aiSettings.providers || {});
    // 优先找 activeProviderId，否则找第一个有 apiKey 的
    const provider = list.find(
      (p) => p.id === aiSettings.activeProviderId && p.apiKey,
    ) || list.find((p) => p.apiKey);
    return provider || null;
  }

  /** 启动 AI 润色或排版流式请求。 */
  async function startAI(mode: 'polish' | 'format') {
    if (aiStreaming.value) return;

    aiMode.value = mode;
    aiResult.value = '';
    aiError.value = '';

    const provider = await getActiveProvider();
    if (!provider) {
      aiError.value = '未找到可用的 AI 提供商。请在设置 → AI 设置中添加提供商并填入 API Key。';
      return;
    }

    const currentText = markdownText.value.trim();
    if (!currentText) {
      aiError.value = '文章内容为空，无法处理。';
      return;
    }
    aiStreaming.value = true;
    aiResult.value = '';
    aiError.value = '';
    abortController = new AbortController();

    const systemPrompt = mode === 'polish' ? POLISH_SYSTEM : FORMAT_SYSTEM;
    const userPrompt = mode === 'polish'
      ? buildPolishUserPrompt(currentText)
      : buildFormatUserPrompt(currentText);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    try {
      for await (const chunk of streamChat(provider, messages, abortController.signal)) {
        if (chunk.type === 'delta' && chunk.text) {
          aiResult.value += chunk.text;
        } else if (chunk.type === 'done') {
          break;
        } else if (chunk.type === 'error') {
          aiError.value = chunk.error || 'AI 返回错误';
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户取消
      } else {
        aiError.value = err instanceof Error ? err.message : 'AI 请求失败';
      }
    } finally {
      aiStreaming.value = false;
      abortController = null;
    }
  }

  /** 取消当前 AI 请求。 */
  function cancelAI() {
    abortController?.abort();
    aiStreaming.value = false;
  }

  /** 将 AI 结果应用到编辑器内容中。 */
  function applyResult() {
    if (aiResult.value) {
      onApply(aiResult.value);
      closeDiff();
    }
  }

  /** 关闭 AI 结果对比/重置状态。 */
  function closeDiff() {
    aiMode.value = null;
    aiResult.value = '';
    aiError.value = '';
    cancelAI();
  }

  return {
    aiMode,
    aiStreaming,
    aiResult,
    aiError,
    startAI,
    cancelAI,
    applyResult,
    closeDiff,
  };
}
