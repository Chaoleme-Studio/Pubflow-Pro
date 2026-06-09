import { fillField, humanDelay } from '../../content/fieldFiller';
import { uploadVideoIfAvailable } from '../../content/videoUploader';
import { fillArticleBodyPlainParagraphs } from '../../content/articleBodyFiller';
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
import { resolveContentFields } from '../shared';
import { loadFileForTransfer } from '../../storage/videoTransferStorage';
import type { ContentData } from '../../types';
import type { PlatformConfig } from '../types';

async function uploadBilibiliCover(
  config: PlatformConfig,
  content: ContentData,
  fields: PlatformConfig['fields'] = config.fields,
) {
  if (!content.coverCacheId || !fields.cover) return '';

  const file = await loadFileForTransfer(content.coverCacheId);
  if (!file) return '封面缓存不存在，跳过封面上传。';

  const articleCoverMessage = await uploadBilibiliArticleCover(file);
  if (articleCoverMessage) return articleCoverMessage;

  const coverElement = findBilibiliCoverEntry(fields);
  const beforeSignature = getBilibiliCoverSignature();
  const editor = await openBilibiliCoverEditor(coverElement);
  if (!editor) return '没有打开 B 站封面制作面板。';

  const input = await waitForBilibiliCoverInput(8000);
  if (!input) return '没有找到 B 站封面制作面板内的图片 input。';

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForIdle(1800);

  const settings = content.platformSettings?.bilibili || {};
  const autoSyncSpaceCover = settings.autoSyncSpaceCover !== false;

  const doneButton = await waitForBilibiliDoneButton(12000);
  if (!doneButton) return '封面已注入，但没有找到 B 站封面制作面板的完成按钮。';

  await clickBilibiliElement(doneButton);
  await waitForBilibiliCoverProcessing(30000);
  if (autoSyncSpaceCover) {
    await confirmBilibiliSpaceCoverSync(8000);
  }
  const closed = await waitForBilibiliCoverEditorClosed(30000);
  const changed = await waitForBilibiliCoverPreviewChange(beforeSignature, 8000);
  if (!closed) return '封面已注入并点击完成，但 B 站封面制作面板未关闭。';
  return changed ? '封面已通过 B 站封面制作面板上传并完成。' : '封面已通过 B 站封面制作面板上传并完成，请检查封面预览。';
}

/**
 * 上传 B站专栏封面。
 * 专栏封面在文章 iframe 的发布设置里，先打开“自定义封面”开关，再等待上传 input 出现。
 */
async function uploadBilibiliArticleCover(file: File) {
  const articleDoc = findBilibiliArticleDocument();
  if (!articleDoc) return '';

  const customCoverItem = findBilibiliArticleFormItem(articleDoc, '自定义封面');
  if (!customCoverItem) return '';

  await enableBilibiliArticleSwitch(customCoverItem);

  const input = await waitForBilibiliArticleCoverInput(articleDoc, customCoverItem, 12000);
  if (!input) return 'B站专栏自定义封面开关已打开，请继续选择封面。';

  const beforeSignature = getBilibiliCoverSignature(articleDoc);
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForIdle(1800);

  const changed = await waitForBilibiliCoverPreviewChange(beforeSignature, 12000, articleDoc);
  return changed ? 'B站专栏封面已上传。' : 'B站专栏封面已注入，请检查封面预览。';
}

/** 查找 B站专栏编辑器文档；顶层页面和 /york/read-editor 同源 iframe 都可能运行 content script。 */
function findBilibiliArticleDocument() {
  if (location.href.includes('/york/read-editor')) return document;

  const iframe = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'))
    .find((frame) => frame.src.includes('/york/read-editor'));
  try {
    return iframe?.contentDocument || null;
  } catch {
    return null;
  }
}

/** 按 label 文案查找 B站专栏发布设置项，例如“自定义封面”“定时发布”。 */
function findBilibiliArticleFormItem(doc: Document, labelText: string) {
  const items = doc.querySelectorAll<HTMLElement>('.form-item, [class*="form-item"]');
  for (const item of items) {
    const label = item.querySelector<HTMLElement>('.form-item-label, label');
    const text = label?.textContent?.trim() || item.textContent?.trim() || '';
    if (text.includes(labelText)) return item;
  }
  return null;
}

