import type { FieldConfig } from '../platforms';
import { splitDescriptionAndTopics } from '../domain/content';
import { normalizeTopicIntervalMs } from '../domain/fillSettings';
import { cdpFillDescriptionWithTopics } from './cdp';
import {
  asEditable,
  dispatchClipboardEvent,
  dispatchInputEvent,
  dispatchKeyboard,
  findEditableElement,
  getActiveDocument,
  isEditableElement,
  scrollIntoView,
  selectExistingText,
  waitForIdle,
} from './dom';

const FIELD_FOCUS_DELAY_RANGE_MS = [180, 360] as const;
const HUMAN_DELAY_RANGE_MS = [220, 800] as const;
const TYPING_CHAR_DELAY_RANGE_MS = [18, 63] as const;
const CONFIRM_KEY_SETTLE_MS = 120;

/** 按字段配置选择 pasteLike/contentEditable/simulateTyping 三种方式填充普通文本字段。 */
export async function fillField(field: FieldConfig, value: string) {
  const element = findEditableElement(field.selectors);
  if (!element) {
    throw new Error(`没有找到字段：${field.selectors[0]}`);
  }

  scrollIntoView(element);
  await humanDelay(...FIELD_FOCUS_DELAY_RANGE_MS);

  if (field.fillMethod === 'contentEditable') {
    await fillContentEditable(element, value);
    return;
  }

  if (field.fillMethod === 'simulateTyping') {
    await simulateTyping(element, value, field.multiValue?.confirmKey);
    return;
  }

  await pasteLike(element, value);
}

