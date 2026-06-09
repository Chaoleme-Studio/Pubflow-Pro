import type { PlatformConfig } from '../platforms';
import { loadFileForTransfer } from '../storage/videoTransferStorage';
import type { ContentData } from '../types';
import {
  findElement,
  findDeepElement,
  findVisibleElement,
  querySelectorDeep,
  scrollIntoView,
  waitForAnySelector,
  waitForElement,
  waitForIdle,
  waitForSelector,
} from './dom';
import {
  DEFAULT_UPLOAD_TIMEOUT_MS,
  DRAG_DROP_SETTLE_MS,
  FALLBACK_UPLOAD_SETTLE_MS,
  FILE_ASSIGN_SETTLE_MS,
  FILE_INPUT_WAIT_MS,
  IMAGE_UPLOAD_SIGNAL_TIMEOUT_MS,
  QUICK_UPLOAD_SIGNAL_WAIT_MS,
  UPLOAD_BUTTON_RETRY_COUNT,
  UPLOAD_BUTTON_SETTLE_MS,
  UPLOAD_RETRY_SETTLE_MS,
  assignFilesToInput,
  dispatchDropUpload,
  selectorExists,
} from './uploadDom';

/** 判断 input 是否是图片上传控件，避免误把视频 input 当成图文图片上传入口。 */
function isImageFileInput(element: Element | null | undefined): element is HTMLInputElement {
  if (!(element instanceof HTMLInputElement) || element.type !== 'file') return false;
  const accept = (element.accept || '').toLowerCase();
  if (accept.includes('video')) return false;
  return (
    accept.includes('image') ||
    accept.includes('.jpg') ||
    accept.includes('.jpeg') ||
    accept.includes('.png') ||
    accept.includes('.webp') ||
    accept.includes('.bmp') ||
    accept.includes('.tif')
  );
}

/** 按配置选择器优先查找图片 input，失败后再全页深度搜索图片类型 input。 */
function findImageFileInput(selectors: string[]): HTMLInputElement | null {
  for (const selector of selectors) {
    let imageInput: HTMLInputElement | undefined;
    try {
      imageInput = findDeepElement(selector, isImageFileInput);
    } catch {
      continue;
    }
    if (imageInput) return imageInput;
  }

  return findDeepElement('input[type="file"]', isImageFileInput) || null;
}

/**
 * 判断图文/文章图片上传是否已经进入编辑态。
 * background 重试或页面自动恢复时会再次发送填充指令，这里用于避免重复上传同一批图片。
 */
function hasArticleUploadCompleted(uploadConfig: PlatformConfig['articleUpload'] | PlatformConfig['upload']) {
  return (
    selectorExists(uploadConfig?.uploadDoneSelector) ||
    selectorExists(uploadConfig?.editorReadySelector) ||
    hasImageUploadTextSignal()
  );
}

/** 读取各平台常见的“已上传 N 张图片”文案，作为缺少稳定 DOM selector 时的上传完成信号。 */
function hasImageUploadTextSignal() {
  const text = document.body?.innerText || '';
  return /已添加\s*\d+\s*张图片/.test(text) || /已上传\s*\d+\s*张图片/.test(text);
}

/** 等待图片上传完成信号，兼容 selector 信号和页面文案信号两种模式。 */
async function waitForImageUploadSignal(
  uploadConfig: PlatformConfig['articleUpload'] | PlatformConfig['upload'],
  selectors: Array<string | undefined>,
  timeoutMs: number,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (hasImageUploadTextSignal()) return 'text-signal';
    const matched = await waitForAnySelector(selectors, 250);
    if (matched) return matched;
  }
  return hasArticleUploadCompleted(uploadConfig) ? 'existing-signal' : undefined;
}

/**
 * 上传图文图片。
 * 这是图文发布的公共入口，负责加载缓存图片、等待上传区、注入 file input，并在失败时回退拖拽上传。
 */
