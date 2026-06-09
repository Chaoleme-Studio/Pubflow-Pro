import type { AIProviderConfig } from '../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChunk {
  type: 'delta' | 'done' | 'error';
  text?: string;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 30000;
const MAX_CONNECT_ATTEMPTS = 2;

function isRetryableConnectError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (!(error instanceof Error)) return true;
  return /network|fetch|timeout|failed to fetch|load failed/i.test(error.message);
}

function createLinkedSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  clearTimeout: () => void;
} {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    abort();
    return {
      signal: controller.signal,
      clearTimeout: () => undefined,
    };
  }
  signal?.addEventListener('abort', abort, { once: true });
  timeoutId = setTimeout(() => controller.abort(new DOMException('AI 请求超时', 'TimeoutError')), timeoutMs);
  controller.signal.addEventListener('abort', () => {
    if (timeoutId) clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abort);
  }, { once: true });

  return {
    signal: controller.signal,
    clearTimeout: () => {
      if (timeoutId) clearTimeout(timeoutId);
    },
  };
}

async function fetchStreamResponse(url: string, provider: AIProviderConfig, messages: ChatMessage[], signal?: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_CONNECT_ATTEMPTS; attempt++) {
    const linkedSignal = createLinkedSignal(signal, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.textModel,
          messages,
          stream: true,
        }),
        signal: linkedSignal.signal,
      });
      linkedSignal.clearTimeout();
      return response;
    } catch (error) {
      linkedSignal.clearTimeout();
      lastError = error;
      if (signal?.aborted || attempt >= MAX_CONNECT_ATTEMPTS - 1 || !isRetryableConnectError(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 请求失败');
}

/**
 * 向 OpenAI 兼容 API 发起流式聊天请求，返回异步迭代器。
 * 支持 DeepSeek、OpenAI、通义千问、SiliconFlow 等所有 OpenAI 兼容接口。
 */
export async function* streamChat(
  provider: AIProviderConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncIterable<StreamChunk> {
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const response = await fetchStreamResponse(url, provider, messages, signal);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`AI API 错误 ${response.status}: ${body.slice(0, 200)}`);
  }

  if (!response.body) {
    throw new Error('AI API 没有返回可读取的流式响应。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.split(/\r?\n/);
        let data = '';
        for (const line of lines) {
          if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (!data || data === '[DONE]') {
          if (data === '[DONE]') yield { type: 'done' };
          continue;
        }

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            yield { type: 'delta', text: delta.content };
          }
          const finish = json.choices?.[0]?.finish_reason;
          if (finish === 'stop' || finish === 'length') {
            yield { type: 'done' };
          }
        } catch {
          // 忽略无法解析的行
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
