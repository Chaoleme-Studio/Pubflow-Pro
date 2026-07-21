import { cdpClickElement, cdpDragElement } from '../../content/cdp';
import { fillDescriptionWithTopicsByTrustedInput, fillField, humanDelay } from '../../content/fieldFiller';
import { uploadVideoIfAvailable } from '../../content/videoUploader';
import { fillArticleBodyAsText, extractBase64ImagesAsFiles } from '../../content/articleBodyFiller';
import { composePublishMessage, waitForArticleEditorReady, waitForEditorReady } from '../../content/publishSteps';
import { findVisibleElement, isVisible, scrollIntoView, waitForIdle } from '../../content/dom';
import { loadFileForTransfer } from '../../storage/videoTransferStorage';
import type { ContentData } from '../../types';
import type { PlatformConfig } from '../types';

/** 上传知乎封面（文章页直接注入 input，视频页通过弹窗选择本地上传）。 */
async function uploadZhihuCover(
  config: PlatformConfig,
  content: ContentData,
  fields: PlatformConfig['fields'] = config.fields,
  isArticle: boolean = false,
) {
  if (!content.coverCacheId || !fields.cover) return '';

  const file = await loadFileForTransfer(content.coverCacheId);
  if (!file) return '封面缓存不存在，跳过封面上传。';

  // 知乎文章页和视频页的封面是两套组件：
  // - 文章页：常驻隐藏 input.UploadPicture-input，直接选择文件后自动生成封面预览。
  // - 视频页：点击封面入口打开"选择封面"弹窗，再切到"本地上传"并确认。
  // 文章模式如果没有命中文章 input，直接报错；不要继续打开视频封面弹窗。
  const articleCoverInput = findZhihuArticleCoverInput(fields);
  if (articleCoverInput) {
    const beforeSignature = getZhihuArticleCoverSignature();
    await injectFileToInput(articleCoverInput, file);
    const ready = await waitForZhihuArticleCoverPreview(beforeSignature, 20000);
    return ready ? '文章封面已上传。' : '文章封面已注入，请检查封面预览。';
  }
  if (isArticle) return '没有找到知乎文章封面 input。';

  const beforeSignature = getZhihuCoverSignature();
  const coverElement = findZhihuCoverEntry(fields);
  const dialog = await openZhihuCoverDialog(coverElement);
  if (!dialog) return '没有打开知乎封面选择弹窗。';

  const selected = await selectZhihuLocalUploadTab(dialog);
  if (!selected) return '没有切换到知乎封面弹窗的"本地上传"页。';

  const input = await waitForZhihuCoverInput(8000);
  if (!input) return '没有找到知乎封面弹窗内的图片 input。';

  const beforeDialogSignature = getZhihuDialogCoverSignature(dialog);
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

  // 知乎上传封面后会很快清空 input.files，但会在约 0.7s 后出现 ReactCrop + “确认选择”。
  // 这里先保留老方案的硬等待，再走状态检测；状态检测失败时仍直接找按钮点击。
  await waitForIdle(3800);
  let confirmButton =
    findZhihuCoverConfirmButton() ||
    (await waitForZhihuCoverConfirmButton(input, beforeDialogSignature, 10000, dataTransfer.files.length > 0));
  if (!confirmButton) {
    await waitForIdle(3000);
    confirmButton = findZhihuCoverConfirmButton();
  }
  if (!confirmButton) throw new Error('封面已注入，但没有等到知乎封面确认按钮可点击。');

  const currentDialog = findZhihuCoverDialog();
  if (currentDialog) {
    await centerZhihuVerticalCoverCrop(currentDialog);
    confirmButton = findZhihuCoverConfirmButton() || confirmButton;
  }

  const confirmed = await confirmZhihuCoverSelection(confirmButton, 15000);
  if (confirmed === 'button-not-found') throw new Error('封面已注入，但没有找到知乎封面弹窗的确认按钮。');
  if (confirmed === 'not-closed') throw new Error('封面已注入并多次点击确认选择，但知乎封面弹窗未关闭。');

  const changed = await waitForZhihuCoverPreviewChange(beforeSignature, 10000);
  return changed ? '封面已通过知乎封面弹窗上传并确认。' : '封面已通过知乎封面弹窗上传并确认，请检查封面预览。';
}

