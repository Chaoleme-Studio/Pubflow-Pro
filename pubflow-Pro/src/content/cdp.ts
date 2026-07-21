import type { RuntimeMessage } from '../types';
import type { RuntimeResponse } from '../types';

/** 通过 CDP 发送可信点击事件，用于知乎等不响应 JS click 的 React 组件。 */
export async function cdpClickElement(el: HTMLElement): Promise<boolean> {
  const point = getTopFrameCenterPoint(el);
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'CDP_CLICK',
      payload: point,
    } satisfies RuntimeMessage)) as RuntimeResponse | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

/**
 * 用浏览器级可信输入完成描述和话题填写。
 * 后台会先真实点击激活编辑器，再按配置节奏逐个确认话题。
 */
export async function cdpFillDescriptionWithTopics(
  el: HTMLElement,
  description: string,
  topics: string[],
  topicIntervalMs: number,
): Promise<void> {
  const point = getTopFrameCenterPoint(el);
  const response = (await browser.runtime.sendMessage({
    type: 'CDP_FILL_DESCRIPTION_TOPICS',
    payload: {
      ...point,
      description,
      topics,
      topicIntervalMs,
    },
  } satisfies RuntimeMessage)) as RuntimeResponse | undefined;

  if (!response?.ok) {
    throw new Error(response?.error || '浏览器级描述和话题输入失败');
  }
}

/** 通过 CDP 拖动元素中心，用于 ReactCrop 等需要可信指针事件的控件。 */
export async function cdpDragElement(
  el: HTMLElement,
  deltaX: number,
  deltaY: number,
): Promise<boolean> {
  const start = getTopFrameCenterPoint(el);
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'CDP_DRAG',
      payload: {
        startX: start.x,
        startY: start.y,
        endX: start.x + deltaX,
        endY: start.y + deltaY,
      },
    } satisfies RuntimeMessage)) as RuntimeResponse | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

/** 将 iframe 内元素坐标换算成顶层 tab 坐标，供 CDP Input.dispatchMouseEvent 使用。 */
function getTopFrameCenterPoint(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  let x = rect.left + rect.width / 2;
  let y = rect.top + rect.height / 2;
  let currentWindow: Window | null = el.ownerDocument.defaultView;

  while (currentWindow && currentWindow !== currentWindow.parent) {
    const frameElement = currentWindow.frameElement;
    if (!(frameElement instanceof HTMLElement)) break;
    const frameRect = frameElement.getBoundingClientRect();
    x += frameRect.left;
    y += frameRect.top;
    currentWindow = currentWindow.parent;
  }

  return { x, y };
}
