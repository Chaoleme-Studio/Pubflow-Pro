import { detectBlocker } from '../src/content/blockerDetector';
import { findElement, querySelectorDeep, setOverrideDocument, waitForIdle, waitForSelector } from '../src/content/dom';
import { getPlatformContentHandler } from '../src/platforms/flows';
import { clickFinalPublishButton, supportsDirectPublish } from '../src/platforms/finalPublisher';
import { getPlatformByUrl, isArticlePage, isLongArticlePage, PLATFORM_MATCH_PATTERNS } from '../src/platforms';
import type { PlatformConfig } from '../src/platforms';
import type { ContentData, DistributionTask, RuntimeMessage, RuntimeResponse } from '../src/types';

const PAGE_STATUS_INITIAL_DELAY_MS = 700;
const DEFAULT_PAGE_READY_TIMEOUT_MS = 180000;
const ARTICLE_ENTRY_BUTTON_TIMEOUT_MS = 10000;
const ARTICLE_ENTRY_BUTTON_POLL_MS = 500;
const ARTICLE_ENTRY_NAVIGATION_SETTLE_MS = 2000;
const READY_SIGNAL_POLL_MS = 250;
const WUJIE_READY_CACHE_MS = 2000;
const FILL_REQUEST_DEDUPE_TTL_MS = 10 * 60 * 1000;

type FillRequestState = {
  startedAt: number;
  frameHref: string;
  frameName: string;
};

declare global {
  interface Window {
    __pubflowFillRequests?: Record<string, FillRequestState>;
  }
}

/** 根据当前 frame URL 解析平台上下文；视频号同源 iframe 也需要继承顶层平台配置。 */
function resolvePlatformContext(): PlatformConfig | undefined {
  const current = getPlatformByUrl(location.href);
  if (current) {
    // 视频号页面形态会变：有时真实表单在顶层文档，有时在同源 iframe。
    // 不能无条件跳过顶层，否则新版/慢加载页面会完全没有 content script 接收填充指令。
    // 顶层只有登录壳或导航壳时不会命中 readySelector，不会误报 ready。
    return current;
  }

  if (window.top !== window) {
    try {
      const topLocation = window.top?.location?.href;
      if (!topLocation) {
        return undefined;
      }
      const topPlatform = getPlatformByUrl(topLocation);
      const frameName = window.frameElement instanceof HTMLIFrameElement
        ? window.frameElement.name
        : '';
      if (topPlatform?.id === 'weixinChannels' && frameName === 'content') {
        return topPlatform;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export default defineContentScript({
  matches: PLATFORM_MATCH_PATTERNS,
  runAt: 'document_idle',
  allFrames: true,
  main() {
    void initContentScript();
  },
});

async function initContentScript() {
    try {
      const platform = resolvePlatformContext();
      if (!platform) return;

      void reportPageStatus(platform);
      observePageReady(platform);

      browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
        if (message.type === 'REQUEST_PAGE_STATUS') {
          if (message.payload.platformId !== platform.id) return;
          void reportPageStatus(platform);
          return Promise.resolve({ ok: true } as const);
        }

        if (message.type !== 'FILL_CONTENT') return;
        if (message.payload.platformId !== platform.id) return;
        const frameDecision = canHandleFillInThisFrame(platform, message.payload.content.contentType);
        if (frameDecision !== 'handle') {
          console.info('[PubFlow] ignore fill command in non-editor frame', {
            platform: platform.id,
            reason: frameDecision,
            href: location.href,
            frameName: window.frameElement instanceof HTMLIFrameElement ? window.frameElement.name : '',
          });
          // 不返回值，让消息继续传播到其他 frame（如 B站文章编辑器所在的 iframe）。
          // 返回 { ok: true, ignored: true } 会被 background 当作成功，停止重试。
          return;
        }

        if (message.payload.requestId && !claimFillRequest(message.payload.requestId)) {
          console.info('[PubFlow] ignore duplicate fill command', {
            platform: platform.id,
            requestId: message.payload.requestId,
            href: location.href,
            frameName: window.frameElement instanceof HTMLIFrameElement ? window.frameElement.name : '',
          });
          return;
        }

        if (message.payload.requestId) {
          void browser.runtime.sendMessage({
            type: 'FILL_CONTENT_ACK',
            payload: {
              platformId: platform.id,
              requestId: message.payload.requestId,
            },
          } satisfies RuntimeMessage).catch(() => undefined);
        }

        void fillContent(platform, message.payload.content, message.payload.autoSubmit === true);
        return Promise.resolve({ ok: true } as const);
      });
    } catch (error) {
      console.error('[PubFlow] content script 初始化失败', error);
    }
}

/**
 * 记录本次填充请求已经被哪个 frame 接手。
 * background 会广播到所有 frame，这里用 requestId 防止同一页面多个 frame 重复上传/填充。
 */
function claimFillRequest(requestId: string) {
  let root: Window = window;
  let store: Record<string, FillRequestState>;
  try {
    root = window.top || window;
    store = root.__pubflowFillRequests || {};
    root.__pubflowFillRequests = store;
  } catch {
    store = window.__pubflowFillRequests || {};
    window.__pubflowFillRequests = store;
  }

  const now = Date.now();
  for (const [key, state] of Object.entries(store)) {
    if (now - state.startedAt > FILL_REQUEST_DEDUPE_TTL_MS) {
      delete store[key];
    }
  }

  if (store[requestId]) return false;

  store[requestId] = {
    startedAt: now,
    frameHref: location.href,
    frameName: window.frameElement instanceof HTMLIFrameElement ? window.frameElement.name : '',
  };
  return true;
}

/** 判断当前 URL 是否处于文章/长文编辑页。 */
function isCurrentArticlePage(): boolean {
  return isArticlePage(location.href) || isLongArticlePage(location.href);
}

/**
 * 判断当前上下文是否应该走文章/图文编辑流程。
 * 注意 image 也返回 true，因为图文和文章都复用 articleUpload，但平台处理器会再区分长文章。
 */
function isArticleEditorContext(config: PlatformConfig, contentType?: ContentData['contentType']): boolean {
  if (contentType === 'article' || contentType === 'image') return true;
  if (isCurrentArticlePage()) return true;
  // B站专栏编辑器运行在同源 iframe（/york/read-editor）内，
  // iframe URL 不等于平台配置里的 articlePageUrl，但 DOM 里有 articleReadySelector。
  // 公共层保留这个判断，是为了让 iframe 自己接管填充，而不是顶层页面误判未就绪。
  return Boolean(config.articleReadySelector && querySelectorDeep(config.articleReadySelector));
}

/** 从 background 当前任务读取内容类型，让页面状态上报能区分视频、图文和文章。 */
async function getCurrentTaskContentType(config: PlatformConfig): Promise<ContentData['contentType'] | undefined> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_TASK',
    } satisfies RuntimeMessage) as RuntimeResponse<DistributionTask | null> | undefined;
    const task = response?.ok ? response.data : null;
    if (!task?.platforms.some((item) => item.platformId === config.id)) return undefined;
    return task.content.contentType;
  } catch {
    return undefined;
  }
}