/** 查找知乎文章页常驻的封面 input；文章封面不需要也不应该打开视频封面弹窗。 */
function findZhihuArticleCoverInput(fields: PlatformConfig['fields']) {
  // 2026-06 实测：知乎文章页的稳定入口是 input.UploadPicture-input[type=file]，
  // accept=".jpeg, .jpg, .png"，外层文案是"添加文章封面"。
  // 先精确查这个 input，避免被外层 wrapper 或其他编辑器图片 input 抢先命中。
  const exactInput = document.querySelector<HTMLInputElement>('input.UploadPicture-input[type="file"]');
  if (isZhihuArticleCoverInput(exactInput)) return exactInput;

  const uploadPictureInputs = document.querySelectorAll<HTMLInputElement>('[class*="UploadPicture"] input[type="file"]');
  for (const input of uploadPictureInputs) {
    if (isZhihuArticleCoverInput(input)) return input;
  }

  for (const selector of fields.cover?.selectors || []) {
    // 配置层为了兼容页面灰度，可能写成逗号组合选择器。
    // 如果直接拼 `${selector} input[type=file]`，浏览器会把后半段当作独立 selector，
    // 可能命中 LABEL.UploadPicture-wrapper 而不是 input，导致文章流程掉进视频弹窗流程。
    // 因此这里必须先拆开每个 selector 再分别查 direct/nested input。
    for (const singleSelector of selector.split(',').map((part) => part.trim()).filter(Boolean)) {
      try {
        const direct = document.querySelector<HTMLElement>(singleSelector);
        if (isZhihuArticleCoverInput(direct)) return direct;
        const input = document.querySelector<HTMLInputElement>(`${singleSelector} input[type="file"]`);
        if (isZhihuArticleCoverInput(input)) return input;
      } catch {
        // 某些浏览器或页面上下文不支持组合选择器时，继续尝试兜底选择器。
      }
    }
  }

  const imageInputs = document.querySelectorAll<HTMLInputElement>(
    'input[type="file"][accept*=".jpg"], input[type="file"][accept*=".jpeg"], input[type="file"][accept*=".png"]',
  );
  for (const input of imageInputs) {
    if (isZhihuArticleCoverInput(input)) return input;
  }
  return null;
}

/** 判断 input 是否属于知乎文章封面，而不是正文图片或视频封面弹窗里的上传控件。 */
function isZhihuArticleCoverInput(element: Element | null): element is HTMLInputElement {
  // 知乎正文编辑器也可能有图片上传 input；只看 accept=image 过于宽泛。
  // 这里限定 UploadPicture class 或"添加文章封面"文案，确保拿到的是文章封面 input。
  if (!(element instanceof HTMLInputElement) || element.type !== 'file') return false;
  const accept = element.accept || '';
  if (accept.includes('video')) return false;
  const wrapper = element.closest('[class*="UploadPicture"]');
  const wrapperText = wrapper?.textContent?.replace(/\s+/g, '') || '';
  if (element.classList.contains('UploadPicture-input') || wrapperText.includes('添加文章封面')) return true;
  return accept.includes('.jpg') && accept.includes('.png');
}

/** 等待知乎文章封面预览出现或签名变化，用于确认直接 input 注入已经被页面接受。 */
async function waitForZhihuArticleCoverPreview(beforeSignature: string, timeoutMs: number) {
  // 手动实测：真实封面会先上传到知乎图片服务，然后页面生成 img "封面图"。
  // 小图标等非真实封面素材可能长期 processing，所以这里用可见预览作为成功标准，
  // 而不是要求某个接口状态或二次确认弹窗。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const signature = getZhihuArticleCoverSignature();
    if (signature && (!beforeSignature || signature !== beforeSignature || hasZhihuArticleCoverPreview())) return true;
    await waitForIdle(500);
  }
  return hasZhihuArticleCoverPreview();
}

/** 生成知乎文章封面预览签名，过滤页面 URL，保留真实图片资源。 */
function getZhihuArticleCoverSignature() {
  // 文章封面上传成功后，页面可能从 /write 自动保存成 /p/{id}/edit。
  // 过滤 zhuanlan 页面自身 URL，签名只保留真实图片 src。
  return Array.from(document.querySelectorAll<HTMLImageElement>('[class*="UploadPicture"] img, img[alt*="封面"], img'))
    .map((img) => img.currentSrc || img.src)
    .filter((src) => src && !src.includes('zhuanlan.zhihu.com/p/'))
    .join('|');
}

/** 判断知乎文章封面区域是否已经出现足够大的可见图片预览。 */
function hasZhihuArticleCoverPreview() {
  const uploadWrapper = document.querySelector('[class*="UploadPicture"]');
  const scope = uploadWrapper?.parentElement || document;
  return Array.from(scope.querySelectorAll<HTMLImageElement>('img'))
    .some((img) => {
      const src = img.currentSrc || img.src;
      const rect = img.getBoundingClientRect();
      return Boolean(src && rect.width >= 80 && rect.height >= 60);
    });
}

