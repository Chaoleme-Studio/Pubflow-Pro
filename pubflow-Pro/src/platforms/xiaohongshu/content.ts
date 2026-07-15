import { fillField, humanDelay } from '../../content/fieldFiller';
import { uploadVideoIfAvailable } from '../../content/videoUploader';
import { fillArticleBody } from '../../content/articleBodyFiller';
import { cdpClickElement } from '../../content/cdp';
import {
  composePublishMessage,
  fillDeclarationDropdown,
  fillOriginalDeclare,
  handleOriginalDeclarePopup,
  fillPlatformSettings,
  fillScheduled,
  fillVisibility,
  waitForArticleEditorReady,
  waitForEditorReady,
  waitForImageEditorReady,
} from '../../content/publishSteps';
import { findVisibleElement, isVisible, scrollIntoView, waitForIdle } from '../../content/dom';
import { resolveContentFields } from '../shared';
import { loadFileForTransfer } from '../../storage/videoTransferStorage';
import type { ContentData, RuntimeMessage } from '../../types';
import type { PlatformConfig } from '../types';

const XIAOHONGSHU_IMAGE_DESCRIPTION_SELECTOR = '.tiptap.ProseMirror, [contenteditable="true"]';

/** 获取页面中所有可见的小红书开关卡片，按位置排序 */
function getXiaohongshuSwitchCards() {
  return Array.from(document.querySelectorAll<HTMLElement>('.custom-switch-card, [class*="switch-card"]'))
    .filter((card) => isVisible(card))
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top === br.top ? ar.left - br.left : ar.top - br.top;
    });
}

/** 根据标签查找对应的开关卡片（原创声明或定时发布） */
function findXiaohongshuSwitchCard(label: '原创声明' | '定时发布') {
  const cards = getXiaohongshuSwitchCards();

  // 小红书图文/视频开关位置稳定：原创是第一张卡，定时是最后一张卡。
  // 这两个开关 CSS 基本一样，页面文案结构不稳定时按文本找会误命中。
  return label === '原创声明' ? cards[0] : cards[cards.length - 1];
}

/** 等待开关卡片内的可点击开关元素就绪 */
async function waitForXiaohongshuSwitchReady(card: HTMLElement, timeoutMs = 10000): Promise<HTMLElement | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const simulator = card.querySelector<HTMLElement>('.d-switch-simulator:not(.disabled)');
    if (simulator) return simulator;
    const dSwitch = card.querySelector<HTMLElement>('.d-switch:not(.disabled)');
    if (dSwitch) return dSwitch;
    await waitForIdle(500);
  }
  return null;
}

/** 点击小红书开关卡片，切换开关状态 */
async function clickXiaohongshuSwitchCard(card: HTMLElement) {
  scrollIntoView(card);
  await waitForIdle(250);
  const target = await waitForXiaohongshuSwitchReady(card);
  if (!target) return;
  target.click();
  await waitForIdle(700);
}

/** 填充小红书视频原创声明，处理短视频不支持原创声明的情况 */
async function fillXiaohongshuVideoOriginalDeclare(config: PlatformConfig): Promise<string> {
  let originalCard = findXiaohongshuSwitchCard('原创声明');
  if (!originalCard) {
    await fillOriginalDeclare(config);
    return '';
  }

  // 小红书视频页在视频小于10秒时会禁用原创声明开关
  const switchReady = await waitForXiaohongshuSwitchReady(originalCard, 15000);
  if (!switchReady) {
    return '小红书视频小于10秒不支持原创声明，已跳过。';
  }

  const input = originalCard.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input?.checked) {
    await clickXiaohongshuSwitchCard(originalCard);
    originalCard = findXiaohongshuSwitchCard('原创声明') || originalCard;
  }
  await handleOriginalDeclarePopup();
  return '';
}