/** 判断是否应该用长文章专用 ready selector，避免图文误进文章 iframe/富文本逻辑。 */
function shouldUseArticleReadySelector(config: PlatformConfig, contentType?: ContentData['contentType']) {
  // 图文发布通常仍复用平台的上传区/图文编辑器，不一定是长文章编辑器。
  // 只有“发布文章”或当前 URL 是长文章页时，才使用 articleReadySelector。
  if (contentType === 'image') return false;
  return Boolean(config.articleReadySelector && (contentType === 'article' || isLongArticlePage(location.href)));
}

/** 解析当前页面应等待的 ready selector，是页面状态和填充入口的统一分流点。 */
function resolveReadySelector(config: PlatformConfig, contentType?: ContentData['contentType']) {
  // readySelector 是公共兜底；articleReadySelector 用于抖音文章、知乎专栏、B站专栏等长文章页。
  // 这里集中分流，避免每个平台在 reportPageStatus/fillContent 里重复判断页面类型。
  if (shouldUseArticleReadySelector(config, contentType)) {
    return config.articleReadySelector!;
  }
  const isArticleLike = contentType === 'article' || contentType === 'image' || isArticleEditorContext(config, contentType);
  if (isArticleLike && config.articleUpload?.editorReadySelector) {
    return config.articleUpload.editorReadySelector;
  }
  return config.readySelector;
}

