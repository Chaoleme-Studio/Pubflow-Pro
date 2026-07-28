import type { PlatformConfig } from '../platforms';
import { loadFileForTransfer, loadVideoForTransfer } from '../storage/videoTransferStorage';
import type { ContentData } from '../types';
import {
  findElement,
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
  QUICK_UPLOAD_SIGNAL_WAIT_MS,
  UPLOAD_BUTTON_RETRY_COUNT,
  UPLOAD_BUTTON_SETTLE_MS,
  UPLOAD_RETRY_SETTLE_MS,
  assignFilesToInput,
  dispatchDropUpload,
  selectorExists,
} from './uploadDom';

const SAVE_BUTTON_TEXTS = ['保存', '确定', '确认', '完成', 'OK', 'Save', '应用', '确认选择', '完成选择'];
const SAVE_BUTTON_SELECTOR = 'button, [role="button"], [class*="btn"], [class*="button"]';
const MODAL_CONTAINER_SELECTOR = '[class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="popup"], [class*="Popup"], [class*="overlay"], [class*="Overlay"], [class*="drawer"], [class*="Drawer"]';

/** 如果存在视频缓存，则自动将视频上传到平台发布页。 */
export async function uploadVideoIfAvailable(config: PlatformConfig, content: ContentData) {
  if (!content.videoCacheId || !config.upload) {
    if ((content.contentType || 'video') === 'video') {
      throw new Error(`${config.name}视频任务缺少可上传的视频缓存，已停止本平台流程。`);
    }
    return '未检测到可自动上传的视频缓存，跳过上传。';
  }

  const file = await loadVideoForTransfer(content.videoCacheId);
  if (!file) {
    if ((content.contentType || 'video') === 'video') {
      throw new Error(`${config.name}视频缓存不存在或已失效，已停止本平台流程。`);
    }
    return '视频缓存不存在，跳过自动上传。';
  }

  const timeoutMs = config.upload.timeoutMs || DEFAULT_UPLOAD_TIMEOUT_MS;

  // 第一步：等页面主体框架出现（Vue 挂载完成）
  const pageReady = await waitForSelector(config.readySelector, timeoutMs);
  const readySignal =
    pageReady ||
    Boolean(findElement(config.upload.fileInputSelector)) ||
    Boolean(
      config.upload.uploadContainerSelector &&
      querySelectorDeep(config.upload.uploadContainerSelector),
    ) ||
    Boolean(
      config.upload.dropContainerSelector?.some((selector) => Boolean(querySelectorDeep(selector))),
    ) ||
    Boolean(
      config.upload.editorReadySelector &&
      querySelectorDeep(config.upload.editorReadySelector),
    );
  if (!readySignal) {
    throw new Error(`平台发布页长时间未就绪：${config.readySelector}`);
  }

  // 第二步：等上传区域渲染出来（SPA 页面延迟渲染的关键）
  if (config.upload.uploadContainerSelector) {
    const uploadAreaReady = await waitForSelector(config.upload.uploadContainerSelector, timeoutMs);
    if (!uploadAreaReady) {
      throw new Error(`没有等到视频上传区域：${config.upload.uploadContainerSelector}`);
    }
  }

  // 有些平台需要先点一下上传按钮
  if (config.upload.uploadButtonSelector?.length) {
    const button = findVisibleElement(config.upload.uploadButtonSelector);
    if (button) {
      scrollIntoView(button);
      button.click();
      await waitForIdle(UPLOAD_BUTTON_SETTLE_MS);
    }
  }

  // 第三步：用 MutationObserver 等 file input 出现（比轮询更快响应）
  // 如果首次点击上传按钮后 file input 没出现，重试点击（页面可能尚未完全就绪）
  let inputEl = await waitForElement(config.upload.fileInputSelector, FILE_INPUT_WAIT_MS);
  if (!(inputEl instanceof HTMLInputElement) && config.upload.uploadButtonSelector?.length) {
    for (let retry = 0; retry < UPLOAD_BUTTON_RETRY_COUNT; retry++) {
      const btn = findVisibleElement(config.upload.uploadButtonSelector);
      if (btn) {
        scrollIntoView(btn);
        btn.click();
        await waitForIdle(UPLOAD_RETRY_SETTLE_MS);
      }
      inputEl = await waitForElement(config.upload.fileInputSelector, FILE_INPUT_WAIT_MS);
      if (inputEl instanceof HTMLInputElement) break;
    }
  }
  if (!(inputEl instanceof HTMLInputElement)) {
    throw new Error(`没有找到视频上传 input：${config.upload.fileInputSelector[0]}`);
  }
  const input = inputEl as HTMLInputElement;

  const uploadDoneAlreadyVisible = selectorExists(config.upload.uploadDoneSelector);
  const editorReadyAlreadyVisible = selectorExists(config.upload.editorReadySelector);
  const uploadSignals = [
    uploadDoneAlreadyVisible ? undefined : config.upload.uploadDoneSelector,
    editorReadyAlreadyVisible ? undefined : config.upload.editorReadySelector,
  ];

  console.info('[PubFlow] upload input found', {
    platform: config.id,
    uploadDoneAlreadyVisible,
    editorReadyAlreadyVisible,
  });

  assignFilesToInput(input, [file]);
  await waitForIdle(FILE_ASSIGN_SETTLE_MS);

  let uploaded = uploadSignals.some(Boolean)
    ? await waitForAnySelector(uploadSignals, QUICK_UPLOAD_SIGNAL_WAIT_MS)
    : undefined;

  if (!uploaded && config.upload.dropContainerSelector?.length) {
    const dropContainer = findVisibleElement(config.upload.dropContainerSelector);
    if (dropContainer) {
      console.info('[PubFlow] fallback to drag-drop upload', {
        platform: config.id,
        dropSelectors: config.upload.dropContainerSelector,
      });
      dispatchDropUpload(dropContainer, [file]);
      await waitForIdle(DRAG_DROP_SETTLE_MS);
    }
  }

  // 第四步：等上传完成 / 编辑区就绪
  if (uploadSignals.some(Boolean)) {
    uploaded = uploaded || (await waitForAnySelector(uploadSignals, timeoutMs));
    if (!uploaded) {
      console.info('[PubFlow] upload signal not observed', {
        platform: config.id,
        uploadDoneSelector: config.upload.uploadDoneSelector,
        editorReadySelector: config.upload.editorReadySelector,
      });
      throw new Error('视频上传后没有等到新的页面状态，请检查平台页面状态或选择器。');
    }
  } else {
    await waitForIdle(FALLBACK_UPLOAD_SETTLE_MS);
  }

  return '视频已尝试自动上传，继续填写文本。';
}