/** 填充小红书定时发布，优先使用开关卡片方式 */
async function fillXiaohongshuScheduled(config: PlatformConfig, scheduledAt: number) {
  let scheduleCard = findXiaohongshuSwitchCard('定时发布');
  if (!scheduleCard) {
    await fillScheduled(config, scheduledAt);
    return;
  }

  const input = scheduleCard.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input?.checked) {
    await clickXiaohongshuSwitchCard(scheduleCard);
    scheduleCard = findXiaohongshuSwitchCard('定时发布') || scheduleCard;
    // 点击后重新检查开关状态
    const recheck = scheduleCard.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!recheck?.checked) return;
  }
  await fillScheduled(config, scheduledAt);
}

/** 填充小红书图文描述，支持多种编辑器注入方式 */
async function fillXiaohongshuImageDescription(value: string) {
  const pageWorldFilled = await fillXiaohongshuImageDescriptionInPageWorld(value);
  if (pageWorldFilled) return true;

  const editor =
    Array.from(document.querySelectorAll<HTMLElement>(XIAOHONGSHU_IMAGE_DESCRIPTION_SELECTOR))
      .find((candidate) => isVisible(candidate)) || null;
  if (!editor) return false;

  scrollIntoView(editor);
  await waitForIdle(250);
  editor.focus();

  if (await fillXiaohongshuTiptapDescription(editor, value)) {
    return true;
  }

  const beforeInput = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: value,
  });
  editor.dispatchEvent(beforeInput);

  const activeDocument = editor.ownerDocument || document;
  activeDocument.execCommand('selectAll', false);
  activeDocument.execCommand('delete', false);
  const inserted = activeDocument.execCommand('insertText', false, value);
  if (!inserted || !editor.textContent?.includes(value)) {
    editor.textContent = value;
  }

  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
  editor.dispatchEvent(new Event('blur', { bubbles: true }));
  await waitForIdle(300);

  return editor.textContent?.includes(value) || false;
}

/** 通过页面世界（page world）方式填充图文描述 */
async function fillXiaohongshuImageDescriptionInPageWorld(value: string) {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'XIAOHONGSHU_FILL_IMAGE_DESCRIPTION',
      payload: { description: value },
    } satisfies RuntimeMessage) as { ok?: boolean; data?: { ok?: boolean; error?: string }; error?: string } | undefined;
    return response?.ok === true && response.data?.ok === true;
  } catch {
    return false;
  }
}

/** 使用 Tiptap 编辑器 API 填充图文描述 */
async function fillXiaohongshuTiptapDescription(editorElement: HTMLElement, value: string) {
  const tiptapEditor = findXiaohongshuTiptapEditor(editorElement);
  if (!tiptapEditor) return false;

  try {
    const html = plainTextToXiaohongshuHtml(value);
    tiptapEditor.commands.setContent(html);
    tiptapEditor.commands.focus?.();
    editorElement.dispatchEvent(new Event('input', { bubbles: true }));
    editorElement.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForIdle(300);
    return editorElement.textContent?.includes(value) || false;
  } catch {
    return false;
  }
}

/** 在 DOM 元素中查找 Tiptap 编辑器实例 */
function findXiaohongshuTiptapEditor(element: HTMLElement): any {
  const candidates = [element, ...Array.from(element.querySelectorAll<HTMLElement>('.ProseMirror, .tiptap'))];
  for (const candidate of candidates) {
    const editor = (candidate as any).editor;
    if (editor?.commands?.setContent) return editor;
  }
  return null;
}

/** 将纯文本转换为小红书 Tiptap 编辑器所需的 HTML 格式 */
function plainTextToXiaohongshuHtml(value: string) {
  const lines = value.split(/\r?\n/);
  return lines
    .map((line) => `<p>${escapeXiaohongshuHtml(line) || '<br>'}</p>`)
    .join('');
}