/** 打开 B站专栏设置项里的开关，已打开时不重复点击。 */
async function enableBilibiliArticleSwitch(formItem: HTMLElement) {
  const switchEl = formItem.querySelector<HTMLElement>('.vui_switch--switch, [class*="switch"]');
  if (!switchEl) return false;
  if (switchEl.getAttribute('aria-checked') === 'true' || switchEl.className.includes('is-checked')) return true;
  await clickBilibiliElement(switchEl);
  await waitForIdle(800);
  return switchEl.getAttribute('aria-checked') === 'true' || switchEl.className.includes('is-checked');
}

/** 打开 B站专栏的定时发布开关；具体日期时间选择后续再由专栏专用逻辑处理。 */
async function fillBilibiliArticleScheduled(
  fields: PlatformConfig['fields'],
) {
  const articleDoc = findBilibiliArticleDocument();
  if (!articleDoc) return false;
  if (!fields.scheduled) return false;

  const scheduledItem = findBilibiliArticleFormItem(articleDoc, '定时发布');
  if (!scheduledItem) return false;

  await enableBilibiliArticleSwitch(scheduledItem);
  await waitForIdle(800);

  if (!isBilibiliArticleSwitchEnabled(scheduledItem)) return false;
  return true;
}

/** 判断 B站专栏发布设置开关是否处于打开态。 */
function isBilibiliArticleSwitchEnabled(formItem: HTMLElement) {
  const switchEl = formItem.querySelector<HTMLElement>('.vui_switch--switch, [class*="switch"]');
  return Boolean(switchEl?.getAttribute('aria-checked') === 'true' || switchEl?.className.includes('is-checked'));
}

/** 等待 B站专栏封面 input 出现；首次未渲染时会点击封面上传区域触发 input。 */
async function waitForBilibiliArticleCoverInput(doc: Document, formItem: HTMLElement, timeoutMs: number) {
  const startedAt = Date.now();
  let uploadAreaClicked = false;
  while (Date.now() - startedAt < timeoutMs) {
    const input = doc.querySelector<HTMLInputElement>(
      'input[type="file"][accept*="image"], input[type="file"][accept*=".jpg"], input[type="file"][accept*=".png"]',
    );
    if (input && !input.accept.includes('video')) return input;

    if (!uploadAreaClicked) {
      const uploadArea = formItem.querySelector<HTMLElement>(
        '.select-cover-content, .select-cover, .upload-button, [class*="select-cover"], [class*="upload-button"]',
      );
      if (uploadArea && isVisible(uploadArea)) {
        await clickBilibiliElement(uploadArea);
        uploadAreaClicked = true;
      }
    }
    await waitForIdle(250);
  }
  return null;
}

/** 打开 B站视频封面制作面板；专栏封面流程不会走这里。 */
async function openBilibiliCoverEditor(coverElement?: HTMLElement) {
  const existingEditor = findBilibiliCoverEditor();
  if (existingEditor) return existingEditor;
  if (!coverElement) return null;

  scrollIntoView(coverElement);
  await waitForIdle(300);

  const clickTarget =
    coverElement.querySelector<HTMLElement>('.cover-img, .edit-text, [class*="cover-img"]') ||
    coverElement;
  await clickBilibiliElement(clickTarget);

  const startedAt = Date.now();
  while (Date.now() - startedAt < 6000) {
    const editor = findBilibiliCoverEditor();
    if (editor) return editor;
    await waitForIdle(250);
  }
  return null;
}

/** 查找 B站视频页封面入口，配置选择器失效时使用常见 cover class 兜底。 */
function findBilibiliCoverEntry(fields: PlatformConfig['fields']) {
  return (
    findVisibleElement(fields.cover?.selectors || []) ||
    findVisibleElement([
      '.cover-img',
      '.edit-text',
      '.cover .cover-img',
      '.cover-content .cover-img',
      '.cover',
    ])
  );
}

/** 查找 B站视频“封面制作”弹窗，避免误识别普通 bcc 弹窗。 */
function findBilibiliCoverEditor(): HTMLElement | null {
  const editors = document.querySelectorAll<HTMLElement>(
    '.cover-editor, [class*="cover-editor"], .bcc-dialog__wrap',
  );
  for (const editor of editors) {
    const text = editor.textContent?.replace(/\s+/g, '') || '';
    if (isVisible(editor) && text.includes('封面制作') && text.includes('上传封面') && text.includes('完成')) {
      return editor;
    }
  }
  return null;
}

