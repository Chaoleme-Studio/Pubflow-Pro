import { fillField, fillTopics, humanDelay } from '../../content/fieldFiller';
import { uploadVideoIfAvailable } from '../../content/videoUploader';
import { fillArticleBody } from '../../content/articleBodyFiller';
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
import { findVisibleElement, isVisible, scrollIntoView, waitForElement, waitForIdle } from '../../content/dom';
import { resolveContentFields } from '../shared';
import { loadFileForTransfer } from '../../storage/videoTransferStorage';
import type { ContentData } from '../../types';
import type { PlatformConfig } from '../types';

const BASE64_ENCODE_BATCH_SIZE = 0x8000;

/**
 * 抖音封面上传总入口。
 *
 * 这个函数同时服务视频、图文、文章三种内容类型，但三者的封面 DOM 完全不同：
 * - 视频封面：打开“设置横封面/设置竖封面”弹窗，内部是 Semi Upload 组件。
 * - 文章封面：打开“编辑封面”弹窗，点击“+替换封面”时才临时创建 file input。
 *
 * 因此先尝试文章封面专用路径；只有当前页面不是文章封面区域时，才继续走视频封面路径。
 * 不要把文章封面失败兜底成视频封面成功判断，否则会出现“代码弹出不该弹的封面窗口”的问题。
 */
/** 抖音封面上传总入口；先识别文章封面，再回退到视频封面弹窗。 */
async function uploadDouyinCover(
  config: PlatformConfig,
  content: ContentData,
  fields: PlatformConfig['fields'] = config.fields,
): Promise<string> {
  if (!content.coverCacheId || !fields.cover) return '';

  const file = await loadFileForTransfer(content.coverCacheId);
  if (!file) return '封面缓存不存在，跳过封面上传。';

  const articleCoverMessage = await uploadDouyinArticleCover(fields, file);
  if (articleCoverMessage) return articleCoverMessage;

  // 1. 点击"选择封面"打开弹窗
  // 注意：点击事件绑定在 cover 容器内的子元素上（.cover-Jg3T4p），
  // 点击父容器无法触发弹窗，需要找到有 React click handler 的子元素。
  const coverElement = findVisibleElement(fields.cover.selectors);
  if (!coverElement) return '没有找到封面选择按钮。';
  scrollIntoView(coverElement);
  const clickTarget = coverElement.querySelector<HTMLElement>('.cover-Jg3T4p') || coverElement;
  clickTarget.click();
  await humanDelay(2000);

  // 2. 等待弹窗出现
  const dialog = await waitForElement(
    ['[role="dialog"]', '.dy-creator-content-modal', '[class*="content-modal"]'],
    5000,
  );
  if (!dialog) return '封面编辑弹窗未打开。';

  // 3. 等弹窗内的上传组件渲染完成
  const uploadArea = await waitForElement(['.semi-upload', '.dy-creator-content-modal-content .semi-upload'], 3000);
  if (!uploadArea) return '封面上传组件未就绪。';

  // 4. 上传横封面 (4:3)
  const uploaded = await uploadCoverViaBackground(file);
  if (!uploaded) return '横封面上传失败：未找到上传组件。';
  await humanDelay(2000);

  // 5. 点击"设置竖封面"进入下一步
  const nextBtn = await waitForDialogButton(['设置竖封面'], 5000);
  if (nextBtn) {
    await clickDialogButton(nextBtn);
    await waitForCoverStep('设置竖封面', 5000);

    // 6. 上传竖封面 (3:4)
    const uploadAreaV = await waitForElement(['.semi-upload'], 3000);
    const vUploaded = uploadAreaV ? await uploadCoverViaBackground(file) : false;
    if (vUploaded) {
      await humanDelay(2000);
    }
  }

  // 7. 点击"完成"确认
  const doneBtn = await waitForDialogButton(['完成'], 8000);
  if (doneBtn) {
    await clickDialogButton(doneBtn);
    const closed = await waitForCoverDialogClosed(5000);
    if (!closed) return '封面已上传，但未确认弹窗保存完成。';
  } else {
    return '封面已上传，但没有找到可点击的完成按钮。';
  }

  return '封面已上传（横版+竖版）。';
}

