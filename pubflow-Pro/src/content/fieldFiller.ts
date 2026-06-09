import type { FieldConfig } from '../platforms';
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

/** 逐个输入话题并用 Enter/Space 确认，适配平台话题 token 化输入框。 */
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