/** 转义 HTML 特殊字符，防止 XSS 和内容注入问题 */
function escapeXiaohongshuHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 上传小红书封面图片 */
async function uploadXiaohongshuCover(config: PlatformConfig, content: ContentData) {
  if (!content.coverCacheId || !config.fields.cover) return '';

  const file = await loadFileForTransfer(content.coverCacheId);
  if (!file) return '封面缓存不存在，跳过封面上传。';

  const beforeSignature = getXiaohongshuCoverSignature();
  const coverElement = findXiaohongshuCoverEntry(config);
  const dialog = await openXiaohongshuCoverDialog(coverElement);
  if (!dialog) return '没有打开小红书封面设置弹窗。';

  const input = await waitForXiaohongshuCoverInput(8000);
  if (!input) return '没有找到小红书封面弹窗内的图片 input。';

  const beforeDialogSignature = getXiaohongshuDialogPreviewSignature(dialog);
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  try {
    input.files = dataTransfer.files;
  } catch {
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: dataTransfer.files,
    });
  }
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  const injectedReady = await waitForXiaohongshuInjectedCoverReady(input, beforeDialogSignature, 15000);
  if (!injectedReady) return '封面已注入，但没有等到小红书封面预览，未点击确定。';

  const confirmButton = await waitForXiaohongshuDialogButton(['确定', '完成', '保存'], 15000);
  if (!confirmButton) return '封面已注入，但没有找到小红书封面弹窗确认按钮。';

  await clickXiaohongshuElement(confirmButton);
  const closed = await waitForXiaohongshuCoverDialogClosed(10000);
  const changed = await waitForXiaohongshuCoverPreviewChange(beforeSignature, 10000);
  if (!closed) return '封面已注入并点击确定，但小红书封面弹窗未关闭。';
  return changed ? '封面已通过小红书封面弹窗上传并确认。' : '封面已通过小红书封面弹窗上传并确认，请检查封面预览。';
}

/** 查找小红书封面上传入口元素 */
function findXiaohongshuCoverEntry(config: PlatformConfig) {
  return (
    findVisibleElement(config.fields.cover?.selectors || []) ||
    findVisibleElement([
      '.publish-page-content-cover .default.column',
      '.publish-page-content-cover .default.row',
      '.publish-page-content-cover .cover-plugin-preview',
      '.publish-page-content-cover',
    ])
  );
}

/** 打开小红书封面设置弹窗 */
async function openXiaohongshuCoverDialog(coverElement?: HTMLElement) {
  const existingDialog = findXiaohongshuCoverDialog();
  if (existingDialog) return existingDialog;
  if (!coverElement) return null;

  scrollIntoView(coverElement);
  await waitForIdle(300);

  const clickTarget =
    coverElement.querySelector<HTMLElement>('.operator.default, .operator, .text') ||
    coverElement.querySelector<HTMLElement>('.default.column, .default.row') ||
    coverElement;
  await clickXiaohongshuElement(clickTarget);

  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    const dialog = findXiaohongshuCoverDialog();
    if (dialog) return dialog;
    const hoverTarget = findVisibleXiaohongshuCoverHoverTarget();
    if (hoverTarget) {
      await clickXiaohongshuElement(hoverTarget);
    }
    await waitForIdle(250);
  }
  return null;
}

/** 查找封面区域可见的悬停点击目标（如"修改封面"按钮） */
function findVisibleXiaohongshuCoverHoverTarget() {
  const coverArea = document.querySelector<HTMLElement>('.publish-page-content-cover');
  const hoverTargets = coverArea?.querySelectorAll<HTMLElement>('.operator, .text') || [];
  for (const target of hoverTargets) {
    const text = target.textContent?.replace(/\s+/g, '') || '';
    if (text.includes('修改封面') && isClickableXiaohongshuElement(target)) return target;
  }
  return null;
}

/** 查找小红书封面设置弹窗 */
function findXiaohongshuCoverDialog(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>(
    '.d-modal.cover-modal, .cover-modal, .d-modal-mask, [role="dialog"], [class*="modal"]',
  );
  for (const dialog of dialogs) {
    const text = dialog.textContent?.replace(/\s+/g, '') || '';
    if (isVisible(dialog) && text.includes('设置封面') && text.includes('上传图片') && text.includes('确定')) {
      return dialog;
    }
  }
  return null;
}