/** 处理抖音文章封面的专用上传路径。 */
async function uploadDouyinArticleCover(fields: PlatformConfig['fields'], file: File) {
  const coverElement = findVisibleElement(fields.cover?.selectors || []);
  if (!coverElement || !isDouyinArticleCoverEntry(coverElement)) return '';

  const beforeSignature = getDouyinArticleCoverSignature(coverElement);
  scrollIntoView(coverElement);

  // 抖音文章页同一块封面区域里有两个看起来可点击的文案：
  // “点击上传封面图”在实测中不稳定，真正能打开编辑器的是“选择封面”。
  // 这里仍按多个候选顺序尝试，避免抖音灰度 class 或文案时直接失效。
  const clickTargets = [
    ...findDouyinArticleCoverClickTargets(coverElement, ['编辑封面', '选择封面', '点击上传封面图', '上传封面图']),
    coverElement.querySelector<HTMLElement>('[class*="clickable"]'),
    coverElement.querySelector<HTMLElement>('[class*="mycard-info"]'),
    coverElement.querySelector<HTMLElement>('[class*="cover"]'),
    coverElement,
  ].filter((element): element is HTMLElement => Boolean(element));

  for (const target of clickTargets) {
    await clickDialogButton(target);
    await openDouyinArticleCoverUploadStep();
    const uploaded = await waitAndUploadDouyinArticleCover(file, 10000);
    if (uploaded) {
      await completeDouyinArticleCoverEditor(15000);
      const changed = await waitForDouyinArticleCoverChange(beforeSignature, 20000, coverElement);
      return changed ? '抖音文章封面已上传。' : '抖音文章封面已注入，请检查封面预览。';
    }
  }

  return '抖音文章封面编辑器已打开，请手动选择本地封面文件。';
}

/** 打开抖音文章封面编辑器里的上传步骤，触发“+替换封面”生成临时 file input。 */
async function openDouyinArticleCoverUploadStep() {
  const editor = await waitForDouyinArticleCoverEditor(5000);
  if (!editor) return false;

  // 已有封面或打开编辑器后，抖音会显示“+替换封面”。
  // 点击它不会留下常驻 input，而是在 click 过程中临时创建一个 input[type=file]。
  // 真正注入文件的动作在 pageWorld 的 injectDouyinArticleCover 中完成。
  const replaceButton = findTextButtonInScope(editor, ['+替换封面', '替换封面']);
  if (replaceButton) {
    await clickDialogButton(replaceButton);
    await waitForIdle(800);
  }

  const uploadButton = findTextButtonInScope(editor, ['上传图片', '点击上传图片']);
  if (uploadButton) {
    await clickDialogButton(uploadButton);
    await waitForIdle(800);
  }

  return true;
}

/** 等待抖音文章“编辑封面”弹窗出现。 */
async function waitForDouyinArticleCoverEditor(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const editor = findDouyinArticleCoverEditor();
    if (editor) return editor;
    await waitForIdle(250);
  }
  return null;
}

/** 查找抖音文章封面编辑器；它和视频封面弹窗文案不同，不能共用视频弹窗判断。 */
function findDouyinArticleCoverEditor() {
  const candidates = document.querySelectorAll<HTMLElement>(
    '[class*="modalContainer"], [class*="modalOverlay"], [role="dialog"], [class*="Modal"], [class*="modal"]',
  );
  for (const candidate of candidates) {
    const text = candidate.textContent?.replace(/\s+/g, '') || '';
    if (isVisible(candidate) && text.includes('编辑封面') && text.includes('完成')) return candidate;
  }
  return null;
}

/** 在指定弹窗范围内按文案找可点击元素，兼容按钮由 div/span 伪装的情况。 */
function findTextButtonInScope(scope: HTMLElement, texts: string[]) {
  const elements = scope.querySelectorAll<HTMLElement>('button, [role="button"], span, div');
  for (const element of elements) {
    const text = element.textContent?.replace(/\s+/g, '') || '';
    if (!texts.some((target) => text === target || text.includes(target))) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    return element;
  }
  return null;
}