/** 等待 B站视频封面制作面板里的图片 input。 */
async function waitForBilibiliCoverInput(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const editor = findBilibiliCoverEditor();
    const input = editor?.querySelector<HTMLInputElement>(
      '.cover-upload input[type="file"][accept*="image"], input[type="file"][accept*="image/png"], input[type="file"][accept*="image/jpeg"]',
    );
    if (input && !input.accept.includes('video')) return input;
    await waitForIdle(250);
  }
  return null;
}

/** 等待 B站封面制作面板中的指定文本按钮出现。 */
async function waitForBilibiliEditorButton(texts: string[], timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const editor = findBilibiliCoverEditor();
    const button = editor ? findBilibiliTextElement(editor, texts) : null;
    if (button) return button;
    await waitForIdle(250);
  }
  return null;
}

/** 等待 B站封面制作面板的“完成”按钮可点击。 */
async function waitForBilibiliDoneButton(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const editor = findBilibiliCoverEditor();
    const button = editor ? findBilibiliSubmitButton(editor) : null;
    if (button) return button;
    await waitForIdle(250);
  }
  return null;
}

/** 优先选择 B站封面弹窗底部 submit 按钮，避免匹配到其他“完成”文案。 */
function findBilibiliSubmitButton(editor: HTMLElement) {
  const preferred = editor.querySelector<HTMLElement>('.cover-editor-button .button.submit');
  if (preferred && preferred.textContent?.trim() === '完成' && isClickableBilibiliElement(preferred)) {
    return preferred;
  }
  return findBilibiliTextElement(editor, ['完成']);
}

/** 在指定范围内按文案查找可点击元素，B站很多按钮不是原生 button。 */
function findBilibiliTextElement(scope: HTMLElement, texts: string[]) {
  const elements = scope.querySelectorAll('button, [role="button"], .button, [class*="button"], div, span');
  for (const element of elements) {
    if (!(element instanceof HTMLElement)) continue;
    const text = element.textContent?.trim() || '';
    if (texts.includes(text) && isClickableBilibiliElement(element)) return element;
  }
  return null;
}

/** 判断 B站元素是否可见、未禁用且有点击面积。 */
function isClickableBilibiliElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const disabled =
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.className.includes('disabled') ||
    (element instanceof HTMLButtonElement && element.disabled);
  return !disabled && isVisible(element) && rect.width > 0 && rect.height > 0;
}

/** 优先使用 CDP 点击 B站元素，失败后派发完整 pointer/mouse 事件。 */
async function clickBilibiliElement(element: HTMLElement) {
  scrollIntoView(element);
  await waitForIdle(120);

  const clickedByCdp = await cdpClickElement(element);
  if (clickedByCdp) return;

  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const eventView = element.ownerDocument.defaultView || window;
  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: eventView,
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

/** 等待 B站视频封面制作面板关闭。 */
async function waitForBilibiliCoverEditorClosed(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!findBilibiliCoverEditor()) return true;
    await waitForIdle(250);
  }
  return false;
}

/** 等待 B站封面制作完成；期间按钮可能显示“制作中...”，还可能弹出个人空间封面同步弹窗。 */
async function waitForBilibiliCoverProcessing(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (findBilibiliSpaceCoverSyncModal()) return true;
    const editor = findBilibiliCoverEditor();
    if (!editor) return true;
    const submit = editor.querySelector<HTMLElement>('.cover-editor-button .button.submit');
    const text = submit?.textContent?.trim() || '';
    if (text && text !== '制作中...') return true;
    await waitForIdle(500);
  }
  return false;
}

/** 确认 B站“同步到个人空间封面”弹窗。 */
async function confirmBilibiliSpaceCoverSync(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const modal = findBilibiliSpaceCoverSyncModal();
    const button = modal ? findBilibiliTextElement(modal, ['确认同步']) : null;
    if (button) {
      await clickBilibiliElement(button);
      return true;
    }
    await waitForIdle(250);
  }
  return false;
}