export async function uploadImagesIfAvailable(config: PlatformConfig, content: ContentData) {
  const uploadConfig = config.articleUpload || config.upload;

  if (!content.imageCacheIds?.length || !uploadConfig) {
    return '未检测到可自动上传的图片缓存，跳过上传。';
  }

  // 加载所有图片文件
  const files: File[] = [];
  for (const cacheId of content.imageCacheIds) {
    const file = await loadFileForTransfer(cacheId);
    if (file) {
      files.push(file);
    }
  }

  if (files.length === 0) {
    return '图片缓存不存在，跳过自动上传。';
  }

  const timeoutMs = uploadConfig.timeoutMs || DEFAULT_UPLOAD_TIMEOUT_MS;

  // 第一步：等页面主体框架出现。图文页不一定有视频上传区 readySelector。
  const pageReadySelectors = [
    uploadConfig.uploadContainerSelector,
    ...uploadConfig.fileInputSelector,
    ...(uploadConfig.dropContainerSelector || []),
    uploadConfig.editorReadySelector,
    config.readySelector,
  ];
  const pageReady = await waitForAnySelector(pageReadySelectors, timeoutMs);
  const readySignal =
    pageReady ||
    Boolean(findElement(uploadConfig.fileInputSelector)) ||
    Boolean(
      uploadConfig.uploadContainerSelector &&
      querySelectorDeep(uploadConfig.uploadContainerSelector),
    ) ||
    Boolean(
      uploadConfig.dropContainerSelector?.some((selector) => Boolean(querySelectorDeep(selector))),
    ) ||
    Boolean(
      uploadConfig.editorReadySelector &&
      querySelectorDeep(uploadConfig.editorReadySelector),
    );
  if (!readySignal) {
    throw new Error(`平台图文发布页长时间未就绪：${pageReadySelectors.filter(Boolean).join(', ')}`);
  }

  if (hasArticleUploadCompleted(uploadConfig)) {
    return `页面已存在图片编辑区，继续填写文本。`;
  }

  // 第二步：等上传区域渲染出来
  if (uploadConfig.uploadContainerSelector) {
    const uploadAreaReady = await waitForSelector(uploadConfig.uploadContainerSelector, timeoutMs);
    if (!uploadAreaReady && !hasArticleUploadCompleted(uploadConfig)) {
      throw new Error(`没有等到图片上传区域：${uploadConfig.uploadContainerSelector}`);
    }
  }

  if (hasArticleUploadCompleted(uploadConfig)) {
    return `页面已存在图片编辑区，继续填写文本。`;
  }

  // 有些平台需要先点一下上传按钮
  if (uploadConfig.uploadButtonSelector?.length) {
    const button = findVisibleElement(uploadConfig.uploadButtonSelector);
    if (button) {
      scrollIntoView(button);
      button.click();
      await waitForIdle(UPLOAD_BUTTON_SETTLE_MS);
    }
  }

  // 第三步：用 MutationObserver 等 file input 出现
  let input = findImageFileInput(uploadConfig.fileInputSelector);
  let inputEl = input || await waitForElement(uploadConfig.fileInputSelector, FILE_INPUT_WAIT_MS);
  input = isImageFileInput(inputEl) ? inputEl : findImageFileInput(uploadConfig.fileInputSelector);
  if (!input && uploadConfig.uploadButtonSelector?.length) {
    for (let retry = 0; retry < UPLOAD_BUTTON_RETRY_COUNT; retry++) {
      const btn = findVisibleElement(uploadConfig.uploadButtonSelector);
      if (btn) {
        scrollIntoView(btn);
        btn.click();
        await waitForIdle(UPLOAD_RETRY_SETTLE_MS);
      }
      inputEl = await waitForElement(uploadConfig.fileInputSelector, FILE_INPUT_WAIT_MS);
      input = isImageFileInput(inputEl) ? inputEl : findImageFileInput(uploadConfig.fileInputSelector);
      if (input) break;
    }
  }
  if (!input) {
    if (hasArticleUploadCompleted(uploadConfig)) {
      return `页面已存在图片编辑区，继续填写文本。`;
    }
    throw new Error(`没有找到图片上传 input：${uploadConfig.fileInputSelector[0]}`);
  }

  console.info('[PubFlow] image upload input found', {
    platform: config.id,
    fileCount: files.length,
  });

  // 第四步：上传图片
  assignFilesToInput(input, files);
  await waitForIdle(FILE_ASSIGN_SETTLE_MS);

  // 等待上传完成
  const uploadDoneAlreadyVisible = Boolean(
    uploadConfig.uploadDoneSelector && querySelectorDeep(uploadConfig.uploadDoneSelector),
  );
  const editorReadyAlreadyVisible = Boolean(
    uploadConfig.editorReadySelector && querySelectorDeep(uploadConfig.editorReadySelector),
  );
  const uploadSignals = [
    uploadDoneAlreadyVisible ? undefined : uploadConfig.uploadDoneSelector,
    editorReadyAlreadyVisible ? undefined : uploadConfig.editorReadySelector,
  ];

  let uploaded = uploadSignals.some(Boolean)
    ? await waitForImageUploadSignal(uploadConfig, uploadSignals, QUICK_UPLOAD_SIGNAL_WAIT_MS)
    : undefined;

  // 如果直接注入没生效，尝试拖拽上传
  if (!uploaded && uploadConfig.dropContainerSelector?.length) {
    const dropContainer = findVisibleElement(uploadConfig.dropContainerSelector);
    if (dropContainer) {
      console.info('[PubFlow] fallback to drag-drop upload for images', {
        platform: config.id,
        dropSelectors: uploadConfig.dropContainerSelector,
      });
      dispatchDropUpload(dropContainer, files);
      await waitForIdle(DRAG_DROP_SETTLE_MS);
    }
  }

  // 第五步：等上传完成 / 编辑区就绪
  if (uploadSignals.some(Boolean)) {
    uploaded = uploaded || (await waitForImageUploadSignal(uploadConfig, uploadSignals, Math.min(timeoutMs, IMAGE_UPLOAD_SIGNAL_TIMEOUT_MS)));
    if (!uploaded) {
      console.info('[PubFlow] image upload signal not observed', {
        platform: config.id,
        uploadDoneSelector: uploadConfig.uploadDoneSelector,
        editorReadySelector: uploadConfig.editorReadySelector,
      });
      throw new Error('图片上传后没有等到新的页面状态，请检查平台页面状态或选择器。');
    }
  } else {
    await waitForIdle(FALLBACK_UPLOAD_SETTLE_MS);
  }

  return `已上传 ${files.length} 张图片，继续填写文本。`;
}