/** 将 File 注入 file input 并派发 input/change，模拟用户选择本地文件。 */
async function injectFileToInput(input: HTMLInputElement, file: File) {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForIdle(1200);
}

/** 查找知乎视频发布页的封面入口；文章模式不使用这个入口。 */
function findZhihuCoverEntry(fields: PlatformConfig['fields']) {
  // 视频发布页的封面入口。文章页不应该走到这里；文章模式在上面找不到 input 已经返回错误。
  return (
    findVisibleElement(fields.cover?.selectors || []) ||
    findVisibleElement([
      '.VideoUploadForm-imageEditButton',
      '[class*="VideoUploadForm-imageEditButton"]',
      '.VideoUploadForm-imageContainer',
      '[class*="VideoUploadForm-imageContainer"]',
    ])
  );
}

/** 打开知乎视频封面弹窗，等待"选择封面/本地上传"弹层出现。 */
async function openZhihuCoverDialog(coverElement?: HTMLElement) {
  const existingDialog = findZhihuCoverDialog();
  if (existingDialog) return existingDialog;
  if (!coverElement) return null;

  scrollIntoView(coverElement);
  await waitForIdle(200);
  await clickZhihuElement(coverElement);

  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    const dialog = findZhihuCoverDialog();
    if (dialog) return dialog;
    await waitForIdle(250);
  }
  return null;
}

/** 查找知乎视频封面弹窗，避免误把其他 Modal 当成封面弹窗。 */
function findZhihuCoverDialog(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>(
    '.VideoCoverEditor-Modal, [class*="VideoCoverEditor-Modal"], [class*="Modal"]',
  );
  for (const dialog of dialogs) {
    const text = dialog.textContent?.replace(/\s+/g, '') || '';
    if (isVisible(dialog) && text.includes('选择封面') && text.includes('本地上传')) return dialog;
  }
  return null;
}

/** 切换知乎视频封面弹窗到"本地上传"Tab。 */
async function selectZhihuLocalUploadTab(dialog: HTMLElement) {
  // 视频封面弹窗默认 Tab 是"从视频中截取"，必须切到"本地上传"后才会渲染图片 input。
  // 如果 input 已经存在，说明当前已经在本地上传页，直接返回。
  if (findZhihuImageInput(dialog)) return true;

  const tab = findZhihuTextElement(dialog, ['本地上传']);
  if (!tab) return false;

  await clickZhihuElement(tab);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    const currentDialog = findZhihuCoverDialog();
    if (currentDialog && findZhihuImageInput(currentDialog)) return true;
    await waitForIdle(250);
  }
  return false;
}

/** 等待知乎视频封面弹窗内的图片 file input 渲染。 */
async function waitForZhihuCoverInput(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dialog = findZhihuCoverDialog();
    const input = dialog ? findZhihuImageInput(dialog) : null;
    if (input) return input;
    await waitForIdle(250);
  }
  return null;
}

async function waitForZhihuCoverConfirmButton(
  input: HTMLInputElement,
  beforeDialogSignature: string,
  timeoutMs: number,
  fileWasInjected = false,
) {
  const startedAt = Date.now();
  let fileSeen = fileWasInjected;
  let buttonReadySince = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const dialog = findZhihuCoverDialog();
    fileSeen ||= Boolean(input.files?.length);
    if (dialog && fileSeen && !isZhihuCoverUploadBusy(dialog)) {
      const button = findZhihuButton(dialog, ['确认选择', '确认', '完成']);
      if (button && hasZhihuCoverAcceptedLocalFile(dialog, beforeDialogSignature)) return button;
      if (button) {
        buttonReadySince ||= Date.now();
        if (Date.now() - buttonReadySince >= 1200) return button;
      } else {
        buttonReadySince = 0;
      }
    } else {
      buttonReadySince = 0;
    }
    await waitForZhihuDialogMutation(Math.min(1000, Math.max(0, timeoutMs - (Date.now() - startedAt))));
  }
  return null;
}