/** 解析当前内容类型对应的上传配置；图文/文章优先 articleUpload，视频走 upload。 */
function resolveContextUploadConfig(config: PlatformConfig, contentType?: ContentData['contentType']) {
  // 图文和文章都可能使用 articleUpload 配置，但语义不同：
  // - 图文：多图上传区。
  // - 文章：长文章编辑器的就绪/上传区。
  // 平台内部仍会根据 contentType 决定具体上传流程。
  const isArticleLike = contentType === 'article' || contentType === 'image' || isArticleEditorContext(config, contentType);
  return isArticleLike && config.articleUpload ? config.articleUpload : config.upload;
}

/** 判断是否需要先点击“我要发文/写文章”等入口按钮进入真正编辑器。 */
function shouldClickArticleEntryButton(config: PlatformConfig, contentType?: ContentData['contentType']) {
  return Boolean(config.articleEntryButton && (contentType === 'article' || isLongArticlePage(location.href)));
}

/**
 * 判断当前 frame 是否应该接手填充。
 * 这解决 B站文章同源 iframe、视频号 wujie iframe、顶层壳页面同时收到消息导致的重复/误填问题。
 */
function canHandleFillInThisFrame(config: PlatformConfig, contentType?: ContentData['contentType']): 'handle' | 'skip' {
  const effectiveReadySelector = resolveReadySelector(config, contentType);
  if (window.top === window && config.id === 'bilibili' && contentType === 'article') {
    // B站文章编辑器在同源 iframe 内。顶层页面也会加载 content script，
    // 但真正的标题/正文 DOM 在 iframe。顶层如果也处理，会出现字段找不到或重复填充。
    const sameOriginIframes = findSameOriginIframesWithEditor(effectiveReadySelector);
    if (sameOriginIframes.length > 0) {
      return 'skip';
    }
  }

  if (querySelectorDeep(effectiveReadySelector) || hasReadyDomSignal(config, contentType)) {
    return 'handle';
  }

  // 顶层 frame：检查编辑器是否在同源 iframe 中（如 B站文章编辑器）。
  // 如果同源 iframe 已包含编辑器信号，本 frame 不处理，让 iframe 处理。
  if (window.top === window) {
    const sameOriginIframes = findSameOriginIframesWithEditor(effectiveReadySelector);
    if (sameOriginIframes.length > 0) {
      return 'skip';
    }
    // 视频号等 SPA 页面加载慢，顶层可能还没渲染，由 fillContent 内部等待。
    return 'handle';
  }

  // 子 iframe 只有在已经出现上传/编辑器信号时才处理；登录二维码 iframe、导航 iframe 等忽略。
  // B站文章编辑器在同源 iframe 中（/york/read-editor），但 URL 不匹配 articleEditorUrl。
  // 这里额外检查文章就绪选择器是否在当前 iframe 中存在。
  if (config.articleReadySelector && querySelectorDeep(config.articleReadySelector)) {
    return 'handle';
  }
  return 'skip';
}

/** 查找包含编辑器 ready selector 的同源 iframe，用于把填充权交给真正编辑器所在文档。 */
function findSameOriginIframesWithEditor(selector: string): HTMLIFrameElement[] {
  const iframes = Array.from(document.querySelectorAll('iframe'));
  const matched: HTMLIFrameElement[] = [];
  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument;
      if (!doc) continue;
      if (doc.querySelector(selector)) {
        matched.push(iframe);
      }
    } catch {
      // cross-origin iframe, skip
    }
  }
  return matched;
}