/** 等待封面弹窗内的图片文件 input 元素出现 */
async function waitForXiaohongshuCoverInput(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dialog = findXiaohongshuCoverDialog();
    const input = dialog ? findXiaohongshuImageInput(dialog) : null;
    if (input) return input;
    await waitForIdle(250);
  }
  return null;
}

/** 在指定范围内查找图片文件 input 元素 */
function findXiaohongshuImageInput(scope: ParentNode): HTMLInputElement | null {
  const input = scope.querySelector<HTMLInputElement>(
    'input[type="file"][accept*="image"], input[type="file"][accept*=".jpg"], input[type="file"][accept*=".jpeg"], input[type="file"][accept*=".png"]',
  );
  if (input && !input.accept.includes('video')) return input;

  const inputs = scope.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const fileInput of inputs) {
    const accept = fileInput.accept || '';
    if (accept.includes('image') && !accept.includes('video')) return fileInput;
  }
  return null;
}

/** 等待小红书封面文件被弹窗接收，并出现稳定的预览/裁剪状态。 */
async function waitForXiaohongshuInjectedCoverReady(
  input: HTMLInputElement,
  beforeDialogSignature: string,
  timeoutMs: number,
) {
  const startedAt = Date.now();
  let readySince = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const dialog = findXiaohongshuCoverDialog();
    if (!dialog) return true;

    const hasFile = Boolean(input.files?.length);
    const currentSignature = getXiaohongshuDialogPreviewSignature(dialog);
    const previewChanged = Boolean(currentSignature && currentSignature !== beforeDialogSignature);
    const hasUploadedState = hasXiaohongshuUploadedCoverState(dialog);
    const hasConfirmButton = Boolean(findXiaohongshuButton(dialog, ['确定', '完成', '保存']));

    if (hasFile && hasConfirmButton && (previewChanged || hasUploadedState)) {
      readySince ||= Date.now();
      if (Date.now() - readySince >= 800) return true;
    } else {
      readySince = 0;
    }

    await waitForIdle(250);
  }

  return false;
}

/** 生成弹窗内封面预览签名，用于判断上传后预览是否变化。 */
function getXiaohongshuDialogPreviewSignature(scope: ParentNode) {
  const images = Array.from(scope.querySelectorAll<HTMLImageElement>('img'))
    .map((img) => {
      const rect = img.getBoundingClientRect();
      return `${Math.round(rect.width)}x${Math.round(rect.height)}:${img.currentSrc || img.src}`;
    })
    .filter(Boolean);
  const canvases = Array.from(scope.querySelectorAll<HTMLCanvasElement>('canvas'))
    .map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const size = `${canvas.width}x${canvas.height}:${Math.round(rect.width)}x${Math.round(rect.height)}`;
      try {
        return `${size}:${canvas.toDataURL('image/png').slice(0, 200)}`;
      } catch {
        return size;
      }
    })
    .filter(Boolean);
  const backgrounds = Array.from(scope.querySelectorAll<HTMLElement>('[style*="background"]'))
    .map((element) => element.style.backgroundImage || element.getAttribute('style') || '')
    .filter(Boolean);
  return [...images, ...canvases, ...backgrounds].join('|');
}

/** 判断弹窗是否已经从上传占位切到上传后的封面编辑状态。 */
function hasXiaohongshuUploadedCoverState(dialog: HTMLElement) {
  const text = dialog.textContent?.replace(/\s+/g, '') || '';
  const hasPostUploadAction =
    text.includes('重新上传') ||
    text.includes('更换图片') ||
    text.includes('裁剪') ||
    text.includes('缩放') ||
    text.includes('旋转');
  const hasPreview = Array.from(
    dialog.querySelectorAll<HTMLElement>('img, canvas, [class*="crop"], [class*="Crop"], [class*="preview"], [class*="Preview"]'),
  ).some((element) => {
    const rect = element.getBoundingClientRect();
    const className = element.className?.toString() || '';
    const hasBackground = Boolean(element.style.backgroundImage && element.style.backgroundImage !== 'none');
    return isVisible(element) && rect.width >= 48 && rect.height >= 48 && (hasBackground || className || element.tagName === 'IMG' || element.tagName === 'CANVAS');
  });

  return hasPostUploadAction && hasPreview;
}