/** 生成知乎封面弹窗内的预览签名，兼容 img/canvas/background。 */
function getZhihuDialogCoverSignature(scope: ParentNode) {
  const images = Array.from(scope.querySelectorAll<HTMLImageElement>('img'))
    .map((img) => {
      const rect = img.getBoundingClientRect();
      return `${Math.round(rect.width)}x${Math.round(rect.height)}:${img.currentSrc || img.src}`;
    })
    .filter(Boolean);
  const canvases = Array.from(scope.querySelectorAll<HTMLCanvasElement>('canvas'))
    .map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return `${canvas.width}x${canvas.height}:${Math.round(rect.width)}x${Math.round(rect.height)}`;
    })
    .filter(Boolean);
  const backgrounds = Array.from(scope.querySelectorAll<HTMLElement>('[style*="background"]'))
    .map((element) => element.style.backgroundImage || element.getAttribute('style') || '')
    .filter(Boolean);
  return [...images, ...canvases, ...backgrounds].join('|');
}

/** 判断知乎封面弹窗内是否已经出现足够大的预览/裁剪区域。 */
function hasZhihuDialogCoverPreview(dialog: HTMLElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>('img, canvas, [class*="preview"], [class*="Preview"], [class*="crop"], [class*="Crop"]'),
  ).some((element) => {
    const rect = element.getBoundingClientRect();
    return isVisible(element) && rect.width >= 48 && rect.height >= 48;
  });
}

function hasZhihuCoverAcceptedLocalFile(dialog: HTMLElement, beforeDialogSignature: string) {
  const dialogText = normalizeZhihuOptionText(dialog.textContent || '');
  const currentSignature = getZhihuDialogCoverSignature(dialog);
  return (
    dialogText.includes('重新上传') ||
    Boolean(currentSignature && currentSignature !== beforeDialogSignature) ||
    hasZhihuDialogCoverPreview(dialog)
  );
}

function isZhihuCoverUploadBusy(dialog: HTMLElement) {
  const text = normalizeZhihuOptionText(dialog.textContent || '');
  if (['上传中', '处理中', '正在上传', '加载中'].some((item) => text.includes(item))) return true;
  const busyElement = dialog.querySelector<HTMLElement>(
    '[aria-busy="true"], progress, [class*="Spin"], [class*="spin"], [class*="Loading"], [class*="loading"]',
  );
  return Boolean(busyElement && isVisible(busyElement));
}