/** 查找 B站个人空间封面同步确认弹窗。 */
function findBilibiliSpaceCoverSyncModal(): HTMLElement | null {
  const modals = document.querySelectorAll<HTMLElement>(
    '.videoup-confirm-modal, .bcc-dialog__wrap, [class*="confirm-modal"]',
  );
  for (const modal of modals) {
    const text = modal.textContent?.replace(/\s+/g, '') || '';
    if (
      isVisible(modal) &&
      text.includes('检测到个人空间封面') &&
      text.includes('确认同步') &&
      text.includes('不同步')
    ) {
      return modal;
    }
  }
  return null;
}

/** 生成 B站封面预览签名，兼容 img 和 background-image 两种渲染方式。 */
function getBilibiliCoverSignature(root: ParentNode = document) {
  const coverRoot =
    root.querySelector?.('.cover, .cover-content, [class*="cover-content"], [class*="cover"]') ||
    root;
  const imageValues = Array.from(coverRoot.querySelectorAll<HTMLImageElement>('img'))
    .map((img) => img.currentSrc || img.src)
    .filter(Boolean);
  const backgroundValues = Array.from(coverRoot.querySelectorAll<HTMLElement>('[style*="background"]'))
    .map((el) => el.style.backgroundImage || el.getAttribute('style') || '')
    .filter(Boolean);
  return [...imageValues, ...backgroundValues].join('|');
}

/** 等待 B站封面预览签名发生变化。 */
async function waitForBilibiliCoverPreviewChange(
  beforeSignature: string,
  timeoutMs: number,
  root: ParentNode = document,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentSignature = getBilibiliCoverSignature(root);
    if (currentSignature && currentSignature !== beforeSignature) return true;
    await waitForIdle(500);
  }
  return false;
}

/**
 * B站标签填充：先清除已有自动标签（可选），再逐个填入新标签
 */