/** 等待封面弹窗内出现指定文本的按钮 */
async function waitForXiaohongshuDialogButton(texts: string[], timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dialog = findXiaohongshuCoverDialog();
    const button = dialog ? findXiaohongshuButton(dialog, texts) : null;
    if (button) return button;
    await waitForIdle(250);
  }
  return null;
}

/** 在指定范围内查找包含指定文本的可点击按钮 */
function findXiaohongshuButton(scope: HTMLElement, texts: string[]) {
  const buttons = scope.querySelectorAll<HTMLElement>('button, [role="button"], .d-button, [class*="button"]');
  for (const button of buttons) {
    const text = button.textContent?.trim() || '';
    if (texts.includes(text) && isClickableXiaohongshuElement(button)) return button;
  }
  return null;
}

/** 判断元素是否可点击（未禁用、可见且有尺寸） */
function isClickableXiaohongshuElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const disabled =
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.className.includes('disabled') ||
    (element instanceof HTMLButtonElement && element.disabled);
  return !disabled && isVisible(element) && rect.width > 0 && rect.height > 0;
}

/** 填充小红书内容类型声明下拉选项 */
async function fillXiaohongshuContentTypeDeclaration(targetText: string) {
  const normalizedTarget = targetText.replace(/\s+/g, '');
  if (!normalizedTarget || normalizedTarget === '不设置' || normalizedTarget === '不声明') return;

  const trigger = findXiaohongshuContentTypeDeclarationTrigger(normalizedTarget);
  if (!trigger) return;

  await clickXiaohongshuElement(trigger);
  await waitForIdle(500);

  const option = await waitForXiaohongshuContentTypeDeclarationOption(normalizedTarget, 4000);
  if (!option) return;

  await clickXiaohongshuElement(option);
  await waitForIdle(400);
}

/** 查找内容类型声明下拉框的触发元素 */
function findXiaohongshuContentTypeDeclarationTrigger(targetText: string) {
  const contents = document.querySelectorAll<HTMLElement>('.d-select-content');
  for (const content of contents) {
    const text = content.textContent?.replace(/\s+/g, '') || '';
    if (
      isVisible(content) &&
      (text.includes('添加内容类型声明') ||
        text.includes(targetText) ||
        text.includes('虚构演绎') ||
        text.includes('AI合成') ||
        text.includes('营销广告') ||
        text.includes('内容来源声明'))
    ) {
      return content.closest<HTMLElement>('.d-select, .d-select-wrapper') || content;
    }
  }

  const wrappers = document.querySelectorAll<HTMLElement>('.declaration-drop-down, [class*="declaration"]');
  for (const wrapper of wrappers) {
    const text = wrapper.textContent?.replace(/\s+/g, '') || '';
    if (isClickableXiaohongshuElement(wrapper) && text.includes('内容类型声明')) return wrapper;
  }
  return null;
}

/** 等待内容类型声明选项出现 */
async function waitForXiaohongshuContentTypeDeclarationOption(targetText: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const option = findXiaohongshuContentTypeDeclarationOption(targetText);
    if (option) return option;
    await waitForIdle(250);
  }
  return null;
}