/** 逐个输入话题并用 Enter/Space 确认，适配平台独立的话题 token 输入框。 */
export async function fillTopics(field: FieldConfig, topics: string[]) {
  const element = findEditableElement(field.selectors);
  if (!element) {
    throw new Error(`没有找到话题字段：${field.selectors[0]}`);
  }

  scrollIntoView(element);
  const prefix = field.multiValue?.prefix ?? '#';
  const confirmKey = field.multiValue?.confirmKey || 'Enter';
  const delayMs = field.multiValue?.delayMs || 450;

  for (const rawTopic of topics) {
    const clean = rawTopic.trim().replace(/^#+/, '');
    if (!clean) continue;
    const text = `${prefix}${clean}`;
    await simulateTyping(element, text, confirmKey);
    await waitForIdle(delayMs);
  }
}

/**
 * 先替换作品描述，再逐个输入话题，按 Enter 确认后补空格分隔。
 * 支持描述末尾已经包含 #话题 的旧数据，避免整段粘贴导致平台漏掉话题 token。
 */
export async function fillDescriptionWithTopics(
  field: FieldConfig,
  description: string,
  topics: string[],
  topicIntervalMs?: number,
) {
  const element = findEditableElement(field.selectors);
  if (!element) {
    throw new Error(`没有找到作品描述字段：${field.selectors[0]}`);
  }

  const content = splitDescriptionAndTopics(description, topics);
  const editable = asEditable(element);
  scrollIntoView(editable);
  await humanDelay(...FIELD_FOCUS_DELAY_RANGE_MS);
  replaceEditableText(editable, content.description);
  await appendTopicValues(editable, content.topics, Boolean(content.description), topicIntervalMs);
}

/**
 * 通过真实点击和可信键盘输入填写描述及话题。
 * 用于会忽略合成事件或把合成 Enter 当换行的受控编辑器。
 */
export async function fillDescriptionWithTopicsByTrustedInput(
  field: FieldConfig,
  description: string,
  topics: string[],
  topicIntervalMs?: number,
) {
  const element = findEditableElement(field.selectors);
  if (!element) {
    throw new Error(`没有找到作品描述字段：${field.selectors[0]}`);
  }

  const content = splitDescriptionAndTopics(description, topics);
  const editable = asEditable(element);
  scrollIntoView(editable);
  await humanDelay(...FIELD_FOCUS_DELAY_RANGE_MS);
  await cdpFillDescriptionWithTopics(
    editable,
    content.description,
    content.topics,
    normalizeTopicIntervalMs(topicIntervalMs),
  );
}

/** 在已经由平台主世界写好的描述后追加话题，用于必须调用页面编辑器 API 的场景。 */
export async function appendTopicsToDescription(
  field: FieldConfig,
  description: string,
  topics: string[],
  topicIntervalMs?: number,
) {
  const element = findEditableElement(field.selectors);
  if (!element) {
    throw new Error(`没有找到作品描述字段：${field.selectors[0]}`);
  }

  const content = splitDescriptionAndTopics(description, topics);
  const editable = asEditable(element);
  scrollIntoView(editable);
  await humanDelay(...FIELD_FOCUS_DELAY_RANGE_MS);
  await appendTopicValues(editable, content.topics, Boolean(content.description), topicIntervalMs);
}

async function appendTopicValues(
  editable: HTMLElement,
  topics: string[],
  hasDescription: boolean,
  topicIntervalMs?: number,
) {
  const delayMs = normalizeTopicIntervalMs(topicIntervalMs);
  if (hasDescription && topics.length > 0) {
    insertTextAtCaret(editable, ' ');
    dispatchInputEvent(editable, 'input', ' ');
    await waitForIdle(delayMs);
  }

  for (let index = 0; index < topics.length; index++) {
    insertTopicAtCaret(editable, `#${topics[index]}`);
    await waitForIdle(delayMs);
    confirmTopicWithEnter(editable);
    await waitForIdle(delayMs);
    insertTopicSeparatorSpace(editable);
  }

  editable.dispatchEvent(new Event('change', { bubbles: true }));
  editable.dispatchEvent(new Event('blur', { bubbles: true }));
}

/** 统一拟人等待，避免连续 DOM 操作过快导致平台组件状态还没同步。 */
export function humanDelay(min: number = HUMAN_DELAY_RANGE_MS[0], max: number = HUMAN_DELAY_RANGE_MS[1]) {
  return waitForIdle(min + Math.floor(Math.random() * (max - min)));
}

/** 模拟粘贴式填充，适合受控 input/textarea 和普通 contenteditable。 */
async function pasteLike(element: Element, value: string) {
  const editable = asEditable(element);
  editable.focus();
  selectExistingText(editable);
  dispatchInputEvent(editable, 'beforeinput', value);

  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    setNativeValue(editable, value);
  } else {
    const activeDocument = getActiveDocument(editable);
    activeDocument.execCommand('delete', false);
    activeDocument.execCommand('insertText', false, value);
  }

  dispatchClipboardEvent(editable, value);
  dispatchInputEvent(editable, 'input', value);
  editable.dispatchEvent(new Event('change', { bubbles: true }));
  editable.dispatchEvent(new Event('blur', { bubbles: true }));
}

/** 替换描述，不再额外派发 paste，避免平台编辑器自行处理后出现双份文本。 */
function replaceEditableText(editable: HTMLElement, value: string) {
  editable.focus();
  selectExistingText(editable);
  dispatchInputEvent(editable, 'beforeinput', value);

  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    setNativeValue(editable, value);
  } else {
    const activeDocument = getActiveDocument(editable);
    activeDocument.execCommand('delete', false);
    activeDocument.execCommand('insertText', false, value);
  }

  dispatchInputEvent(editable, 'input', value);
  editable.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 逐个追加话题文本；每次只走一次 DOM 写入，避免 paste 事件和 insertText 重复生效。 */
function insertTopicAtCaret(editable: HTMLElement, value: string) {
  editable.focus();
  moveCaretToEnd(editable);
  insertTextAtCaret(editable, value);
  dispatchInputEvent(editable, 'input', value);
}

/** 派发 Enter，让平台把当前话题转成 token。 */
function confirmTopicWithEnter(editable: HTMLElement) {
  dispatchTopicKey(editable, 'keydown', 'Enter');
  dispatchTopicKey(editable, 'keyup', 'Enter');
}