async function fillBilibiliTags(tags: string[], keepAutoTags: boolean) {
  const tagInput = document.querySelector<HTMLInputElement>('#tag-container input.input-val');
  if (!tagInput) return;

  // 清除已有的系统自动标签
  if (!keepAutoTags) {
    let existingTag = findClickableBilibiliElement('#tag-container .label-item-v2-container');
    while (existingTag) {
      existingTag.click();
      await humanDelay(200, 400);
      existingTag = findClickableBilibiliElement('#tag-container .label-item-v2-container');
    }
  }

  // 逐个填入新标签
  for (const rawTag of tags) {
    const clean = rawTag.trim().replace(/^#+/, '');
    if (!clean) continue;

    tagInput.focus();
    tagInput.value = clean;
    tagInput.dispatchEvent(new Event('input', { bubbles: true }));
    tagInput.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
    await humanDelay(400, 700);
  }
}

/** 填充 B站视频分区，下拉列表使用 title 存储真实选项文本。 */
async function fillBilibiliCategory(targetText: string) {
  const controller = findClickableBilibiliElement('.video-human-type .select-controller');
  if (!controller) return;

  const currentVal = controller.querySelector('.select-item-cont')?.textContent?.trim() || '';
  if (currentVal === targetText) return;

  controller.click();
  await humanDelay(600);

  const items = document.querySelectorAll('.drop-list-v2-container.human-type-list .drop-list-v2-item');
  for (const item of items) {
    if (!(item instanceof HTMLElement) || typeof item.click !== 'function') continue;
    if (item.getAttribute('title') === targetText) {
      item.click();
      await humanDelay(500);
      break;
    }
  }
}

/** 查找 B站可点击元素的轻量 helper，用于标签和分区这类稳定单 selector 场景。 */
function findClickableBilibiliElement(selector: string): HTMLElement | null {
  const element = document.querySelector(selector);
  return element instanceof HTMLElement && typeof element.click === 'function' ? element : null;
}

/** B站平台主流程：视频、图文和专栏文章在这里按内容类型分流。 */
export async function fillBilibiliContent(config: PlatformConfig, content: ContentData, isArticle: boolean = false) {
  const logStep = (step: string) => console.info('[PubFlow][bilibili] step', step);
  let uploadMessage = '';
  let articleBodyMessage = '';
  const isImagePost = content.contentType === 'image';

  if (isImagePost && content.imageCacheIds?.length) {
    // 文章模式：上传图片
    logStep('uploadImagesIfAvailable');
    const { uploadImagesIfAvailable } = await import('../../content/imageUploader');
    uploadMessage = await uploadImagesIfAvailable(config, content);
    await humanDelay();
  } else if (!isArticle && content.videoCacheId) {
    // 视频模式：上传视频
    logStep('uploadVideoIfAvailable');
    uploadMessage = await uploadVideoIfAvailable(config, content);
    await humanDelay();
  }

  // 根据是否是文章选择不同的字段配置
  const fields = resolveContentFields(config, content.contentType, isArticle);

  if (isArticle) {
    logStep('waitForArticleEditorReady');
    await waitForArticleEditorReady(config);
  } else if (isImagePost) {
    logStep('waitForImageEditorReady');
    await waitForImageEditorReady(config);
  } else {
    logStep('waitForEditorReady');
    await waitForEditorReady(config);
  }

  if (fields.title && content.title) {
    logStep('fillField title');
    await fillField(fields.title, content.title);
    await humanDelay();
  }

  // 文章模式：填充文章正文
  console.info('[PubFlow][bilibili] article body check', {
    isArticle,
    hasArticleContent: Boolean(content.articleContent),
    hasArticleBodyField: Boolean(fields.articleBody),
    articleBodySelectors: fields.articleBody?.selectors,
  });
  if (isArticle && content.articleContent && fields.articleBody) {
    logStep('fillArticleBodyPlainParagraphs');
    const normalizedArticleContent = content.articleContent.replace(/\n{3,}/g, '\n\n');
    articleBodyMessage = await fillArticleBodyPlainParagraphs(fields.articleBody, normalizedArticleContent);
    await humanDelay();
  } else if (fields.description && content.description) {
    // 视频模式：填充简介
    logStep('fillField description');
    await fillField(fields.description, content.description);
    await humanDelay();
  }

  // 合并话题字段的 topics 和描述中的 #话题 标签
  const descTags = content.description
    ? Array.from(content.description.matchAll(/#([一-龥\w]+)/g), (m) => m[1])
    : [];
  const allTags = Array.from(new Set([...content.topics, ...descTags]));
  const topicField = fields.tags || fields.topics;
  if (topicField && allTags.length > 0) {
    const keepAutoTags = Boolean(content.platformSettings?.bilibili?.keepAutoTags ?? false);
    logStep('fillBilibiliTags');
    await fillBilibiliTags(allTags, keepAutoTags);
    await humanDelay();
  }

  // B站视频页和专栏页都有封面入口，专栏页使用文章字段的 cover 选择器。
  let coverMessage = '';
  if (!isImagePost && (!isArticle || fields.cover)) {
    logStep('uploadBilibiliCover');
    coverMessage = await uploadBilibiliCover(config, content, fields);
    if (coverMessage) {
      await humanDelay();
    }
  }

  if (fields.visibility && content.visibility) {
    logStep('fillVisibility');
    await fillVisibility(config, content.visibility);
    await humanDelay();
  }

  if (fields.scheduled && content.scheduledAt) {
    logStep('fillScheduled');
    const handledArticleScheduled = isArticle
      ? await fillBilibiliArticleScheduled(fields)
      : false;
    if (!handledArticleScheduled) {
      await fillScheduled(config, content.scheduledAt);
    }
    await humanDelay();
  }

  if (fields.originalDeclare && content.originalDeclare) {
    logStep('fillOriginalDeclare');
    await fillOriginalDeclare(config);
    await humanDelay();
  }

  if (fields.declaration) {
    const defaultText = fields.declaration.选项文本 || '内容无需标注';
    logStep('fillDeclarationDropdown');
    await fillDeclarationDropdown(config, defaultText);
    await humanDelay();
  }

  logStep('fillPlatformSettings');
  await fillPlatformSettings(config, content.platformSettings?.[config.id] ?? {});
  await humanDelay();

  // 分区（来自平台个性化设置）
  const category = content.platformSettings?.bilibili?.category;
  if (typeof category === 'string' && category) {
    logStep('fillBilibiliCategory');
    await fillBilibiliCategory(category);
    await humanDelay();
  }

  logStep('done');
  return composePublishMessage(uploadMessage, coverMessage, articleBodyMessage);
}
