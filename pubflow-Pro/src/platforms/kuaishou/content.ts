import { fillField, humanDelay } from '../../content/fieldFiller';
import { uploadVideoIfAvailable } from '../../content/videoUploader';
import { cdpClickElement } from '../../content/cdp';
import {
  composePublishMessage,
  fillDeclarationDropdown,
  fillOriginalDeclare,
  fillPlatformSettings,
  fillScheduled,
  fillVisibility,
  waitForArticleEditorReady,
  waitForEditorReady,
  waitForImageEditorReady,
} from '../../content/publishSteps';
import { findVisibleElement, isVisible, scrollIntoView, waitForIdle } from '../../content/dom';
import { assignFilesToInput } from '../../content/uploadDom';
import { resolveContentFields } from '../shared';
import { loadFileForTransfer } from '../../storage/videoTransferStorage';
import type { ContentData } from '../../types';
import type { PlatformConfig } from '../types';

const KUAISHOU_UPLOAD_TAB_TEXTS = ['上传封面', '本地上传', '上传图片'];
const KUAISHOU_COVER_ENTRY_TEXTS = ['修改封面', '设置封面', '编辑封面', '上传封面', '封面设置'];

/** 上传快手封面（通过弹窗选择"本地上传"标签页并注入文件） */
async function uploadKuaishouCover(config: PlatformConfig, content: ContentData) {
  if (!content.coverCacheId || !config.fields.cover) return '';

  const file = await loadFileForTransfer(content.coverCacheId);
  if (!file) return '封面缓存不存在，跳过封面上传。';

  const coverElement = findKuaishouCoverEntry(config);
  const beforeSignature = getKuaishouCoverSignature();
  const dialog = await openKuaishouCoverDialog(coverElement);
  if (!dialog) return '没有打开快手封面编辑弹窗。';

  const tabSelected = await selectKuaishouUploadTab(dialog);
  if (!tabSelected) return '没有找到快手“上传封面/本地上传”标签页。';

  const uploaded = await uploadKuaishouCoverByInput(file);
  if (!uploaded) {
    return '没有找到快手弹窗内封面图片 input，或上传组件没有接收文件。';
  }

  const uploadTabStillSelected = await ensureKuaishouUploadTabSelected(5000);
  if (!uploadTabStillSelected) {
    return '封面已注入，但快手切回了封面截取标签页，未点击确认。';
  }
  const uploadPreviewReady = await waitForKuaishouUploadedCoverPreview(5000);
  if (!uploadPreviewReady) {
    return '封面已注入，但没有等到快手上传封面预览，未点击确认。';
  }

  const confirmButton = await waitForKuaishouDialogButton(['确认', '完成', '保存'], 12000);
  if (!confirmButton) return '封面已注入，但没有找到快手弹窗确认按钮。';

  if (!await ensureKuaishouUploadTabSelected(2000)) {
    return '封面已注入，但确认前快手再次切回封面截取标签页，未点击确认。';
  }
  await clickKuaishouElement(confirmButton);
  const closed = await waitForKuaishouCoverDialogClosed(8000);

  // 裁剪确认后会出现"封面编辑"弹窗（贴纸/文字），需要关闭
  await finishKuaishouCoverEditor(8000);

  const changed = await waitForKuaishouCoverPreviewChange(beforeSignature, 8000);
  if (!closed) return '封面已注入并点击确认，但快手封面弹窗未关闭。';
  return changed ? '封面已通过快手弹窗上传并确认。' : '封面已通过快手弹窗上传并确认，请检查封面预览。';
}

/** 查找快手封面入口元素（优先配置选择器，再按文案匹配） */
function findKuaishouCoverEntry(config: PlatformConfig) {
  const configured = findVisibleElement(config.fields.cover?.selectors || []);
  const configuredEntry = configured ? resolveKuaishouCoverClickTarget(configured) : null;
  if (configuredEntry) return configuredEntry;

  const textEntry = findKuaishouTextEntry(document, KUAISHOU_COVER_ENTRY_TEXTS);
  if (textEntry) return textEntry;

  return configured;
}