/** Enter 确认完成后输入一个真实空格，再继续下一个话题。 */
function insertTopicSeparatorSpace(editable: HTMLElement) {
  dispatchTopicKey(editable, 'keydown', ' ');
  insertTextAtCaret(editable, ' ');
  dispatchInputEvent(editable, 'input', ' ');
  dispatchTopicKey(editable, 'keyup', ' ');
}

function dispatchTopicKey(
  editable: HTMLElement,
  type: 'keydown' | 'keyup',
  key: 'Enter' | ' ',
) {
  const isEnter = key === 'Enter';
  editable.dispatchEvent(new KeyboardEvent(type, {
    key,
    code: isEnter ? 'Enter' : 'Space',
    keyCode: isEnter ? 13 : 32,
    which: isEnter ? 13 : 32,
    bubbles: true,
    cancelable: true,
  }));
}

function moveCaretToEnd(editable: HTMLElement) {
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    editable.setSelectionRange(editable.value.length, editable.value.length);
    return;
  }

  const activeDocument = getActiveDocument(editable);
  const range = activeDocument.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
  const selection = activeDocument.defaultView?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function insertTextAtCaret(editable: HTMLElement, value: string) {
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    const start = editable.selectionStart ?? editable.value.length;
    const end = editable.selectionEnd ?? start;
    const nextValue = `${editable.value.slice(0, start)}${value}${editable.value.slice(end)}`;
    setNativeValue(editable, nextValue);
    const nextCaret = start + value.length;
    editable.setSelectionRange(nextCaret, nextCaret);
    return;
  }

  getActiveDocument(editable).execCommand('insertText', false, value);
}

/** 使用 execCommand 填充 contenteditable，保留平台编辑器对 input/change 的监听。 */
async function fillContentEditable(element: Element, value: string) {
  const editable = asEditable(element);
  editable.focus();

  if (!isEditableElement(editable)) {
    const nested = editable.querySelector('[contenteditable="true"]');
    if (nested instanceof HTMLElement) {
      await fillContentEditable(nested, value);
      return;
    }
  }

  selectExistingText(editable);
  dispatchInputEvent(editable, 'beforeinput', value);
  const activeDocument = getActiveDocument(editable);
  activeDocument.execCommand('delete', false);
  activeDocument.execCommand('insertText', false, value);
  dispatchInputEvent(editable, 'input', value);
  editable.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 逐字模拟输入，主要用于话题、标签这类需要键盘确认生成 token 的字段。 */
export async function simulateTyping(element: Element, value: string, confirmKey?: string) {
  const editable = asEditable(element);
  editable.focus();

  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    setNativeValue(editable, '');
    editable.dispatchEvent(new Event('input', { bubbles: true }));
  }

  for (const char of value) {
    dispatchKeyboard(editable, 'keydown', char);
    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
      setNativeValue(editable, `${editable.value}${char}`);
    } else {
      getActiveDocument(editable).execCommand('insertText', false, char);
    }
    dispatchInputEvent(editable, 'input', char);
    dispatchKeyboard(editable, 'keyup', char);
    await humanDelay(...TYPING_CHAR_DELAY_RANGE_MS);
  }

  if (confirmKey) {
    dispatchKeyboard(editable, 'keydown', confirmKey);
    if (!(editable instanceof HTMLInputElement) && !(editable instanceof HTMLTextAreaElement)) {
      if (confirmKey === 'Enter') {
        getActiveDocument(editable).execCommand('insertParagraph', false);
        dispatchInputEvent(editable, 'input', '\n');
      } else if (confirmKey === 'Space') {
        getActiveDocument(editable).execCommand('insertText', false, ' ');
        dispatchInputEvent(editable, 'input', ' ');
      }
    }
    dispatchKeyboard(editable, 'keyup', confirmKey);
    await waitForIdle(CONFIRM_KEY_SETTLE_MS);
  }
}

/** 通过原生 value setter 写值，绕过 React/Vue 对直接 element.value 赋值的拦截。 */
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
}