/** 点击抖音文章封面编辑器“完成”，等待弹窗进入保存或关闭状态。 */
async function completeDouyinArticleCoverEditor(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const editor = findDouyinArticleCoverEditor();
    const done = editor ? findTextButtonInScope(editor, ['完成']) : null;
    if (done) {
      await clickDialogButton(done);
      await waitForIdle(1200);
      return true;
    }
    if (!editor) return true;
    await waitForIdle(250);
  }
  return false;
}

/** 判断当前封面区域是否属于抖音文章封面，而不是视频封面设置入口。 */
function isDouyinArticleCoverEntry(element: HTMLElement) {
  const text = element.textContent?.replace(/\s+/g, '') || '';
  return text.includes('上传封面') || text.includes('编辑封面') || element.className.includes('content-upload');
}

/** 按文案收集抖音文章封面区域内可能真正绑定 click handler 的子节点。 */
function findDouyinArticleCoverClickTargets(root: HTMLElement, texts: string[]) {
  const targets: HTMLElement[] = [];
  const candidates = root.querySelectorAll<HTMLElement>('button, span, div, [role="button"], [class*="mycard-info"]');
  for (const candidate of candidates) {
    const text = candidate.textContent?.replace(/\s+/g, '') || '';
    if (!texts.some((target) => text.includes(target))) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (targets.includes(candidate)) continue;
    targets.push(candidate);
  }
  return targets;
}

/** 兼容抖音将文章封面改成常驻 input 的灰度场景，直接注入文件。 */
async function uploadDouyinArticleCoverViaInput(file: File) {
  const input = findDouyinArticleImageInput();
  if (!input) return false;

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForIdle(1500);
  return true;
}

/** 等待并尝试完成抖音文章封面上传，按主世界临时 input、常驻 input、视频 Semi Upload 依次兜底。 */
async function waitAndUploadDouyinArticleCover(file: File, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    // 文章封面专用：主世界拦截临时 file input 的 click 并派发 change。
    // 这是当前抖音文章页最稳定的路径，因为 input 选择完文件后会从 DOM 移除。
    const articleUploaded = await uploadDouyinArticleCoverViaBackground(file);
    if (articleUploaded) return true;

    // 兼容兜底：如果抖音某次灰度改成常驻 input，就直接注入 input。
    const inputUploaded = await uploadDouyinArticleCoverViaInput(file);
    if (inputUploaded) return true;

    // 视频封面兜底：只在前两种文章路径失败时尝试。
    // 这依赖 Semi Upload fiber，适用于视频横/竖封面弹窗，不是文章封面的主路径。
    const backgroundUploaded = await uploadCoverViaBackground(file);
    if (backgroundUploaded) return true;

    await waitForIdle(500);
  }
  return false;
}

/** 将抖音文章封面 File 转成 base64，交给 background 在 MAIN world 捕获临时 input。 */
async function uploadDouyinArticleCoverViaBackground(file: File): Promise<boolean> {
  // content script 与页面 React 运行在隔离世界，无法直接改页面原型或 React 状态。
  // 这里把 File 转成 base64 交给 background，再由 chrome.scripting 在 MAIN world 执行。
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_ENCODE_BATCH_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_ENCODE_BATCH_SIZE));
  }
  const base64 = btoa(binary);

  try {
    const response = await browser.runtime.sendMessage({
      type: 'DOUYIN_UPLOAD_ARTICLE_COVER',
      payload: {
        fileName: file.name,
        fileType: file.type,
        fileDataBase64: base64,
      },
    });
    const typedResponse = response as { ok?: boolean; data?: { ok?: boolean; error?: string }; error?: string };
    const result = typedResponse?.data;
    if (!typedResponse?.ok || result?.ok === false) {
      console.warn('[PubFlow] douyin article cover upload failed', result?.error || typedResponse?.error || 'unknown error');
      return false;
    }
    return result?.ok ?? false;
  } catch (error) {
    console.warn('[PubFlow] douyin article cover upload message failed', error);
    return false;
  }
}

