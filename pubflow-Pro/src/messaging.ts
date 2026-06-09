import type { RuntimeMessage, RuntimeResponse } from './types';

const FIRE_AND_FORGET_MESSAGE_TYPES = new Set<RuntimeMessage['type']>([
  'CONTINUE_FILL',
  'OPEN_PLATFORM',
  'SKIP_PLATFORM',
]);

export async function sendRuntimeMessage<T = unknown>(
  message: RuntimeMessage,
): Promise<RuntimeResponse<T>> {
  try {
    const response = (await browser.runtime.sendMessage(message)) as RuntimeResponse<T> | undefined;
    if (isRuntimeResponse<T>(response)) {
      return response;
    }
    if (isFireAndForgetMessage(message.type)) {
      return {
        ok: true,
      };
    }
    return {
      ok: false,
      error: '后台未返回有效响应，请刷新扩展页面或重新加载插件后重试。',
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '消息发送失败',
    };
  }
}

function isRuntimeResponse<T>(value: RuntimeResponse<T> | undefined): value is RuntimeResponse<T> {
  return !!value && typeof value.ok === 'boolean';
}

function isFireAndForgetMessage(type: RuntimeMessage['type']) {
  return FIRE_AND_FORGET_MESSAGE_TYPES.has(type);
}
