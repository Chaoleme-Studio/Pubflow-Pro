import { sleep } from '../utils/time';

const DOM_POLL_INTERVAL_MS = 250;

// 用于跨 iframe 填充：当编辑器在同源 iframe 中时，临时切换查询目标文档
let _overrideDoc: Document | null = null;

/** 临时切换 DOM 查询文档，用于 B站文章 iframe 这类同源子文档编辑器。 */
export function setOverrideDocument(doc: Document | null) {
  _overrideDoc = doc;
}

/** 获取当前查询根节点；默认主文档，必要时切到同源 iframe 文档。 */
function getRoot(): Document | ShadowRoot {
  return _overrideDoc || document;
}

/** 获取当前活跃的文档（用于 execCommand 等需要在正确文档上下文执行的操作） */
export function getActiveDocument(element?: Element): Document {
  return element?.ownerDocument || _overrideDoc || document;
}

/** 按多个选择器查找第一个可见元素，适合平台选择器有多个候选兜底的场景。 */
export function findVisibleElement(selectors: string[]): HTMLElement | undefined {
  for (const selector of selectors) {
    let element: Element | undefined;
    try {
      element = findDeepElement(selector, (candidate) => isVisible(candidate));
    } catch {
      continue;
    }
    if (element instanceof HTMLElement) {
      return element;
    }
  }
  return undefined;
}

/** 查找可编辑字段；如果命中的是外层容器，会继续解析里面真正的 input/textarea/contenteditable。 */
export function findEditableElement(selectors: string[]): HTMLElement | undefined {
  const direct = findVisibleElement(selectors);
  if (direct) return resolveEditableElement(direct);

  for (const selector of selectors) {
    let element: Element | undefined;
    try {
      element = querySelectorDeep(selector);
    } catch {
      continue;
    }
    if (element instanceof HTMLElement) {
      return resolveEditableElement(element);
    }
  }

  return undefined;
}

/** 将字段容器解析为真实可输入元素，解决平台 selector 只能稳定定位到外层节点的问题。 */
export function resolveEditableElement(element: HTMLElement): HTMLElement {
  if (isEditableElement(element)) {
    return element;
  }

  const nested = Array.from(
    element.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]'),
  ).find((candidate) => candidate instanceof HTMLElement && isVisible(candidate));

  if (nested instanceof HTMLElement) {
    return nested;
  }

  return element;
}

/** 深度 querySelector，递归穿透 open shadowRoot 和同源 iframe。 */
export function querySelectorDeep<T extends Element = Element>(selector: string): T | undefined {
  const visitedRoots = new Set<Document | ShadowRoot | Element>();
  return findInDeepRoots<T>(getRoot(), visitedRoots, (root) => root.querySelector<T>(selector));
}

export function findDeepElement<T extends Element = Element, S extends T = T>(
  selector: string,
  predicate: (element: T) => element is S,
): S | undefined;
export function findDeepElement<T extends Element = Element>(
  selector: string,
  predicate: (element: T) => boolean,
): T | undefined;
export function findDeepElement<T extends Element = Element>(
  selector: string,
  predicate: (element: T) => boolean,
): T | undefined {
  const visitedRoots = new Set<Document | ShadowRoot | Element>();
  return findInDeepRoots<T>(getRoot(), visitedRoots, (root) => {
    for (const element of Array.from(root.querySelectorAll<T>(selector))) {
      if (predicate(element)) return element;
    }
    return null;
  });
}

/** 在当前根节点、shadowRoot、同源 iframe 中递归查找元素。 */
function findInDeepRoots<T extends Element>(
  root: Document | ShadowRoot | Element,
  visitedRoots: Set<Document | ShadowRoot | Element>,
  find: (root: Document | ShadowRoot | Element) => T | null,
): T | undefined {
  if (visitedRoots.has(root)) return undefined;
  visitedRoots.add(root);

  const direct = find(root);
  if (direct) return direct;

  for (const deepRoot of listNestedRoots(root)) {
    const result = findInDeepRoots(deepRoot, visitedRoots, find);
    if (result) return result;
  }

  return undefined;
}