/** 解析封面元素的实际点击目标（优先卡片或按钮） */
function resolveKuaishouCoverClickTarget(coverElement: HTMLElement) {
  const coverCard =
    coverElement.querySelector<HTMLElement>('[class*="cover-full-editor"]') ||
    coverElement.querySelector<HTMLElement>('[class*="default-cover"]');
  if (coverCard) return coverCard;

  const textTarget = findKuaishouTextEntry(coverElement, KUAISHOU_COVER_ENTRY_TEXTS);
  if (textTarget) return textTarget;

  return coverElement.querySelector<HTMLElement>('button, [role="button"], [class*="button"], [class*="btn"]') || coverElement;
}

/** 通过文件 input 注入封面图片 */
async function uploadKuaishouCoverByInput(file: File) {
  const input = await waitForKuaishouImageInputInDialog(8000);
  if (!input) return false;

  assignFilesToInput(input, [file]);
  await waitForIdle(1200);

  return true;
}

/** 关闭快手封面编辑弹窗（贴纸/文字编辑） */
async function finishKuaishouCoverEditor(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const editor = findKuaishouCoverEditor();
    if (!editor) return true;

    const finishBtn = findKuaishouTextElement(editor, ['完成']);
    if (finishBtn) {
      await clickKuaishouElement(finishBtn);
      await waitForIdle(500);
      continue;
    }
    await waitForIdle(250);
  }
  return !findKuaishouCoverEditor();
}

/** 查找"封面编辑"弹窗（非封面截取） */
function findKuaishouCoverEditor(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>(
    '[role="dialog"], .ant-modal-wrap, .ant-modal, .ant-modal-content, .ant-modal-body',
  );
  for (const dialog of dialogs) {
    const text = dialog.textContent?.replace(/\s+/g, '') || '';
    if (isVisible(dialog) && text.includes('封面编辑') && !text.includes('封面截取')) {
      return dialog;
    }
  }
  return null;
}

/** 打开快手封面设置弹窗（如已打开则直接返回） */
async function openKuaishouCoverDialog(coverElement?: HTMLElement) {
  const existingDialog = findKuaishouCoverDialog();
  if (existingDialog) return existingDialog;
  let clickTarget = coverElement || findKuaishouTextEntry(document, KUAISHOU_COVER_ENTRY_TEXTS);
  if (!clickTarget) return null;

  scrollIntoView(clickTarget);
  await waitForIdle(300);

  clickTarget = resolveKuaishouCoverClickTarget(clickTarget);
  await clickKuaishouElement(clickTarget);

  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    const dialog = findKuaishouCoverDialog();
    if (dialog) return dialog;

    const fallbackTarget = findKuaishouTextEntry(document, KUAISHOU_COVER_ENTRY_TEXTS);
    if (fallbackTarget && fallbackTarget !== clickTarget && Date.now() - startedAt > 1500) {
      await clickKuaishouElement(fallbackTarget);
    }

    await waitForIdle(250);
  }
  return null;
}

/** 在封面弹窗中切换到"上传封面/本地上传"标签页 */
async function selectKuaishouUploadTab(dialog: HTMLElement) {
  // 等待弹窗动画完成（Ant Design Modal 有 300ms 动画）
  await waitForIdle(800);

  if (isKuaishouUploadTabActive(dialog)) return true;

  const tab = findKuaishouUploadTabElement(dialog) || findKuaishouTextElement(dialog, KUAISHOU_UPLOAD_TAB_TEXTS);
  if (!tab) return false;

  await clickKuaishouTabElement(tab);

  // 轮询检测切换成功，最多 5s；2s 后仍未激活则重试一次
  const startedAt = Date.now();
  let retried = false;
  while (Date.now() - startedAt < 5000) {
    const currentDialog = findKuaishouCoverDialog();
    if (currentDialog && isKuaishouUploadTabActive(currentDialog)) return true;

    if (!retried && Date.now() - startedAt > 2000) {
      retried = true;
      const tabAgain = findKuaishouUploadTabElement(dialog) || findKuaishouTextElement(dialog, KUAISHOU_UPLOAD_TAB_TEXTS);
      if (tabAgain) await clickKuaishouTabElement(tabAgain);
    }

    await waitForIdle(250);
  }
  return false;
}