/**
 * 直接通过平台文件 input 上传 File 对象数组。
 * 用于从 Markdown 提取的 base64 图片转为 File 后上传，和普通图文图片上传共用相同的 DOM 注入能力。
 */
export async function uploadFilesViaInput(config: PlatformConfig, files: File[]): Promise<string> {
  if (!files.length) return '无图片需要上传。';

  const uploadConfig = config.articleUpload || config.upload;
  if (!uploadConfig) return '平台未配置上传，跳过。';

  const timeoutMs = uploadConfig.timeoutMs || DEFAULT_UPLOAD_TIMEOUT_MS;

  // 等页面就绪
  const pageReady = await waitForSelector(config.readySelector, timeoutMs);
  if (!pageReady) {
    throw new Error(`平台发布页长时间未就绪：${config.readySelector}`);
  }

  // 找到文件 input
  let input = findImageFileInput(uploadConfig.fileInputSelector);
  if (!input) {
    const inputEl = await waitForElement(uploadConfig.fileInputSelector, FILE_INPUT_WAIT_MS);
    input = isImageFileInput(inputEl) ? inputEl : findImageFileInput(uploadConfig.fileInputSelector);
  }
  if (!input) {
    // 尝试点击上传按钮
    if (uploadConfig.uploadButtonSelector?.length) {
      const btn = findVisibleElement(uploadConfig.uploadButtonSelector);
      if (btn) {
        btn.click();
        await waitForIdle(UPLOAD_RETRY_SETTLE_MS);
        const inputEl = await waitForElement(uploadConfig.fileInputSelector, FILE_INPUT_WAIT_MS);
        input = isImageFileInput(inputEl) ? inputEl : findImageFileInput(uploadConfig.fileInputSelector);
      }
    }
    if (!input) {
      throw new Error('没有找到图片上传 input');
    }
  }

  // 逐个上传图片
  for (const file of files) {
    assignFilesToInput(input, [file]);
    await waitForIdle(2000);

    // 等待上传完成信号
    if (uploadConfig.uploadDoneSelector) {
      await waitForAnySelector([uploadConfig.uploadDoneSelector], timeoutMs);
    }
    await waitForIdle(UPLOAD_RETRY_SETTLE_MS);
  }

  return `已通过平台上传 ${files.length} 张图片。`;
}