/** 列出当前节点下可访问的 shadowRoot 和同源 iframe 文档，视频号 wujie 依赖这里穿透。 */
function listNestedRoots(root: Document | ShadowRoot | Element) {
  const nestedRoots: Array<Document | ShadowRoot> = [];
  const walkerRoot = root instanceof Document ? root.documentElement : root;
  if (!walkerRoot) return nestedRoots;

  const ownerDoc = walkerRoot.ownerDocument;
  if (!ownerDoc) return nestedRoots;

  let walker: TreeWalker;
  try {
    walker = ownerDoc.createTreeWalker(walkerRoot, NodeFilter.SHOW_ELEMENT);
  } catch {
    return nestedRoots;
  }

  let current: Node | null = walker.currentNode;
  while (current) {
    const element = current as Element;

    // 遍历 open shadowRoot（wujie 微前端使用 open shadow DOM）
    if (element.shadowRoot) {
      nestedRoots.push(element.shadowRoot);
    }

    // 遍历同源 iframe（wujie 可能用 iframe 做 JS 隔离）
    if (element instanceof HTMLIFrameElement) {
      try {
        const iframeDoc = element.contentDocument;
        if (iframeDoc) {
          nestedRoots.push(iframeDoc);
        }
      } catch {
        // 跨域 iframe 无法访问，跳过
      }
    }

    current = walker.nextNode();
  }

  return nestedRoots;
}

/** 判断元素是否能接收文本输入。 */
export function isEditableElement(element: Element): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

/** 按多个选择器查找第一个元素，不要求可见，适合上传 input 这类隐藏控件。 */
export function findElement<T extends Element = HTMLElement>(selectors: string[]): T | undefined {
  for (const selector of selectors) {
    let element: Element | undefined;
    try {
      element = querySelectorDeep(selector);
    } catch {
      continue;
    }
    if (element) return element as T;
  }
  return undefined;
}

/** 轮询等待单个 selector 出现。 */
export async function waitForSelector(selector: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (querySelectorDeep(selector)) return true;
    await waitForIdle(DOM_POLL_INTERVAL_MS);
  }
  return false;
}

/** 轮询等待任意 selector 出现，并返回命中的 selector，便于判断页面进入哪个状态。 */
export async function waitForAnySelector(
  selectors: Array<string | undefined>,
  timeoutMs: number,
): Promise<string | undefined> {
  const activeSelectors = selectors.filter((selector): selector is string => !!selector);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const selector of activeSelectors) {
      if (querySelectorDeep(selector)) return selector;
    }
    await waitForIdle(DOM_POLL_INTERVAL_MS);
  }
  return undefined;
}

/** 轮询等待元素出现，封装多 selector 兜底和 deep DOM 查询。 */
export async function waitForElement<T extends Element = HTMLElement>(
  selectors: string[],
  timeoutMs: number,
): Promise<T | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const element = findElement<T>(selectors);
    if (element) return element;
    await waitForIdle(DOM_POLL_INTERVAL_MS);
  }
  return undefined;
}

/** 判断元素是否在布局中可见，过滤掉隐藏 input、关闭弹窗里的旧节点。 */
export function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    Number(style.opacity || '1') > 0
  );
}

/** 将 Element 收窄成 HTMLElement；不是可操作节点时直接报错。 */
export function asEditable(element: Element): HTMLElement {
  if (!(element instanceof HTMLElement)) {
    throw new Error('目标字段不是可编辑元素');
  }
  return element;
}

/** 将目标滚到视口中间，减少平台虚拟列表或悬浮条挡住点击的问题。 */
export function scrollIntoView(element: Element) {
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

/** 选中目标元素现有文本，确保后续 insertText/paste 是替换而不是追加。 */
export function selectExistingText(element: HTMLElement) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.select();
    return;
  }

  const activeDocument = getActiveDocument(element);
  const range = activeDocument.createRange();
  range.selectNodeContents(element);
  const selection = activeDocument.defaultView?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** 派发 beforeinput/input，补足 React/Vue 受控输入框对原生 value 修改的监听。 */
export function dispatchInputEvent(element: HTMLElement, type: 'beforeinput' | 'input', data: string) {
  element.dispatchEvent(
    new InputEvent(type, {
      data,
      inputType: 'insertText',
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** 派发 paste 事件，给 Draft.js/ProseMirror 这类编辑器机会走自己的粘贴逻辑。 */
export function dispatchClipboardEvent(element: HTMLElement, text: string) {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  element.dispatchEvent(
    new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** 派发键盘事件，用于模拟确认、换行或触发平台快捷输入逻辑。 */
export function dispatchKeyboard(element: HTMLElement, type: 'keydown' | 'keyup', key: string) {
  element.dispatchEvent(
    new KeyboardEvent(type, {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** 统一的异步等待入口，便于后续调整拟人节奏和 DOM 稳定等待。 */
export function waitForIdle(ms: number) {
  return sleep(ms);
}