/** 查找内容类型声明下拉选项 */
function findXiaohongshuContentTypeDeclarationOption(targetText: string) {
  const contentOptions = document.querySelectorAll<HTMLElement>(
    '.declaration-drop-down .d-option-content, .declaration-drop-down .d-option-name, .d-dropdown .d-option-content, .d-dropdown .d-option-name',
  );
  for (const contentOption of contentOptions) {
    const text = contentOption.textContent?.replace(/\s+/g, '') || '';
    if (!text || (text !== targetText && !text.includes(targetText))) continue;

    const handler = findXiaohongshuOptionHandlerForContent(contentOption);
    if (handler && isClickableXiaohongshuElement(handler)) return handler;

    const option = contentOption.closest<HTMLElement>('.d-option, [role="option"], [class*="option"]');
    if (option && isClickableXiaohongshuElement(option)) return option;
  }

  const handlers = document.querySelectorAll<HTMLElement>('.declaration-drop-down .d-option-handler, .d-dropdown .d-option-handler');
  for (const handler of handlers) {
    const row = handler.closest<HTMLElement>('.d-grid-item')?.parentElement;
    const rowText = row?.textContent?.replace(/\s+/g, '') || '';
    if (rowText.includes(targetText) && isClickableXiaohongshuElement(handler)) {
      return handler;
    }
  }
  return null;
}

/** 根据选项内容查找对应的点击处理器（处理选项与点击区域分离的 UI 结构） */
function findXiaohongshuOptionHandlerForContent(contentOption: HTMLElement) {
  const optionsRoot = contentOption.closest<HTMLElement>('.d-options, .d-dropdown, .declaration-drop-down') || document;
  const handlers = Array.from(optionsRoot.querySelectorAll<HTMLElement>('.d-option-handler'))
    .filter((handler) => isClickableXiaohongshuElement(handler));
  if (handlers.length === 0) return null;

  const contentRect = contentOption.getBoundingClientRect();
  const contentCenterY = contentRect.top + contentRect.height / 2;
  let best: HTMLElement | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const handler of handlers) {
    const rect = handler.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(centerY - contentCenterY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = handler;
    }
  }
  return bestDistance <= 32 ? best : null;
}

/** 点击小红书页面元素，优先使用 CDP 点击，回退到模拟鼠标事件 */
async function clickXiaohongshuElement(element: HTMLElement) {
  const fallbackSelector = '.d-select, .d-select-wrapper, .d-option, .default.column, .default.row, .publish-page-content-cover, .cover-plugin-preview';
  let clickableAncestor = element.parentElement;
  while (
    clickableAncestor &&
    (!clickableAncestor.matches(fallbackSelector) || !isClickableXiaohongshuElement(clickableAncestor))
  ) {
    clickableAncestor = clickableAncestor.parentElement;
  }
  const visibleTarget = isClickableXiaohongshuElement(element)
    ? element
    : clickableAncestor || element;

  scrollIntoView(visibleTarget);
  await waitForIdle(120);

  const clickedByCdp = await cdpClickElement(visibleTarget);
  if (clickedByCdp) return;

  const rect = visibleTarget.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    button: 0,
    buttons: 1,
  };

  visibleTarget.focus();
  visibleTarget.dispatchEvent(new PointerEvent('pointerdown', eventInit));
  visibleTarget.dispatchEvent(new MouseEvent('mousedown', eventInit));
  visibleTarget.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0 }));
  visibleTarget.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
  visibleTarget.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));
}

/** 等待小红书封面弹窗关闭 */
async function waitForXiaohongshuCoverDialogClosed(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!findXiaohongshuCoverDialog()) return true;
    await waitForIdle(250);
  }
  return false;
}

/** 获取当前封面区域的图片签名（用于检测封面变化） */
function getXiaohongshuCoverSignature() {
  const coverRoot = document.querySelector('.publish-page-content-cover') || document;
  const imageValues = Array.from(coverRoot.querySelectorAll<HTMLImageElement>('img'))
    .map((img) => img.currentSrc || img.src)
    .filter(Boolean);
  const backgroundValues = Array.from(coverRoot.querySelectorAll<HTMLElement>('[style*="background"]'))
    .map((el) => el.style.backgroundImage || el.getAttribute('style') || '')
    .filter(Boolean);
  return [...imageValues, ...backgroundValues].join('|');
}