/** 确保封面弹窗停留在"上传封面"标签页 */
async function ensureKuaishouUploadTabSelected(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dialog = findKuaishouCoverDialog();
    if (!dialog) return true;
    if (isKuaishouUploadTabActive(dialog)) return true;

    const tab = findKuaishouUploadTabElement(dialog) || findKuaishouTextElement(dialog, KUAISHOU_UPLOAD_TAB_TEXTS);
    if (tab) {
      await clickKuaishouTabElement(tab);
    }
    await waitForIdle(400);
  }

  const dialog = findKuaishouCoverDialog();
  return !dialog || isKuaishouUploadTabActive(dialog);
}

/** 跳过 CDP 直接派发事件，避免 Ant Design Modal 动画中 CDP 坐标不准 */
async function clickKuaishouTabElement(element: HTMLElement) {
  scrollIntoView(element);
  await waitForIdle(300);

  const rect = element.getBoundingClientRect();
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

  element.dispatchEvent(new PointerEvent('pointerdown', eventInit));
  element.dispatchEvent(new MouseEvent('mousedown', eventInit));
  element.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));
}

/** 判断封面弹窗当前是否处于"上传封面"标签页 */
function isKuaishouUploadTabActive(dialog: HTMLElement) {
  const headerItems = dialog.querySelectorAll<HTMLElement>(
    '[class*="header-title-item"], [role="tab"], [class*="tab"], [class*="Tab"]',
  );
  let hasActiveHeader = false;
  for (const item of headerItems) {
    const text = item.textContent?.trim() || '';
    const active = item.className.includes('active') || item.getAttribute('aria-selected') === 'true';
    if (active) hasActiveHeader = true;
    if (active && KUAISHOU_UPLOAD_TAB_TEXTS.some((tabText) => text.includes(tabText))) return true;
  }
  if (hasActiveHeader) return false;

  const imageInput = findKuaishouImageInput(dialog);
  const uploadPanel = imageInput?.closest<HTMLElement>('[class*="cropper-upload"], [class*="upload"]');
  return Boolean(uploadPanel && isVisible(uploadPanel));
}

/** 等待封面弹窗内的图片文件 input 出现 */
async function waitForKuaishouImageInputInDialog(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dialog = findKuaishouCoverDialog();
    const input = dialog ? findKuaishouImageInput(dialog) : null;
    if (input) return input;
    await waitForIdle(250);
  }
  return null;
}

/** 在指定作用域内查找图片文件 input（排除视频） */
function findKuaishouImageInput(scope: ParentNode): HTMLInputElement | null {
  const imageInputSelector = [
    'input[type="file"][accept*="image"]',
    'input[type="file"][accept*=".jpg"]',
    'input[type="file"][accept*=".jpeg"]',
    'input[type="file"][accept*=".png"]',
    'input[type="file"][accept*=".webp"]',
  ].join(',');

  const scopedInput = scope.querySelector<HTMLInputElement>(imageInputSelector);
  if (scopedInput && !scopedInput.accept.includes('video')) return scopedInput;

  const inputs = scope.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const input of inputs) {
    const accept = input.accept || '';
    if (accept.includes('image') && !accept.includes('video')) return input;
  }
  return null;
}

/** 查找快手封面截取弹窗（包含"封面截取"和上传标签文案） */
function findKuaishouCoverDialog(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>(
    '[role="dialog"], .ant-modal-wrap, .ant-modal, .ant-modal-content, .ant-modal-body',
  );
  for (const dialog of dialogs) {
    const text = dialog.textContent?.replace(/\s+/g, '') || '';
    const hasUploadTab = KUAISHOU_UPLOAD_TAB_TEXTS.some((tabText) => text.includes(tabText));
    if (isVisible(dialog) && text.includes('封面截取') && hasUploadTab) {
      return dialog;
    }
  }
  return null;
}