/** 查找抖音文章封面图片 input；正常版本多半找不到，因为 input 是点击时临时创建的。 */
function findDouyinArticleImageInput() {
  // 目前文章封面 input 是临时创建的，正常情况下这里会找不到。
  // 保留这个函数是为了兼容将来抖音把文章封面改成常驻 input 的灰度版本。
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const input of inputs) {
    const accept = input.accept || '';
    if ((accept.includes('image') || accept.includes('.jpg') || accept.includes('.png')) && !accept.includes('video')) {
      return input;
    }
  }
  return null;
}

/** 生成抖音文章封面区域签名，用于判断“完成”后预览是否变化。 */
function getDouyinArticleCoverSignature(root: ParentNode = document) {
  // 抖音文章封面编辑完成后，封面区域可能表现为 img，也可能表现为 background-image。
  // 用二者合并成签名，避免只看 img 时误判“封面没有变化”。
  const values = Array.from(root.querySelectorAll<HTMLElement>('[style*="background"], img'))
    .map((element) => {
      if (element instanceof HTMLImageElement) return element.currentSrc || element.src || '';
      return element.style.backgroundImage || element.getAttribute('style') || '';
    })
    .filter(Boolean);
  return values.join('|');
}

/** 等待抖音文章封面签名变化。 */
async function waitForDouyinArticleCoverChange(beforeSignature: string, timeoutMs: number, root: ParentNode = document) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentSignature = getDouyinArticleCoverSignature(root);
    if (currentSignature && currentSignature !== beforeSignature) return true;
    await waitForIdle(500);
  }
  return false;
}

/** 通过 background 在页面主世界注入 React fiber 文件，绕过 content script 隔离限制。 */
async function uploadCoverViaBackground(file: File): Promise<boolean> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_ENCODE_BATCH_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_ENCODE_BATCH_SIZE));
  }
  const base64 = btoa(binary);

  try {
    const response = await browser.runtime.sendMessage({
      type: 'DOUYIN_UPLOAD_COVER',
      payload: {
        fileName: file.name,
        fileType: file.type,
        fileDataBase64: base64,
      },
    });
    const typedResponse = response as { ok?: boolean; data?: { ok?: boolean; error?: string }; error?: string };
    const result = typedResponse?.data;
    if (!typedResponse?.ok || result?.ok === false) {
      console.warn('[PubFlow] douyin cover upload failed', result?.error || typedResponse?.error || 'unknown error');
      return false;
    }
    return result?.ok ?? false;
  } catch (error) {
    console.warn('[PubFlow] douyin cover upload message failed', error);
    return false;
  }
}

/** 在封面弹窗中按文本查找可点击按钮。 */
function findDialogButton(texts: string[]): HTMLElement | null {
  const dialog = findCoverDialog();
  const scope = dialog || document;
  const buttons = scope.querySelectorAll<HTMLElement>('button, [role="button"]');
  for (const btn of buttons) {
    const text = btn.textContent?.trim() || '';
    if (texts.includes(text) && isClickableDialogButton(btn)) {
      return btn;
    }
  }
  return null;
}

/** 查找抖音视频封面编辑弹窗。 */
function findCoverDialog(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>(
    '.dy-creator-content-modal-content, .dy-creator-content-modal, [role="dialog"]',
  );
  for (const dialog of dialogs) {
    const text = dialog.textContent?.trim() || '';
    if (
      dialog.offsetParent !== null &&
      text.includes('设置横封面') &&
      text.includes('设置竖封面')
    ) {
      return dialog;
    }
  }
  return null;
}

/** 轮询等待弹窗中出现指定文本的按钮。 */
async function waitForDialogButton(texts: string[], timeoutMs: number): Promise<HTMLElement | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const button = findDialogButton(texts);
    if (button) return button;
    await waitForIdle(250);
  }
  return null;
}