/** 在指定范围内查找非视频的图片 file input。 */
function findZhihuImageInput(scope: ParentNode): HTMLInputElement | null {
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

type ZhihuCoverConfirmResult = 'confirmed' | 'button-not-found' | 'not-closed';

const ZHIHU_COVER_CONFIRM_TEXTS = ['确认选择', '确认', '完成'];

/**
 * 竖屏封面会在高画布中显示一个可纵向拖动的 3:4 ReactCrop 选区。
 * 在确认前将选区移动到画布中部；横屏或没有移动空间时保持平台原行为。
 */
async function centerZhihuVerticalCoverCrop(dialog: HTMLElement): Promise<boolean> {
  const cropRoot = dialog.querySelector<HTMLElement>('.ReactCrop');
  const selection = cropRoot?.querySelector<HTMLElement>('.ReactCrop__crop-selection');
  if (!cropRoot || !selection || !isVisible(cropRoot) || !isVisible(selection)) return false;

  const cropRect = cropRoot.getBoundingClientRect();
  const selectionRect = selection.getBoundingClientRect();
  const movableHeight = cropRect.height - selectionRect.height;
  const isVerticalCrop = cropRect.height > cropRect.width * 1.15;
  if (!isVerticalCrop || movableHeight <= 2) return false;

  const targetTop = cropRect.top + movableHeight / 2;
  const deltaY = targetTop - selectionRect.top;
  if (Math.abs(deltaY) <= 2) return true;

  const dragged = await cdpDragElement(selection, 0, deltaY);
  if (!dragged) return false;
  await waitForIdle(400);

  const currentDialog = findZhihuCoverDialog();
  const currentRoot = currentDialog?.querySelector<HTMLElement>('.ReactCrop');
  const currentSelection = currentRoot?.querySelector<HTMLElement>('.ReactCrop__crop-selection');
  if (!currentRoot || !currentSelection) return false;

  const currentCropRect = currentRoot.getBoundingClientRect();
  const currentSelectionRect = currentSelection.getBoundingClientRect();
  const currentTargetTop = currentCropRect.top + (currentCropRect.height - currentSelectionRect.height) / 2;
  return Math.abs(currentSelectionRect.top - currentTargetTop) <= 4;
}

function findZhihuCoverConfirmButton() {
  const dialog = findZhihuCoverDialog();
  if (!dialog) return null;
  return (
    findZhihuButton(dialog, ZHIHU_COVER_CONFIRM_TEXTS) ||
    findZhihuButtonLenient(dialog, ZHIHU_COVER_CONFIRM_TEXTS)
  );
}

/** 反复点击知乎封面确认按钮，并以弹窗关闭作为唯一成功标准。 */
async function confirmZhihuCoverSelection(
  initialButton: HTMLElement,
  timeoutMs: number,
): Promise<ZhihuCoverConfirmResult> {
  const texts = ZHIHU_COVER_CONFIRM_TEXTS;
  const startedAt = Date.now();
  let sawButton = false;
  let button: HTMLElement | null = initialButton;

  while (Date.now() - startedAt < timeoutMs) {
    if (!findZhihuCoverDialog()) return 'confirmed';

    const remainingMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
    const dialog = findZhihuCoverDialog();
    if (!dialog) return 'confirmed';

    if (!button || !button.isConnected || !isClickableZhihuElement(button)) {
      button = findZhihuButton(dialog, texts);
    }
    if (!button) {
      await waitForZhihuDialogMutation(Math.min(1000, remainingMs));
      continue;
    }

    sawButton = true;
    await clickZhihuElement(button);
    if (await waitForZhihuCoverDialogClosed(Math.min(1000, remainingMs))) return 'confirmed';

    const currentDialog = findZhihuCoverDialog();
    const currentButton = currentDialog ? findZhihuButton(currentDialog, texts) : null;
    if (currentButton && currentButton !== button) {
      button = currentButton;
      await clickZhihuElement(button);
      if (await waitForZhihuCoverDialogClosed(Math.min(900, remainingMs))) return 'confirmed';
    } else {
      button = null;
    }

    await waitForZhihuDialogMutation(Math.min(700, remainingMs));
  }

  return sawButton ? 'not-closed' : 'button-not-found';
}

/** 在知乎弹窗范围内按文本查找可点击按钮。 */
function findZhihuButton(scope: HTMLElement, texts: string[]) {
  const normalizedTexts = texts.map((text) => normalizeZhihuOptionText(text));
  const buttons = scope.querySelectorAll<HTMLElement>('button, [role="button"], [class*="Button"]');
  for (const button of buttons) {
    const text = normalizeZhihuOptionText(button.textContent || '');
    if (normalizedTexts.includes(text) && isEnabledVisibleZhihuElement(button)) return button;
  }
  return null;
}

/** 兜底：知乎按钮文案偶尔被子节点或空白拆开，这里允许包含匹配。 */
function findZhihuButtonLenient(scope: HTMLElement, texts: string[]) {
  const normalizedTexts = texts.map((text) => normalizeZhihuOptionText(text));
  const buttons = scope.querySelectorAll<HTMLElement>('button, [role="button"], [class*="Button"]');
  for (const button of buttons) {
    const text = normalizeZhihuOptionText(button.textContent || '');
    if (normalizedTexts.some((target) => text.includes(target)) && isEnabledVisibleZhihuElement(button)) {
      return button;
    }
  }
  return null;
}

/** 在知乎弹窗范围内按文本查找可点击元素，用于 Tab 或非 button 控件。 */
function findZhihuTextElement(scope: HTMLElement, texts: string[]) {
  const elements = scope.querySelectorAll<HTMLElement>('button, [role="button"], div, span, h3');
  for (const element of elements) {
    const text = element.textContent?.trim() || '';
    if (texts.includes(text) && isClickableZhihuElement(element)) return element;
  }
  return null;
}

/** 判断知乎元素是否处于可见、非禁用、可点击状态。 */
function isClickableZhihuElement(element: HTMLElement) {
  return isEnabledVisibleZhihuElement(element) && isZhihuElementCenterHitTarget(element);
}

function isEnabledVisibleZhihuElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const disabled =
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.className.includes('disabled') ||
    (element instanceof HTMLButtonElement && element.disabled);
  return (
    !disabled &&
    style.pointerEvents !== 'none' &&
    isVisible(element) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function isZhihuElementCenterHitTarget(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const hit = element.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!hit) return true;
  if (hit === element || element.contains(hit)) return true;
  const clickable = hit.closest<HTMLElement>('button, [role="button"], [class*="Button"]');
  return clickable === element || Boolean(clickable && element.contains(clickable));
}

/** 优先用 CDP 坐标点击知乎元素，失败时退回完整鼠标事件序列。 */
async function clickZhihuElement(element: HTMLElement) {
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  await waitForIdle(120);

  const clickedByCdp = await cdpClickElement(element);
  if (clickedByCdp) return;

  dispatchZhihuMouseClick(element);
}

function dispatchZhihuMouseClick(element: HTMLElement) {
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
  element.click();
}

/** 按字段 label 定位知乎视频表单项，用于视频标记、所属领域、定时发布等控件。 */
function findZhihuFormItem(labelText: string) {
  const items = document.querySelectorAll<HTMLElement>(
    '.VideoUploadForm-item, [class*="VideoUploadForm-item"], [class*="Form-item"], [class*="formItem"]',
  );
  for (const item of items) {
    const text = item.textContent?.replace(/\s+/g, '') || '';
    if (
      isVisible(item) &&
      text.includes(labelText) &&
      item.querySelector('button, [role="button"], [role="combobox"]')
    ) {
      return item;
    }
  }
  return null;
}

/** 等待知乎视频封面弹窗关闭。 */
async function waitForZhihuCoverDialogClosed(timeoutMs: number) {
  if (!findZhihuCoverDialog()) return true;
  return new Promise((resolve) => {
    let done = false;
    let observer: MutationObserver | undefined;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      observer?.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(!findZhihuCoverDialog()), timeoutMs);
    observer = new MutationObserver(() => {
      if (!findZhihuCoverDialog()) finish(true);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  });
}

function waitForZhihuDialogMutation(timeoutMs: number) {
  return new Promise<void>((resolve) => {
    let done = false;
    let observer: MutationObserver | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      observer?.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    observer = new MutationObserver(finish);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'disabled', 'aria-disabled'] });
  });
}