/** 判断一个按钮是否是可见的保存/确认类按钮。 */
function isVisibleSaveButton(button: HTMLElement) {
  const text = button.textContent?.trim() || '';
  return SAVE_BUTTON_TEXTS.includes(text) && button.offsetParent !== null;
}

/** 在按钮列表中按保存按钮规则查找第一个匹配的按钮。 */
function findFirstSaveButton(buttons: Iterable<HTMLElement>, predicate?: (button: HTMLElement) => boolean) {
  for (const button of buttons) {
    if (!isVisibleSaveButton(button)) continue;
    if (predicate && !predicate(button)) continue;
    return button;
  }
  return null;
}

/** 在页面中查找封面编辑弹窗或封面区域附近的保存按钮。 */
function findSaveButton(): HTMLElement | null {
  const buttons = document.querySelectorAll<HTMLElement>(SAVE_BUTTON_SELECTOR);

  // 优先查找模态框/弹出层中的按钮
  const modalButton = findFirstSaveButton(buttons, (button) => Boolean(button.closest(MODAL_CONTAINER_SELECTOR)));
  if (modalButton) {
    return modalButton;
  }

  // 查找封面编辑区域附近的按钮
  const coverArea = document.querySelector('[class*="coverControl"], [class*="cover-control"], [class*="cover"]');
  if (coverArea) {
    const nearbyButton = findFirstSaveButton(coverArea.querySelectorAll<HTMLElement>(SAVE_BUTTON_SELECTOR));
    if (nearbyButton) {
      return nearbyButton;
    }
  }

  // 查找主按钮（primary button）
  const primaryButton = findFirstSaveButton(buttons, (button) =>
    button.className.includes('primary') ||
    button.className.includes('btn-primary') ||
    button.className.includes('semi-button-primary'));
  if (primaryButton) {
    return primaryButton;
  }

  // 如果还是没找到，找任何可见的保存类按钮
  return findFirstSaveButton(buttons);
}