/** 判断弹窗按钮是否可见且可点击。 */
function isClickableDialogButton(button: HTMLElement) {
  const rect = button.getBoundingClientRect();
  const disabled =
    button.hasAttribute('disabled') ||
    button.getAttribute('aria-disabled') === 'true' ||
    button.className.includes('disabled') ||
    button.className.includes('loading') ||
    (button instanceof HTMLButtonElement && button.disabled);

  return (
    !disabled &&
    button.offsetParent !== null &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/** 点击弹窗按钮；优先尝试 CDP 可信点击，失败再派发自定义鼠标事件。 */
async function clickDialogButton(button: HTMLElement) {
  scrollIntoView(button);
  await waitForIdle(120);
  const clickedByCdp = await cdpClickElement(button);
  if (clickedByCdp) return;

  const rect = button.getBoundingClientRect();
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

  button.focus();
  button.dispatchEvent(new PointerEvent('pointerdown', eventInit));
  button.dispatchEvent(new MouseEvent('mousedown', eventInit));
  button.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0 }));
  button.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
  button.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));
}

/** 获取封面弹窗当前活跃步骤的文本。 */
function getActiveCoverStepText() {
  const dialog = findCoverDialog();
  const scope = dialog || document;
  const activeStep = scope.querySelector<HTMLElement>('[class*="step"][class*="active"]');
  return activeStep?.textContent?.trim() || '';
}

/** 轮询等待封面编辑进入指定步骤。 */
async function waitForCoverStep(text: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (getActiveCoverStepText().includes(text)) return true;
    await waitForIdle(250);
  }
  return false;
}

/** 轮询等待封面编辑弹窗关闭。 */
async function waitForCoverDialogClosed(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dialog = findCoverDialog();
    if (!dialog || dialog.offsetParent === null) return true;
    await waitForIdle(250);
  }
  return false;
}

/** 填充抖音的自主声明/内容标记选项。 */
async function fillDouyinDeclaration(config: PlatformConfig, targetText: string) {
  if (!config.fields.declaration) return;
  const normalizedTargetText = normalizeDouyinDeclarationText(targetText);

  const dialog = findDouyinDeclarationDialog();
  if (!dialog) {
    const trigger = findDouyinDeclarationTrigger(config);
    if (!trigger) {
      await fillDeclarationDropdown(config, normalizedTargetText);
      return;
    }
    await clickDialogButton(trigger);
    await waitForIdle(500);
  }

  const openedDialog = await waitForDouyinDeclarationDialog(3000);
  if (!openedDialog) {
    await fillDeclarationDropdown(config, normalizedTargetText);
    return;
  }

  const option = findDouyinDeclarationOption(openedDialog, normalizedTargetText);
  if (!option) return;

  await clickDialogButton(option);
  await waitForIdle(300);

  const confirmButton = findDouyinDeclarationConfirmButton(openedDialog);
  if (confirmButton) {
    await clickDialogButton(confirmButton);
  }
}

/** 规范化声明文案，适配抖音不同版本的文案差异。 */
function normalizeDouyinDeclarationText(targetText: string) {
  const compact = targetText.replace(/\s+/g, '');
  if (compact === '内容含AI生成') return '内容由AI生成';
  if (compact === '内容为虚构演绎') return '虚构演绎，仅供娱乐';
  if (compact === '内容含商业推广') return '内容含营销推广信息';
  return targetText;
}

/** 查找抖音声明设置的触发按钮。 */
function findDouyinDeclarationTrigger(config: PlatformConfig): HTMLElement | null {
  const selectors = config.fields.declaration?.触发器.split(',').map((selector) => selector.trim()) || [];
  for (const selector of selectors) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    for (const element of elements) {
      const text = element.textContent?.replace(/\s+/g, '') || '';
      if (
        isClickableDialogButton(element) &&
        (text.includes('自主声明') ||
          text.includes('无需添加自主声明') ||
          text.includes('AI生成') ||
          text.includes(targetDeclarationText(config)))
      ) {
        return element;
      }
    }
  }
  return null;
}