/** 生成知乎视频封面预览签名，判断封面是否变化。 */
function getZhihuCoverSignature() {
  const coverRoot = document.querySelector('.VideoUploadForm-imageContainer, [class*="VideoUploadForm-imageContainer"]') || document;
  const images = Array.from(coverRoot.querySelectorAll<HTMLImageElement>('img'))
    .map((img) => img.currentSrc || img.src)
    .filter(Boolean);
  return images.join('|');
}

/** 等待知乎视频封面预览从旧签名变成新签名。 */
async function waitForZhihuCoverPreviewChange(beforeSignature: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentSignature = getZhihuCoverSignature();
    if (currentSignature && currentSignature !== beforeSignature) return true;
    await waitForIdle(500);
  }
  return false;
}

/** 填充知乎视频标记弹窗，目标通常是"内容无需标注"等声明项。 */
async function fillZhihuDeclarationDropdown(config: PlatformConfig, targetText: string) {
  const declConfig = config.fields.declaration || config.fields.originalDeclare;
  if (!declConfig) return;
  if (declConfig.类型 !== 'dropdown') return;
  const normalizedTargetText = normalizeZhihuOptionText(targetText);

  const videoTypeItem = findZhihuFormItem('视频标记');
  const currentVideoType =
    videoTypeItem
      ?.querySelector<HTMLElement>('button[role="combobox"], [role="combobox"]')
      ?.textContent
      ?.trim() || '';
  if (normalizeZhihuOptionText(currentVideoType) === normalizedTargetText) return;

  const trigger =
    videoTypeItem?.querySelector<HTMLElement>(
      '.VideoUploadForm-videoTypeSelectOverlay, [aria-label*="选择视频标记"], button[role="combobox"], [role="combobox"]',
    ) ||
    document.querySelector<HTMLElement>('.VideoUploadForm-videoTypeSelectOverlay, [aria-label*="选择视频标记"]');
  if (!trigger) return;

  await clickZhihuElement(trigger);
  await humanDelay(800);

  // 检查默认选项 "内容无需标注" 是否已有勾选图标（默认已选中）
  const modalOptions = document.querySelectorAll<HTMLElement>(
    '.VideoUploadForm-videoTypeModalOption, div[role="button"]',
  );
  let alreadySelected = false;
  for (const opt of modalOptions) {
    const span = opt.querySelector('span');
    if (normalizeZhihuOptionText(span?.textContent || '') === normalizedTargetText) {
      // 检查是否有勾选 SVG 图标
      const svg = opt.querySelector('svg');
      if (svg) {
        alreadySelected = true;
      }
      break;
    }
  }

  // 如果没有默认选中，点击目标选项
  if (!alreadySelected) {
    for (const opt of modalOptions) {
      const span = opt.querySelector('span');
      const text = span?.textContent?.trim() || opt.textContent?.trim() || '';
      const normalizedText = normalizeZhihuOptionText(text);
      if (normalizedText === normalizedTargetText || normalizedText.includes(normalizedTargetText)) {
        await clickZhihuElement(opt);
        await humanDelay(500);
        break;
      }
    }
  }

  // 点击确认按钮关闭弹窗
  const confirmBtns = document.querySelectorAll<HTMLElement>(
    '.ModalButtonGroup button, button',
  );
  for (const btn of confirmBtns) {
    const text = btn.textContent?.trim() || '';
    if (text === '确认' && btn.offsetParent !== null && !btn.hasAttribute('disabled')) {
      await cdpClickElement(btn);
      await humanDelay(300);
      return;
    }
  }
}

