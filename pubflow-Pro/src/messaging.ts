import type { RuntimeMessage, RuntimeResponse } from './types';

const FIRE_AND_FORGET_MESSAGE_TYPES = new Set<RuntimeMessage['type']>([
  'CONTINUE_FILL',
  'OPEN_PLATFORM',
  'SKIP_PLATFORM',
]);

/** 向后台脚本发送运行时消息，自动处理空响应和发送失败。 */
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

/** 判断返回值是否是有效的运行时响应结构。 */
function isRuntimeResponse<T>(value: RuntimeResponse<T> | undefined): value is RuntimeResponse<T> {
  return !!value && typeof value.ok === 'boolean';
}

/** 判断消息类型是否属于发出去不需要等响应的“即发即弃”类型。 */
function isFireAndForgetMessage(type: RuntimeMessage['type']) {
  return FIRE_AND_FORGET_MESSAGE_TYPES.has(type);
}