/** 上报当前平台页面是否 ready，并在文章入口页先点击入口按钮后交给新页面接管。 */
async function reportPageStatus(config: PlatformConfig) {
  await waitForIdle(PAGE_STATUS_INITIAL_DELAY_MS);
  const contentType = await getCurrentTaskContentType(config);

  // 文章入口页：先点击入口按钮进入编辑器，页面会导航，新 content script 会重新报告状态
  let isArticle = isArticleEditorContext(config, contentType);
  if (isArticle && shouldClickArticleEntryButton(config, contentType)) {
    // 只检查文章编辑器就绪选择器，不用 hasReadyDomSignal。
    // 抖音入口页/上传页可能已经有通用上传区，若用上传区作为 ready，会导致还没进入文章编辑器就开始填充。
    const effectiveReadySelector = resolveReadySelector(config, contentType);
    if (!querySelectorDeep(effectiveReadySelector)) {
      await clickArticleEntryButton(config);
      // 如果点了按钮，页面会导航，后续由新页面的 content script 接管
      return;
    }
  }

  const earlyBlocker = detectBlocker(config);
  if (earlyBlocker) {
    console.info('[PubFlow] page status', {
      platform: config.id,
      href: location.href,
      ready: false,
      blocker: earlyBlocker,
      readySelector: config.readySelector,
    });

    await browser.runtime
      .sendMessage({
        type: 'PAGE_STATUS',
        payload: {
          platformId: config.id,
          ready: false,
          blocked: true,
          requiresUserAction: true,
          message: earlyBlocker,
        },
      } satisfies RuntimeMessage)
      .catch(() => undefined);
    return;
  }

  isArticle = isArticleEditorContext(config, contentType);
  const uploadConfig = resolveContextUploadConfig(config, contentType);
  const effectiveReadySelector = resolveReadySelector(config, contentType);
  const ready = await waitForReadySignal(
    config,
    effectiveReadySelector,
    uploadConfig?.timeoutMs || DEFAULT_PAGE_READY_TIMEOUT_MS,
    contentType,
  );
  const blocker = detectBlocker(config);

  const message = !ready
    ? '页面还没准备好。请等待加载完成后再继续。'
    : blocker
      ? blocker
      : isArticle
        ? '页面已准备好，将自动上传图片并填充内容。'
        : '页面已准备好，将自动上传视频并填充内容。';

  console.info('[PubFlow] page status', {
    platform: config.id,
    href: location.href,
    contentType,
    isArticle,
    ready,
    blocker,
    readySelector: effectiveReadySelector,
  });

  await browser.runtime
    .sendMessage({
      type: 'PAGE_STATUS',
      payload: {
        platformId: config.id,
        ready,
        blocked: !ready || !!blocker,
        requiresUserAction: !!blocker,
        message,
      },
    } satisfies RuntimeMessage)
    .catch(() => undefined);
}