/** 规范化知乎选项文案，消除空白对匹配的影响。 */
function normalizeZhihuOptionText(text: string) {
  return text.replace(/\s+/g, '');
}

/** 填充知乎"所属领域"下拉，限定在当前打开的 listbox 中选项，减少误点其他控件。 */
async function fillZhihuDomain(targetText: string) {
  const domainItem = findZhihuFormItem('所属领域');
  const domainCombo = domainItem?.querySelector<HTMLElement>('button[role="combobox"], [role="combobox"]') || null;
  if (!domainCombo) return;

  const currentVal = domainCombo.getAttribute('value') || domainCombo.textContent?.trim() || '';
  if (currentVal === targetText) return;

  document.body.click();
  await humanDelay(150);

  await clickZhihuElement(domainCombo);
  await humanDelay(600);

  const listboxes = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]'))
    .filter((listbox) => isVisible(listbox));
  const listbox = listboxes[listboxes.length - 1] || null;
  const scope: ParentNode = listbox || document;
  const options = scope.querySelectorAll<HTMLElement>('[role="option"]');
  for (const opt of options) {
    const optText = opt.getAttribute('value') || opt.textContent?.trim() || '';
    if (optText === targetText) {
      await clickZhihuElement(opt);
      await humanDelay(500);
      break;
    }
  }

  document.body.click();
  await humanDelay(200);
}

/** 填充知乎视频定时发布，日期、小时、分钟是独立控件，不能复用普通 input 写值。 */
async function fillZhihuScheduled(config: PlatformConfig, scheduledAt: number) {
  if (!config.fields.scheduled || !scheduledAt) return;

  // 1. 勾选定时发布开关 — checkbox 是隐藏的（宽高为0），需要点击包裹的 label
  const switchLabel = document.querySelector<HTMLElement>(
    '.VideoUploadForm-scheduledPublish--switch, label[class*="scheduledPublish"]',
  );
  if (switchLabel) {
    const checkbox = switchLabel.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox && !checkbox.checked) {
      await cdpClickElement(switchLabel);
      await humanDelay(800);
    }
  }

  const date = new Date(scheduledAt);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const targetDay = String(date.getDate());
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  // 2. 选择日期 — 点击日期按钮打开日历，再点击目标日期
  const dateBtn = Array.from(document.querySelectorAll<HTMLElement>('button')).find((btn) => {
    const text = btn.textContent?.trim() || '';
    return /^\d{4}\/\d{2}\/\d{2}$/.test(text) && btn.offsetParent !== null;
  });

  if (dateBtn) {
    const currentBtnDate = dateBtn.textContent?.trim().replace(/\//g, '-');
    if (currentBtnDate !== dateStr) {
      await cdpClickElement(dateBtn);
      await humanDelay(800);

      // 日历项是 td.Calendar-day，禁用的有 is-disabled
      const calDays = document.querySelectorAll<HTMLElement>('td.Calendar-day');
      for (const day of calDays) {
        if (day.textContent?.trim() === targetDay && !day.classList.contains('is-disabled')) {
          await cdpClickElement(day);
          await humanDelay(500);
          break;
        }
      }
    }
  }

  // 3. 选择时间 — 点击小时/分钟 combobox，再点击目标选项
  const combos = Array.from(
    document.querySelectorAll<HTMLElement>('button[role="combobox"]'),
  ).filter((el) => {
    if (!el.offsetParent) return false;
    const val = el.getAttribute('value') || el.textContent?.trim() || '';
    return /^\d{1,2}$/.test(val) && parseInt(val) < 60;
  });

  const timeComboPairs: Array<{ el: HTMLElement; target: string }> = [];
  if (combos.length >= 2) {
    timeComboPairs.push(
      { el: combos[0], target: String(hours).padStart(2, '0') },
      { el: combos[1], target: String(minutes).padStart(2, '0') },
    );
  }

  for (const { el, target } of timeComboPairs) {
    const comboText = el.getAttribute('value') || el.textContent?.trim() || '';
    if (comboText === target) continue;

    // 先关闭可能残留的下拉菜单，防止旧选项干扰
    // body.click() 会触发完整的 mousedown→mouseup→click 序列，React Select 据此关闭下拉
    document.body.click();
    await humanDelay(300);

    // 打开当前 combobox 的下拉菜单（用 JS click 而非 CDP，React Select 对 CDP 鼠标事件响应异常）
    el.click();
    await humanDelay(600);

    // 找到最新打开的 listbox，限定搜索范围，避免匹配到其他下拉菜单的选项
    const listboxes = document.querySelectorAll<HTMLElement>('[role="listbox"]');
    const listbox = listboxes.length > 0 ? listboxes[listboxes.length - 1] : null;
    const scope = listbox || document;
    const options = scope.querySelectorAll<HTMLElement>('[role="option"]');
    for (const opt of options) {
      const optText = opt.getAttribute('value') || opt.textContent?.trim() || '';
      if (optText === target) {
        opt.click();
        await humanDelay(500);
        break;
      }
    }
  }

  // 关闭可能残留的时间下拉菜单
  document.body.click();
  await humanDelay(200);
}

