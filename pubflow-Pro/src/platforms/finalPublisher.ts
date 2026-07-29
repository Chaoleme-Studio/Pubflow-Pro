import { prepareFinalPublishClick, requestFinalPublishClick, type ElementPointOffset } from '../content/cdp';
import { findDeepElement, isVisible, waitForIdle } from '../content/dom';
import type { ContentData, PlatformId } from '../types';

const FINAL_BUTTON_SCROLL_SETTLE_MS = 450;
const FINAL_BUTTON_WAIT_TIMEOUT_MS = 15_000;
const FINAL_BUTTON_POLL_MS = 250;
const XHS_BUTTON_WIDTH_PX = 120;
const XHS_BUTTON_GAP_PX = 24;

export interface FinalButtonSpec {
  selector: string;
  texts: string[];
}

const VERIFIED_FINAL_BUTTON_SPECS = {
  xiaohongshu: {
    selector: 'xhs-publish-btn[is-publish="true"]',
    texts: [],
  },
  weixinChannels: {
    selector: 'button.weui-desktop-btn_primary',
    texts: ['发表'],
  },
  bilibili: {
    selector: '.submit-add',
    texts: ['立即投稿'],
  },
  x: {
    selector: '[data-testid="tweetButton"]',
    texts: ['发帖', '预排期', '安排', 'Post', 'Schedule'],
  },
  youtube: {
    selector: 'ytcp-button#done-button button, #done-button > button, button#done-button',
    texts: ['发布', '保存', '预定', 'Publish', 'Save', 'Schedule'],
  },
} satisfies Partial<Record<PlatformId, FinalButtonSpec>>;

const FINAL_BUTTON_SPECS: Partial<Record<PlatformId, FinalButtonSpec>> = {
  douyin: {
    selector: 'button, [role="button"]',
    texts: ['发布', '立即发布', '定时发布', '发布文章'],
  },
  weixinChannels: VERIFIED_FINAL_BUTTON_SPECS.weixinChannels,
  bilibili: VERIFIED_FINAL_BUTTON_SPECS.bilibili,
  kuaishou: {
    selector: '[class*="button-primary"], button, [role="button"]',
    texts: ['发布', '立即发布'],
  },
  weibo: {
    selector: 'button, [role="button"]',
    texts: ['发送', '发布', '立即发布'],
  },
  zhihu: {
    selector: '.VideoUploadForm-submitButton, [class*="submitButton"], button, [role="button"]',
    texts: ['发布视频', '发布文章', '发布', '立即发布'],
  },
  x: VERIFIED_FINAL_BUTTON_SPECS.x,
  youtube: VERIFIED_FINAL_BUTTON_SPECS.youtube,
};

/** 当前已经过真实发布页 DOM 核对、允许直接点击最终按钮的平台。 */
export function supportsDirectPublish(platformId: PlatformId) {
  return platformId === 'xiaohongshu' || platformId in FINAL_BUTTON_SPECS;
}

/** 暴露最终按钮规则，便于对已核对的平台 DOM 契约做回归测试。 */
export function getFinalPublishButtonSpec(platformId: PlatformId) {
  return FINAL_BUTTON_SPECS[platformId];
}

/** 后台可实时重新定位并验证可信点击的最终按钮契约。 */
export function getVerifiedFinalPublishButtonSpec(platformId: PlatformId): FinalButtonSpec | undefined {
  return VERIFIED_FINAL_BUTTON_SPECS[platformId as keyof typeof VERIFIED_FINAL_BUTTON_SPECS];
}

/** 填充完成后定位并请求后台可信点击平台最终发布按钮。 */
export async function clickFinalPublishButton(platformId: PlatformId, content: ContentData): Promise<void> {
  void content;
  await prepareFinalPublishClick(platformId);

  if (platformId === 'xiaohongshu') {
    await clickXiaohongshuFinalButton();
    return;
  }

  const spec = getFinalPublishButtonSpec(platformId);
  if (!spec) {
    throw new Error('当前平台暂不支持直接发布，请在平台页面手动确认。');
  }

  const button = await waitForFinalElement(spec.selector, (element) => (
    spec.texts.includes(finalButtonLabel(element))
  ));
  if (!button) {
    throw new Error(`没有找到${platformDisplayName(platformId)}最终发布按钮。`);
  }

  await prepareFinalButton(button);
  await requestFinalPublishClick(button, platformId);
}