/** 获取当前配置的抖音声明目标文本。 */
function targetDeclarationText(config: PlatformConfig) {
  return config.fields.declaration?.选项文本 || '无需添加自主声明';
}

/** 查找抖音声明选择弹窗。 */
function findDouyinDeclarationDialog(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>(
    '[role="modal"], [role="dialog"], .semi-modal-wrap, .semi-modal, .semi-modal-content',
  );
  for (const dialog of dialogs) {
    const text = dialog.textContent?.replace(/\s+/g, '') || '';
    if (isVisible(dialog) && text.includes('请选择声明类型') && text.includes('内容由AI生成')) {
      return dialog;
    }
  }
  return null;
}

/** 轮询等待抖音声明选择弹窗出现。 */
async function waitForDouyinDeclarationDialog(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dialog = findDouyinDeclarationDialog();
    if (dialog) return dialog;
    await waitForIdle(250);
  }
  return null;
}

/** 在声明弹窗中查找匹配目标文本的选项。 */
function findDouyinDeclarationOption(dialog: HTMLElement, targetText: string): HTMLElement | null {
  const inputs = dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  for (const input of inputs) {
    const label = input.closest<HTMLElement>('label') || input.parentElement;
    const text = label?.textContent?.replace(/\s+/g, '') || '';
    if (label && (text === targetText || text.includes(targetText) || targetText.includes(text))) {
      return label;
    }
  }

  const options = dialog.querySelectorAll<HTMLElement>('label, [role="radio"], [class*="radio"], [class*="option"]');
  for (const option of options) {
    const text = option.textContent?.replace(/\s+/g, '') || '';
    if (isClickableDialogButton(option) && (text === targetText || text.includes(targetText))) {
      return option;
    }
  }
  return null;
}

/** 在声明弹窗中查找确认按钮。 */
function findDouyinDeclarationConfirmButton(dialog: HTMLElement): HTMLElement | null {
  const buttons = dialog.querySelectorAll<HTMLElement>('button, [role="button"]');
  for (const button of buttons) {
    const text = button.textContent?.trim() || '';
    if ((text === '确定' || text === '确认') && isClickableDialogButton(button)) return button;
  }
  return null;
}

/** 填充抖音视频/图文/文章发布页的全部字段。 */
export async function fillDouyinContent(config: PlatformConfig, content: ContentData, isArticle: boolean = false) {
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
  console.info('[PubFlow][douyin] article body check', {
    isArticle,
    hasArticleContent: Boolean(content.articleContent),
    hasArticleBodyField: Boolean(fields.articleBody),
    articleBodySelectors: fields.articleBody?.selectors,
  });
  if (isArticle && content.articleContent && fields.articleBody) {
    articleBodyMessage = await fillArticleBody(fields.articleBody, content.articleContent);
    await humanDelay();
  } else if (fields.description && content.description) {
    // 视频/图文模式：填充简介
    await fillField(fields.description, content.description);
    await humanDelay();
  }

  const topicField = fields.tags || fields.topics;
  if (topicField && content.topics.length > 0) {
    await fillTopics(topicField, content.topics);
    await humanDelay();
  }

  // 抖音视频、图文、文章都有独立封面入口；文章封面是必填项。
  // uploadDouyinCover 内部会先识别文章封面，再回退到视频封面弹窗。
  if (fields.cover) {
    coverMessage = await uploadDouyinCover(config, content, fields);
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

  const platformSettings = content.platformSettings?.[config.id] ?? {};
  if (fields.declaration) {
    const targetText =
      typeof platformSettings.declaration === 'string'
        ? platformSettings.declaration
        : fields.declaration.选项文本 || '无需添加自主声明';
    await fillDouyinDeclaration(config, targetText);
    await humanDelay();
  }

  const remainingSettings = { ...platformSettings };
  delete remainingSettings.declaration;
  await fillPlatformSettings(config, remainingSettings);
  await humanDelay();

  return composePublishMessage(uploadMessage, coverMessage, articleBodyMessage);
}