/** 知乎平台主流程：按文章/视频分流上传、正文、封面、视频标记、所属领域和定时发布。 */
export async function fillZhihuContent(config: PlatformConfig, content: ContentData, isArticle: boolean = false) {
  let uploadMessage = '';
  let articleBodyMessage = '';

  if (isArticle && content.imageCacheIds?.length) {
    // 文章模式：上传图片
    const { uploadImagesIfAvailable } = await import('../../content/imageUploader');
    uploadMessage = await uploadImagesIfAvailable(config, content);
    await humanDelay();
  } else if (content.videoCacheId) {
    // 视频模式：上传视频
    uploadMessage = await uploadVideoIfAvailable(config, content);
    await humanDelay();
  }

  // 根据是否是文章选择不同的字段配置
  const fields = isArticle ? (config.articleFields || config.fields) : config.fields;

  if (isArticle) {
    await waitForArticleEditorReady(config);
  } else {
    await waitForEditorReady(config);
  }

  if (fields.title && content.title) {
    await fillField(fields.title, content.title);
    await humanDelay();
  }

  // 文章模式：填充文章正文（知乎支持原生 Markdown，使用纯文本模式）
  console.info('[PubFlow][zhihu] article body check', {
    isArticle,
    hasArticleContent: Boolean(content.articleContent),
    hasArticleBodyField: Boolean(fields.articleBody),
    articleBodySelectors: fields.articleBody?.selectors,
  });
  if (isArticle && content.articleContent && fields.articleBody) {
    // 提取并去除 markdown 中的 base64 图片数据，避免插入原始 base64 文本
    const { cleanedMarkdown, files } = await extractBase64ImagesAsFiles(content.articleContent);
    // 如果有 base64 图片且之前未通过 imageCacheIds 上传，尝试通过平台文件 input 上传
    if (files.length > 0 && !content.imageCacheIds?.length) {
      const { uploadFilesViaInput } = await import('../../content/imageUploader');
      await uploadFilesViaInput(config, files);
    }
    articleBodyMessage = await fillArticleBodyAsText(fields.articleBody, cleanedMarkdown);
    await humanDelay();
  } else if (fields.description && (content.description || content.topics.length > 0)) {
    // 视频简介必须先真实点击激活，再逐个输入并确认话题。
    await fillDescriptionWithTopicsByTrustedInput(
      fields.description,
      content.description,
      content.topics,
      content.fillOptions?.topicIntervalMs,
    );
    await humanDelay();
  }

  // 知乎文章页有独立文章封面 input，视频页仍走封面弹窗。
  let coverMessage = '';
  if (!isArticle || fields.cover) {
    coverMessage = await uploadZhihuCover(config, content, fields, isArticle);
    if (coverMessage) {
      await humanDelay();
    }
  }

  if (fields.declaration) {
    const platformSettings = content.platformSettings?.zhihu ?? {};
    const targetText =
      typeof platformSettings.declaration === 'string'
        ? platformSettings.declaration
        : fields.declaration.选项文本 || '内容无需标注';
    await fillZhihuDeclarationDropdown(config, targetText);
    await humanDelay();
  }

  // 所属领域（来自平台个性化设置）
  const domain = content.platformSettings?.zhihu?.domain;
  if (typeof domain === 'string' && domain) {
    await fillZhihuDomain(domain);
    await humanDelay();
  }

  if (fields.scheduled && content.scheduledAt) {
    await fillZhihuScheduled(config, content.scheduledAt);
    await humanDelay();
  }

  return composePublishMessage(uploadMessage, coverMessage, articleBodyMessage);
}