/** 如果存在封面缓存，则自动将封面上传到平台封面区域。 */
export async function uploadCoverIfAvailable(config: PlatformConfig, content: ContentData) {
  if (!content.coverCacheId || !config.fields.cover) {
    return '';
  }

  const file = await loadFileForTransfer(content.coverCacheId);
  if (!file) {
    return '封面缓存不存在，跳过封面上传。';
  }

  // 先查找页面上所有接受图片的 file input
  const imageInputSelectors = [
    'input[type="file"][accept*="image"]',
    'input[type="file"][accept*=".jpg"]',
    'input[type="file"][accept*=".png"]',
    'input[type="file"][accept*=".jpeg"]',
    'input[type="file"][accept*="image/png"]',
    'input[type="file"][accept*="image/jpeg"]',
  ];

  let input: HTMLInputElement | null = null;

  // 方法1：在封面区域内查找 file input
  const coverElement = findVisibleElement(config.fields.cover.selectors);
  if (coverElement) {
    scrollIntoView(coverElement);
    await waitForIdle(300);

    input = coverElement.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) {
      // 尝试在封面区域的父元素中查找
      const parent = coverElement.closest('[class*="cover"], [class*="Cover"]') || coverElement.parentElement;
      if (parent) {
        input = parent.querySelector<HTMLInputElement>('input[type="file"]');
      }
    }
  }

  // 方法2：如果没找到，搜索整个页面的图片 file input（包括隐藏的）
  if (!input) {
    for (const selector of imageInputSelectors) {
      const found = document.querySelector<HTMLInputElement>(selector);
      if (found) {
        input = found;
        break;
      }
    }
  }

  // 方法3：如果还是没找到，点击封面区域触发对话框
  if (!input && coverElement) {
    coverElement.click();
    await waitForIdle(1000);

    // 尝试点击对话框中的"本地上传"标签页（知乎、抖音等平台）
    const tabTexts = ['本地上传', '上传封面', '上传图片', '自定义封面'];
    const allTabElements = document.querySelectorAll<HTMLElement>(
      '[role="tab"], [class*="tab"], [class*="Tab"], span, div, button, a',
    );
    for (const tab of allTabElements) {
      const text = tab.textContent?.trim() || '';
      if (tabTexts.includes(text) && tab.offsetParent !== null) {
        tab.click();
        await waitForIdle(800);
        break;
      }
    }

    // 在对话框/模态框中优先搜索 file input
    const modalSelectors = [
      '[class*="modal"] input[type="file"][accept*="image"]',
      '[class*="Modal"] input[type="file"][accept*="image"]',
      '[class*="dialog"] input[type="file"][accept*="image"]',
      '[class*="Dialog"] input[type="file"][accept*="image"]',
      '[class*="modal"] input[type="file"]',
      '[class*="Modal"] input[type="file"]',
      '[class*="dialog"] input[type="file"]',
      '[class*="Dialog"] input[type="file"]',
      '[class*="popup"] input[type="file"]',
      '[class*="Popup"] input[type="file"]',
      '[class*="drawer"] input[type="file"]',
      '[class*="Drawer"] input[type="file"]',
    ];
    for (const selector of modalSelectors) {
      const found = document.querySelector<HTMLInputElement>(selector);
      if (found) {
        input = found;
        break;
      }
    }

    // 再全局搜索
    if (!input) {
      for (const selector of imageInputSelectors) {
        const found = document.querySelector<HTMLInputElement>(selector);
        if (found) {
          input = found;
          break;
        }
      }
    }

    // 最后尝试搜索任何 file input（排除视频上传用的）
    if (!input) {
      const allFileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
      for (const fi of allFileInputs) {
        const accept = fi.accept || '';
        if (!accept.includes('video')) {
          input = fi;
          break;
        }
      }
    }
  }

  if (!input) {
    return `没有找到封面上传 input：${config.fields.cover.selectors[0]}。`;
  }

  // 使用 DataTransfer 设置文件
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForIdle(2000);

  // 点击保存按钮确认封面（如果存在）
  const saveButton = findSaveButton();
  if (saveButton) {
    saveButton.click();
    await waitForIdle(1000);
    return '封面已上传并保存。';
  }

  // 如果没找到保存按钮，尝试点击封面区域触发编辑器
  const coverArea = document.querySelector('[class*="coverControl"], [class*="cover-control"], [class*="cover"]');
  if (coverArea) {
    (coverArea as HTMLElement).click();
    await waitForIdle(1000);

    // 再次查找保存按钮
    const saveButton2 = findSaveButton();
    if (saveButton2) {
      saveButton2.click();
      await waitForIdle(500);
      return '封面已上传并保存。';
    }
  }

  return '封面已尝试自动上传，但未找到保存按钮。';
}