/** 等待封面弹窗内出现指定文案的按钮 */
async function waitForKuaishouDialogButton(texts: string[], timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dialog = findKuaishouCoverDialog();
    const button = dialog ? findKuaishouButton(dialog, texts) : null;
    if (button) return button;
    await waitForIdle(250);
  }
  return null;
}

/** 在指定作用域内查找匹配文案的可点击按钮 */
function findKuaishouButton(scope: HTMLElement, texts: string[]) {
  const buttons = scope.querySelectorAll<HTMLElement>('button, [role="button"]');
  for (const button of buttons) {
    const text = button.textContent?.trim() || '';
    if (texts.includes(text) && isClickableKuaishouElement(button)) return button;
  }
  return null;
}

/** 在弹窗内查找"上传封面/本地上传"标签元素 */
function findKuaishouUploadTabElement(scope: HTMLElement) {
  const headerItems = scope.querySelectorAll<HTMLElement>('[class*="header-title-item"]');
  for (const item of headerItems) {
    const text = item.textContent?.trim() || '';
    if (KUAISHOU_UPLOAD_TAB_TEXTS.some((tabText) => text.includes(tabText)) && isClickableKuaishouElement(item)) {
      return item;
    }
  }

  const tabs = scope.querySelectorAll<HTMLElement>(
    '[role="tab"], [class*="tab"], [class*="Tab"], button, [role="button"]',
  );
  for (const tab of tabs) {
    const text = tab.textContent?.trim() || '';
    if (KUAISHOU_UPLOAD_TAB_TEXTS.some((tabText) => text.includes(tabText)) && isClickableKuaishouElement(tab)) {
      return tab;
    }
  }

  const textElement = findKuaishouTextElement(scope, KUAISHOU_UPLOAD_TAB_TEXTS);
  return textElement?.closest<HTMLElement>('[role="tab"], [class*="tab"], [class*="Tab"], button, [role="button"]') || textElement;
}

/** 等待已上传封面的预览在弹窗内就绪 */
async function waitForKuaishouUploadedCoverPreview(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dialog = findKuaishouCoverDialog();
    if (!dialog) return true;
    if (isKuaishouUploadTabActive(dialog) && isKuaishouUploadedCoverPreviewReady(dialog)) return true;
    await waitForIdle(250);
  }
  return false;
}

/** 判断弹窗内上传封面的预览是否已渲染 */
function isKuaishouUploadedCoverPreviewReady(dialog: HTMLElement) {
  const uploadPanels = dialog.querySelectorAll<HTMLElement>(
    '[class*="cropper-upload"], [class*="upload"]',
  );
  for (const panel of uploadPanels) {
    if (!isVisible(panel)) continue;
    const text = panel.textContent?.replace(/\s+/g, '') || '';
    const hasEmptyPrompt = text.includes('拖拽图片到此') || text.includes('点击上传') || text.includes('选择图片');
    const hasClearAction = text.includes('清空上传');
    const hasPreview = Boolean(panel.querySelector('canvas, img, [class*="cropper"], [class*="preview"], [class*="cutter"]'));
    if (!hasEmptyPrompt && (hasClearAction || hasPreview)) return true;
  }
  return false;
}

/** 在指定作用域内按文案查找可点击的元素 */
function findKuaishouTextElement(scope: HTMLElement, texts: string[]) {
  const elements = scope.querySelectorAll<HTMLElement>(
    'button, [role="button"], [role="tab"], [class*="header-title-item"], span, div',
  );
  for (const element of elements) {
    const text = element.textContent?.trim() || '';
    if (texts.includes(text) && isClickableKuaishouElement(element)) return element;
  }
  return null;
}

/** 在指定作用域内按文案查找入口元素（优先按钮类元素） */
function findKuaishouTextEntry(scope: ParentNode, texts: string[]) {
  const preferredElements = scope.querySelectorAll<HTMLElement>(
    'button, [role="button"], a, [class*="button"], [class*="btn"]',
  );
  const preferred = findMatchingKuaishouEntry(preferredElements, texts, false);
  if (preferred) return preferred;

  const leafElements = scope.querySelectorAll<HTMLElement>('span, div, [class*="cover"]');
  return findMatchingKuaishouEntry(leafElements, texts, true);
}

