import type { PlatformId, RuntimeMessage } from '../types';
import type { RuntimeResponse } from '../types';

export interface ElementPointOffset {
  /** 相对元素左上角的横向像素；省略时使用元素中心。 */
  x?: number;
  /** 相对元素左上角的纵向像素；省略时使用元素中心。 */
  y?: number;
}

/** 通过 CDP 发送可信点击事件，用于知乎等不响应 JS click 的 React 组件。 */
export async function cdpClickElement(el: HTMLElement): Promise<boolean> {
  const point = getTopFramePoint(el);
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
 * 请求后台点击平台最终发布按钮。
 * 后台负责可信点击、任务状态落库和继续下一个平台，页面点击后立即跳转也不会丢进度。
 */
export async function requestFinalPublishClick(
  el: HTMLElement,
  platformId: PlatformId,
  offset?: ElementPointOffset,
): Promise<void> {
  const point = getTopFramePoint(el, offset);
  const response = (await browser.runtime.sendMessage({
    type: 'FINAL_PUBLISH_CLICK',
    payload: {
      platformId,
      ...point,
    },
  } satisfies RuntimeMessage)) as RuntimeResponse | undefined;

  if (!response?.ok) {
    throw new Error(response?.error || '最终发布按钮点击失败');
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
  const point = getTopFramePoint(el);
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
  const start = getTopFramePoint(el);
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
export function getTopFramePoint(el: HTMLElement, offset?: ElementPointOffset) {
  const rect = el.getBoundingClientRect();
  let x = rect.left + (offset?.x ?? rect.width / 2);
  let y = rect.top + (offset?.y ?? rect.height / 2);
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
