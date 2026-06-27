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