/** 小红书最终按钮位于 closed Shadow DOM，使用公开宿主尺寸计算第二个按钮的中心点。 */
async function clickXiaohongshuFinalButton() {
  const host = await waitForFinalElement('xhs-publish-btn[is-publish="true"]', (element) => (
    element.getAttribute('submit-disabled') !== 'true'
    && element.getAttribute('submit-loading') !== 'true'
  ));
  if (!host) {
    throw new Error('没有找到小红书最终发布按钮。');
  }
  if (host.getAttribute('submit-disabled') === 'true' || host.getAttribute('submit-loading') === 'true') {
    throw new Error('小红书发布按钮当前不可用，请检查页面必填项或上传状态。');
  }

  await prepareFinalButton(host);
  const rect = host.getBoundingClientRect();
  const offset = resolveXiaohongshuSubmitOffset(
    rect.width,
    rect.height,
    host.getAttribute('is-save-draft') === 'true',
  );
  await requestFinalPublishClick(host, 'xiaohongshu', offset);
}

/** 根据小红书宿主公开布局计算 closed Shadow DOM 内提交按钮中心。 */
export function resolveXiaohongshuSubmitOffset(
  hostWidth: number,
  hostHeight: number,
  hasSaveDraft: boolean,
): ElementPointOffset {
  const secondButtonShift = hasSaveDraft ? (XHS_BUTTON_WIDTH_PX + XHS_BUTTON_GAP_PX) / 2 : 0;
  return {
    x: Math.min(Math.max(hostWidth / 2 + secondButtonShift, 1), Math.max(hostWidth - 1, 1)),
    y: Math.min(Math.max(hostHeight / 2, 1), Math.max(hostHeight - 1, 1)),
  };
}

async function prepareFinalButton(element: HTMLElement) {
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  await waitForIdle(FINAL_BUTTON_SCROLL_SETTLE_MS);
  if (!isVisible(element) || isDisabled(element)) {
    throw new Error('最终发布按钮当前不可点击，请检查平台页面。');
  }
}

async function waitForFinalElement(
  selector: string,
  matches: (element: HTMLElement) => boolean,
): Promise<HTMLElement | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < FINAL_BUTTON_WAIT_TIMEOUT_MS) {
    const element = findDeepElement<HTMLElement>(selector, (candidate) => (
      isHtmlElement(candidate)
      && isVisible(candidate)
      && !isDisabled(candidate)
      && matches(candidate)
    ));
    if (element) return element;
    await waitForIdle(FINAL_BUTTON_POLL_MS);
  }
  return undefined;
}

/** iframe 元素属于子窗口 realm，不能使用顶层窗口的 instanceof HTMLElement 判断。 */
function isHtmlElement(element: Element): element is HTMLElement {
  return element.nodeType === 1 && typeof (element as HTMLElement).getBoundingClientRect === 'function';
}

function isDisabled(element: HTMLElement) {
  return (
    (element.tagName === 'BUTTON' && Boolean((element as HTMLButtonElement).disabled))
    || element.getAttribute('aria-disabled') === 'true'
    || element.hasAttribute('disabled')
    || /(?:^|\s)(?:is-)?disabled(?:\s|$)/i.test(element.className)
  );
}

function normalizeText(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function finalButtonLabel(element: HTMLElement) {
  return normalizeText(element.getAttribute('aria-label') || element.textContent);
}

function platformDisplayName(platformId: PlatformId) {
  const names: Partial<Record<PlatformId, string>> = {
    douyin: '抖音',
    xiaohongshu: '小红书',
    weixinChannels: '视频号',
    bilibili: 'B站',
    kuaishou: '快手',
    weibo: '微博',
    zhihu: '知乎',
    x: 'X',
    youtube: 'YouTube',
  };
  return names[platformId] || platformId;
}