/** 监听 SPA/微前端 DOM 变化，在页面晚渲染 ready selector 时重新上报 ready 状态。 */
function observePageReady(config: PlatformConfig) {
  let reportedReady = false;
  const observer = new MutationObserver(async () => {
    if (reportedReady) return;
    const contentType = await getCurrentTaskContentType(config);
    const effectiveReadySelector = resolveReadySelector(config, contentType);
    if (!querySelectorDeep(effectiveReadySelector) && !hasReadyDomSignal(config, contentType)) return;
    reportedReady = true;
    observer.disconnect();
    void reportPageStatus(config);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  void getCurrentTaskContentType(config).then((contentType) => {
    const uploadConfig = resolveContextUploadConfig(config, contentType);
    window.setTimeout(() => observer.disconnect(), uploadConfig?.timeoutMs || DEFAULT_PAGE_READY_TIMEOUT_MS);
  });
}

/** 执行实际填充流程：选择平台处理器、切换 iframe 文档、回传成功或失败状态。 */
async function fillContent(config: PlatformConfig, content: ContentData, autoSubmit: boolean) {
  try {
    const isArticle = isArticleEditorContext(config, content.contentType);
    // isArticle 用于“当前上下文是否像文章编辑器”，image 也会返回 true；
    // isLongArticle 才表示真正的长文章发布，用来传给平台处理器选择 articleFields。
    const isLongArticle = content.contentType === 'article' || (content.contentType !== 'image' && isLongArticlePage(location.href));
    console.info('[PubFlow] fill content start', {
      platform: config.id,
      href: location.href,
      isArticle,
      isLongArticle,
      hasVideo: Boolean(content.videoCacheId),
      hasImages: Boolean(content.imageCacheIds?.length),
      hasCover: Boolean(content.coverCacheId),
      hasArticleContent: Boolean(content.articleContent),
    });

    const blocker = detectBlocker(config);
    if (blocker) {
      throw new Error(blocker);
    }

    // 文章模式：如果平台有入口按钮，先点击进入编辑器
    if (isLongArticle && shouldClickArticleEntryButton(config, content.contentType)) {
      await clickArticleEntryButton(config);
    }

    const handler = getPlatformContentHandler(config.id);
    if (!handler) {
      throw new Error(`未找到平台处理器：${config.id}`);
    }

    // 如果编辑器在同源 iframe 中（如 B站文章编辑器），要等入口跳转/iframe 渲染后再解析目标文档。
    const targetDoc = resolveFillTargetDocument(config, content.contentType);

    // 如果编辑器在 iframe 中，临时切换 DOM 查询和 execCommand 的目标文档
    if (targetDoc) {
      setOverrideDocument(targetDoc);
    }
    try {
      const message = await handler(config, content, isLongArticle);
      if (isFillFailureMessage(message)) {
        throw new Error(message);
      }

      if (autoSubmit && supportsDirectPublish(config.id)) {
        console.info('[PubFlow] final publish click requested', {
          platform: config.id,
          href: location.href,
        });
        await clickFinalPublishButton(config.id, content);
        return { ok: true } as const;
      }

      await browser.runtime.sendMessage({
        type: 'CONTENT_FILLED',
        payload: {
          platformId: config.id,
          message: autoSubmit
            ? `${message}当前平台暂不支持直接发布，已保留页面等待确认。`
            : message,
        },
      } satisfies RuntimeMessage);

      console.info('[PubFlow] fill content completed', {
        platform: config.id,
        href: location.href,
      });

      return { ok: true } as const;
    } finally {
      if (targetDoc) {
        setOverrideDocument(null);
      }
    }
  } catch (error) {
    console.error('[PubFlow] fill content failed', error instanceof Error ? error : new Error(String(error)), {
      platform: config.id,
      href: location.href,
      error: error instanceof Error ? error.message : '填充失败',
    });

    await browser.runtime.sendMessage({
      type: 'FILL_ERROR',
      payload: {
        platformId: config.id,
        error: error instanceof Error ? error.message : '填充失败',
      },
    } satisfies RuntimeMessage);

    return { ok: false, error: error instanceof Error ? error.message : '填充失败' } as const;
  }
}

/** 解析真正需要填充的文档；顶层页面若发现同源 iframe 编辑器，会临时切换 DOM 查询目标。 */
function resolveFillTargetDocument(config: PlatformConfig, contentType?: ContentData['contentType']) {
  if (window.top !== window) return undefined;
  if (config.id === 'bilibili' && contentType === 'article') return undefined;
  const effectiveReadySelector = resolveReadySelector(config, contentType);
  const iframes = findSameOriginIframesWithEditor(effectiveReadySelector);
  return iframes[0]?.contentDocument || undefined;
}

/** 根据平台处理器返回的中文结果判断是否应该当作失败回传给侧边栏。 */
function isFillFailureMessage(message: string) {
  return /没有等到|没有找到|未找到|没有打开|未打开|未关闭|未点击确认|未确认|未就绪|上传失败|填充失败|没有设置|不是\s*contenteditable|不存在|请检查封面预览/.test(message);
}

/** 点击文章入口按钮，例如抖音“我要发文”，等待导航或编辑器渲染后再继续。 */
async function clickArticleEntryButton(config: PlatformConfig) {
  if (!config.articleEntryButton) return;

  const selectors = config.articleEntryButton.split(',').map(s => s.trim());
  let button: HTMLElement | null = null;

  // 等待按钮出现
  const startedAt = Date.now();
  while (Date.now() - startedAt < ARTICLE_ENTRY_BUTTON_TIMEOUT_MS) {
    for (const selector of selectors) {
      // 尝试用 :has-text 伪选择器
      if (selector.includes(':has-text(')) {
        const match = selector.match(/^(.+?):has-text\("(.+?)"\)$/);
        if (match) {
          const [, tag, text] = match;
          const elements = document.querySelectorAll<HTMLElement>(tag);
          for (const el of elements) {
            if (el.textContent?.trim().includes(text) && el.offsetParent !== null) {
              button = el;
              break;
            }
          }
        }
      } else {
        button = document.querySelector<HTMLElement>(selector);
      }
      if (button) break;
    }
    if (button) break;
    await waitForIdle(ARTICLE_ENTRY_BUTTON_POLL_MS);
  }

  if (!button) {
    console.warn('[PubFlow] article entry button not found', { selectors });
    return;
  }

  console.info('[PubFlow] clicking article entry button', { text: button.textContent?.trim() });
  button.click();

  // 等待页面跳转或编辑器加载
  await waitForIdle(ARTICLE_ENTRY_NAVIGATION_SETTLE_MS);
}

/** 等待 selector、上传区或视频号 MAIN world ready 信号，统一处理慢加载页面。 */
async function waitForReadySignal(
  config: PlatformConfig,
  selector: string,
  timeoutMs: number,
  contentType?: ContentData['contentType'],
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (querySelectorDeep(selector)) return true;
    if (hasReadyDomSignal(config, contentType)) return true;
    if (config.id === 'weixinChannels' && isWujieReadyCheckPending() && await resolveReadyDomSignal(config, contentType)) {
      return true;
    }
    await waitForIdle(READY_SIGNAL_POLL_MS);
  }
  return false;
}

/** 检查当前 DOM 是否已有上传区/编辑区信号，作为 selector 未命中时的兜底 ready 判断。 */
function hasReadyDomSignal(config: PlatformConfig, contentType?: ContentData['contentType']) {
  const isArticle = isArticleEditorContext(config, contentType);

  // 文章页面：优先检查 articleReadySelector
  if (shouldUseArticleReadySelector(config, contentType) && config.articleReadySelector) {
    if (querySelectorDeep(config.articleReadySelector)) return true;
  }

  const uploadConfig = resolveContextUploadConfig(config, contentType);

  if (!uploadConfig) {
    return false;
  }

  const hasInput = Boolean(findElement(uploadConfig.fileInputSelector));
  const hasUploadContainer = Boolean(
    uploadConfig.uploadContainerSelector && querySelectorDeep(uploadConfig.uploadContainerSelector),
  );
  const hasDropContainer = Boolean(
    uploadConfig.dropContainerSelector?.some((selector) => Boolean(querySelectorDeep(selector))),
  );
  const hasEditor = Boolean(
    uploadConfig.editorReadySelector && querySelectorDeep(uploadConfig.editorReadySelector),
  );

  if (hasInput || hasUploadContainer || hasDropContainer || hasEditor) {
    return true;
  }

  if (config.id === 'weixinChannels') {
    return checkReadyViaPageScript(config, uploadConfig);
  }

  return false;
}

type WujieReadyState = 'ready' | 'not-ready' | 'pending';

let wujieReadyCache: { result: boolean; time: number } | null = null;
let wujieReadyPromise: Promise<boolean> | null = null;

/** 等待正在进行的视频号 MAIN world ready 检查完成，避免重复注入脚本。 */
async function resolveReadyDomSignal(config: PlatformConfig, contentType?: ContentData['contentType']): Promise<boolean> {
  if (hasReadyDomSignal(config, contentType)) return true;
  if (config.id !== 'weixinChannels' || !isWujieReadyCheckPending()) return false;

  return wujieReadyPromise ?? false;
}

/** 判断视频号 MAIN world ready 检查是否仍在进行。 */
function isWujieReadyCheckPending(): boolean {
  return !!wujieReadyPromise;
}

/** 通过 background 在 MAIN world 执行视频号 ready 检查，解决 isolated world 看不到真实 wujie 状态的问题。 */
function checkReadyViaPageScript(config: PlatformConfig, uploadConfig: PlatformConfig['upload'] | PlatformConfig['articleUpload']): boolean {
  return getWujieReadyState(config, uploadConfig) === 'ready';
}

/** 获取视频号 wujie ready 状态，并用短缓存降低 MutationObserver 高频触发成本。 */
function getWujieReadyState(
  config: PlatformConfig,
  uploadConfig: PlatformConfig['upload'] | PlatformConfig['articleUpload'],
): WujieReadyState {
  if (wujieReadyCache && Date.now() - wujieReadyCache.time < WUJIE_READY_CACHE_MS) {
    return wujieReadyCache.result ? 'ready' : 'not-ready';
  }

  if (!wujieReadyPromise) {
    wujieReadyPromise = browser.runtime.sendMessage({
      type: 'CHECK_WUJIE_READY',
      payload: {
        readySelector: config.readySelector,
        editorSelector: uploadConfig?.editorReadySelector || '',
        fileInputSelectors: uploadConfig?.fileInputSelector || [],
        uploadContainerSelector: uploadConfig?.uploadContainerSelector || '',
      },
    } satisfies RuntimeMessage)
      .then((result: unknown) => {
        const res = result as { ok?: boolean; data?: { result?: boolean } };
        const ready = !!res?.data?.result;
        wujieReadyCache = { result: ready, time: Date.now() };
        return ready;
      })
      .catch(() => {
        wujieReadyCache = { result: false, time: Date.now() };
        return false;
      })
      .finally(() => {
        wujieReadyPromise = null;
      });
  }

  return 'pending';
}