/** 等待封面预览发生变化 */
async function waitForXiaohongshuCoverPreviewChange(beforeSignature: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentSignature = getXiaohongshuCoverSignature();
    if (currentSignature && currentSignature !== beforeSignature) return true;
    await waitForIdle(500);
  }
  return false;
}

/** 填充小红书内容（视频、图文、文章），处理上传、字段填充和平台设置 */
export async function fillXiaohongshuContent(config: PlatformConfig, content: ContentData, isArticle: boolean = false) {
  let uploadMessage = '';
  let coverMessage = '';
  let articleBodyMessage = '';
  const isImagePost = content.contentType === 'image';

  // 根据是否是图文选择不同的上传逻辑
  if (isImagePost && content.imageCacheIds?.length) {
    // 图文上传
    const { uploadImagesIfAvailable } = await import('../../content/imageUploader');
    uploadMessage = await uploadImagesIfAvailable(config, content);
    await humanDelay();
  } else if (!isArticle && content.videoCacheId) {
    // 视频上传
    uploadMessage = await uploadVideoIfAvailable(config, content);
    await humanDelay();
  }

  // 根据是否是图文选择不同的字段配置
  const fields = resolveContentFields(config, content.contentType, isArticle);

  if (isArticle) {
    await waitForArticleEditorReady(config);
  } else if (isImagePost) {
    await waitForImageEditorReady(config);
  } else {
    await waitForEditorReady(config);
  }

  if (fields.title && content.title) {
    await fillField(fields.title, content.title);
    await humanDelay();
  }

  // 文章模式：填充文章正文
  console.info('[PubFlow][xiaohongshu] article body check', {
    isArticle,
    hasArticleContent: Boolean(content.articleContent),
    hasArticleBodyField: Boolean(fields.articleBody),
    articleBodySelectors: fields.articleBody?.selectors,
  });
  if (isArticle && content.articleContent && fields.articleBody) {
    articleBodyMessage = await fillArticleBody(fields.articleBody, content.articleContent);
    await humanDelay();
  } else if (isImagePost && content.description) {
    const filled = await fillXiaohongshuImageDescription(content.description);
    if (!filled && fields.description) {
      await fillField(fields.description, content.description);
    }
    await humanDelay();
  } else if (fields.description && content.description) {
    // 视频/图文模式：填充简介
    await fillField(fields.description, content.description);
    await humanDelay();
  }

  // 图文不需要上传封面（从已上传图片中选择）
  if (!isArticle && !isImagePost) {
    coverMessage = await uploadXiaohongshuCover(config, content);
    if (coverMessage) {
      await humanDelay();
    }
  }

  if (fields.visibility && content.visibility) {
    await fillVisibility(config, content.visibility);
    await humanDelay();
  }

  if (fields.scheduled && content.scheduledAt) {
    await fillXiaohongshuScheduled(config, content.scheduledAt);
    await humanDelay();
  }

  let originalDeclareMessage = '';
  if (fields.originalDeclare && content.originalDeclare) {
    originalDeclareMessage = await fillXiaohongshuVideoOriginalDeclare(config);
    await humanDelay();
  }

  if (fields.declaration) {
    const defaultText = fields.declaration.选项文本 || '内容无需标注';
    await fillDeclarationDropdown(config, defaultText);
    await humanDelay();
  }

  const platformSettings = content.platformSettings?.[config.id] ?? {};
  if (typeof platformSettings.contentTypeDeclaration === 'string') {
    await fillXiaohongshuContentTypeDeclaration(platformSettings.contentTypeDeclaration);
    await humanDelay();
  }

  await fillPlatformSettings(config, platformSettings);
  await humanDelay();

  return composePublishMessage(uploadMessage, coverMessage, articleBodyMessage) + originalDeclareMessage;
}