/** 从元素列表中按文案匹配可点击的入口元素 */
function findMatchingKuaishouEntry(elements: NodeListOf<HTMLElement>, texts: string[], requireLeafText: boolean) {
  for (const element of elements) {
    const text = element.textContent?.replace(/\s+/g, '') || '';
    if (!texts.some((targetText) => text.includes(targetText))) continue;
    if (requireLeafText && (text.length > 24 || element.children.length > 1)) continue;
    if (!isClickableKuaishouElement(element)) continue;
    return (
      element.closest<HTMLElement>('button, [role="button"], a, [class*="button"], [class*="btn"]') ||
      element
    );
  }
  return null;
}

/** 判断元素是否可见且可点击（非禁用、有尺寸） */
function isClickableKuaishouElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const disabled =
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.className.includes('disabled') ||
    (element instanceof HTMLButtonElement && element.disabled);
  return !disabled && isVisible(element) && rect.width > 0 && rect.height > 0;
}

/** 点击元素（优先 CDP，失败则派发自定义鼠标事件） */
async function clickKuaishouElement(element: HTMLElement) {
  scrollIntoView(element);
  await waitForIdle(120);

  const clickedByCdp = await cdpClickElement(element);
  if (clickedByCdp) return;

  const rect = element.getBoundingClientRect();
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

  element.focus();
  element.dispatchEvent(new PointerEvent('pointerdown', eventInit));
  element.dispatchEvent(new MouseEvent('mousedown', eventInit));
  element.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));
}

/** 等待快手封面弹窗关闭 */
async function waitForKuaishouCoverDialogClosed(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!findKuaishouCoverDialog()) return true;
    await waitForIdle(250);
  }
  return false;
}

/** 获取当前封面区域图片 src 的拼接签名，用于对比变化 */
function getKuaishouCoverSignature() {
  const coverRoot = document.querySelector('[class*="high-cover-editor"], [class*="default-cover"]') || document;
  const images = Array.from(coverRoot.querySelectorAll<HTMLImageElement>('img'))
    .map((img) => img.currentSrc || img.src)
    .filter(Boolean);
  return images.join('|');
}

/** 等待封面预览签名发生变化（确认上传生效） */
async function waitForKuaishouCoverPreviewChange(beforeSignature: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentSignature = getKuaishouCoverSignature();
    if (currentSignature && currentSignature !== beforeSignature) return true;
    await waitForIdle(500);
  }
  return false;
}

/** 填充快手发布内容（标题、描述、封面、可见性、定时、原创声明等） */
export async function fillKuaishouContent(config: PlatformConfig, content: ContentData, isArticle: boolean = false) {
  let uploadMessage = '';
  let coverMessage = '';
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

  if (fields.description && content.description) {
    await fillField(fields.description, content.description);
    await humanDelay();
  }

  // 图文不需要上传封面（从已上传图片中选择）
  if (!isArticle && !isImagePost) {
    coverMessage = await uploadKuaishouCover(config, content);
    if (coverMessage) {
      await humanDelay();
    }
  }

  if (fields.visibility && content.visibility) {
    await fillVisibility(config, content.visibility);
    await humanDelay();
  }

  if (fields.scheduled && content.scheduledAt) {
    await fillScheduled(config, content.scheduledAt);
    await humanDelay();
  }

  if (fields.originalDeclare && content.originalDeclare) {
    await fillOriginalDeclare(config);
    await humanDelay();
  }

  if (fields.declaration) {
    const defaultText = fields.declaration.选项文本 || '内容无需标注';
    await fillDeclarationDropdown(config, defaultText);
    await humanDelay();
  }

  await fillPlatformSettings(config, content.platformSettings?.[config.id] ?? {});
  await humanDelay();

  return composePublishMessage(uploadMessage, coverMessage);
}
