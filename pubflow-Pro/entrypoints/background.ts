import {
  getPlatformConfig,
  supportsContentType,
  type PlatformConfig,
} from '../src/platforms';
import { injectDouyinArticleCover, injectDouyinCover } from '../src/platforms/douyin/pageWorld';
import { injectXiaohongshuImageDescription } from '../src/platforms/xiaohongshu/pageWorld';
import { runWeixinChannelsPageWorldAction } from '../src/platforms/weixinChannels/pageWorld';
import type { PageWorldAction, PageWorldPayload } from '../src/platforms/weixinChannels/pageWorld';
import { loadLibraryData, saveLibraryData } from '../src/storage/libraryStorage';
import { loadCurrentTask, saveCurrentTask } from '../src/storage/taskStorage';
import { hasLicenseCredentials, loadLicensingSettings, saveLicensingSettings } from '../src/licensing/licenseStorage';
import { verifyLicense } from '../src/licensing/licenseManager';
import { issueDistributionPermit } from '../src/licensing/permitManager';
import { checkExtensionUpdate } from '../src/licensing/updateChecker';
import type {
  DistributionTask,
  LicensingSettings,
  PlatformId,
  PlatformStatus,
  PlatformTaskStatus,
  PublishRecord,
  RuntimeMessage,
  RuntimeResponse,
  VideoRecord,
} from '../src/types';

declare const chrome: typeof browser & {
  scripting: {
    executeScript(options: {
      target: { tabId: number };
      world?: 'MAIN' | 'ISOLATED';
      func: (...args: unknown[]) => unknown | Promise<unknown>;
      args?: unknown[];
    }): Promise<Array<{ result: unknown }>>;
  };
};

let currentTask: DistributionTask | null = null;
let licensingSettings: LicensingSettings | null = null;
let restoreTaskPromise: Promise<void> | null = null;
const sidePanelPorts = new Set<Browser.runtime.Port>();
const FILL_COMMAND_MAX_RETRIES = 6;
const FILL_COMMAND_RETRY_DELAY_MS = 3000;
const FILL_COMMAND_ACK_TIMEOUT_MS = 2500;
const OPEN_PLATFORM_AUTOFILL_FALLBACK_MS = 4000;
const OPENING_STATUS_REFRESH_MS = 6000;
const FILL_COMPLETION_GRACE_MS = 120000;
const FILL_COMPLETION_MIN_TIMEOUT_MS = 180000;
const NON_VIDEO_FILL_COMPLETION_TIMEOUT_MS = 120000;
const CDP_CLICK_MOVE_SETTLE_MS = 120;
const pendingFillAcks = new Map<string, () => void>();
const fillingPlatforms = new Set<PlatformId>();
const fillCompletionTimers = new Map<PlatformId, ReturnType<typeof setTimeout>>();

export default defineBackground(() => {
  restoreTaskPromise = restoreTask();
  void checkExtensionUpdate(__PUBFLOW_DEFAULT_LICENSE_API_BASE_URL__, __PUBFLOW_OFFICIAL_SITE_URL__);

  browser.action.onClicked.addListener(async () => {
    try {
      await openDashboard();
    } catch (error) {
      console.error('[PubFlow] 打开 Dashboard 失败', error);
    }
  });

  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    console.error('[PubFlow] 设置侧边栏行为失败', error);
  });

  browser.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
    return handleMessage(message, sender);
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'pubflow-sidepanel') return;
    sidePanelPorts.add(port);
    void broadcastSidePanelStatus();
    port.onDisconnect.addListener(() => {
      sidePanelPorts.delete(port);
      void broadcastSidePanelStatus();
    });
  });
});

async function handleMessage(
  message: RuntimeMessage,
  sender: Browser.runtime.MessageSender,
): Promise<RuntimeResponse> {
  try {
    await ensureTaskRestored();

    if (message.type === 'GET_TASK') {
      await normalizeAndPersistCurrentTask();
      return ok(currentTask);
    }

    if (message.type === 'OPEN_DASHBOARD') {
      await openDashboard();
      return ok(currentTask);
    }

    if (message.type === 'GET_SIDE_PANEL_STATUS') {
      return ok({ open: sidePanelPorts.size > 0 });
    }

    if (message.type === 'GET_LICENSE_STATUS') {
      await ensureLicensingLoaded();
      return ok(licensingSettings);
    }

    if (message.type === 'VERIFY_LICENSE') {
      const result = await verifyCurrentLicense(message.payload?.licensingSettings);
      return result.ok ? ok(result.settings) : fail(result.error || result.settings.statusMessage || '授权验证失败');
    }

    if (message.type === 'HANDLE_WEIXIN_DECLARE_POPUP') {
      try {
        return ok(await executeWeixinPageWorldAction(sender, 'handleDeclarePopup', {}));
      } catch (error) {
        return fail(error instanceof Error ? error.message : '弹窗处理失败');
      }
    }

    if (message.type === 'CDP_CLICK') {
      const tabId = sender.tab?.id;
      if (!tabId) {
        return fail('无法确定目标标签页');
      }
      try {
        await cdpClick(tabId, message.payload.x, message.payload.y);
        return ok(undefined);
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'CDP 点击失败');
      }
    }

    if (message.type === 'HANDLE_WEIXIN_SCHEDULE') {
      try {
        return ok(await executeWeixinPageWorldAction(sender, 'handleSchedule', { scheduledAt: message.payload.scheduledAt }));
      } catch (error) {
        return fail(error instanceof Error ? error.message : '视频号定时发布处理失败');
      }
    }

    if (message.type === 'CHECK_WUJIE_READY') {
      try {
        const { readySelector, editorSelector, fileInputSelectors, uploadContainerSelector } = message.payload;
        const result = await executeWeixinPageWorldAction<boolean>(sender, 'checkReady', {
          readySelector,
          editorSelector,
          fileInputSelectors,
          uploadContainerSelector,
        }) ?? false;
        return ok({ result });
      } catch {
        return ok({ result: false });
      }
    }

    if (message.type === 'WAIT_WEIXIN_READY') {
      try {
        return ok(await executeWeixinPageWorldAction(sender, 'waitReady', {
          selector: message.payload.selector,
          timeoutMs: message.payload.timeoutMs,
        }));
      } catch (error) {
        return fail(error instanceof Error ? error.message : '视频号页面就绪检查失败');
      }
    }

    if (message.type === 'EXECUTE_IN_PAGE_WORLD') {
      try {
        const { title, topics, description, skipTitle } = message.payload;
        return ok(await executeWeixinPageWorldAction(sender, 'fillEditor', { title, topics, description, skipTitle }));
      } catch (error) {
        return fail(error instanceof Error ? error.message : '页面脚本执行失败');
      }
    }

    if (message.type === 'UPLOAD_FILE_IN_PAGE_WORLD') {
      try {
        return ok(await executeWeixinPageWorldAction(sender, 'uploadFile', message.payload));
      } catch (error) {
        return fail(error instanceof Error ? error.message : '页面脚本上传失败');
      }
    }

    if (message.type === 'UPLOAD_IMAGES_IN_PAGE_WORLD') {
      try {
        return ok(await executeWeixinPageWorldAction(sender, 'uploadImages', message.payload));
      } catch (error) {
        return fail(error instanceof Error ? error.message : '页面脚本图片上传失败');
      }
    }

    if (message.type === 'FILL_WEIXIN_SHORT_TITLE') {
      try {
        return ok(await executeWeixinPageWorldAction(sender, 'fillShortTitle', { title: message.payload.title }));
      } catch (error) {
        return fail(error instanceof Error ? error.message : '视频号短标题填充失败');
      }
    }

    if (message.type === 'FILL_WEIXIN_ARTICLE_TITLE') {
      try {
        return ok(await executeWeixinPageWorldAction(sender, 'fillArticleTitle', { title: message.payload.title }));
      } catch (error) {
        return fail(error instanceof Error ? error.message : '视频号图文标题填充失败');
      }
    }

    if (message.type === 'UPLOAD_COVER_IN_PAGE_WORLD') {
      try {
        return ok(await executeWeixinPageWorldAction(sender, 'uploadCover', message.payload));
      } catch (error) {
        return fail(error instanceof Error ? error.message : '页面脚本封面上传失败');
      }
    }

    if (message.type === 'DOUYIN_UPLOAD_COVER') {
      // 抖音视频封面弹窗运行在页面主世界的 React/Semi Upload 组件里。
      // content script 的隔离世界拿不到 React fiber 和组件实例，
      // 所以这里通过 chrome.scripting.executeScript({ world: 'MAIN' }) 进入页面主世界。
      const tabId = sender.tab?.id;
      if (!tabId) {
        return fail('无法确定目标标签页');
      }
      try {
        const { fileName, fileType, fileDataBase64 } = message.payload;
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: injectDouyinCover,
          args: [fileName, fileType, fileDataBase64],
        });
        const result = results?.[0]?.result as { ok: boolean; error?: string } | undefined;
        return ok(result);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '抖音封面上传失败');
      }
    }

    if (message.type === 'DOUYIN_UPLOAD_ARTICLE_COVER') {
      // 抖音文章封面不是 Semi Upload。它点击“+替换封面”时才临时创建 file input，
      // 文件选择后 input 会立即移除。这个瞬时行为只能在 MAIN world 拦截 input.click() 完成。
      const tabId = sender.tab?.id;
      if (!tabId) {
        return fail('无法确定目标标签页');
      }
      try {
        const { fileName, fileType, fileDataBase64 } = message.payload;
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: injectDouyinArticleCover,
          args: [fileName, fileType, fileDataBase64],
        });
        const result = results?.[0]?.result as { ok: boolean; error?: string } | undefined;
        return ok(result);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '抖音文章封面上传失败');
      }
    }

    if (message.type === 'XIAOHONGSHU_FILL_IMAGE_DESCRIPTION') {
      const tabId = sender.tab?.id;
      if (!tabId) {
        return fail('无法确定目标标签页');
      }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: injectXiaohongshuImageDescription,
          args: [message.payload.description],
        });
        const result = results?.[0]?.result as { ok: boolean; error?: string } | undefined;
        return ok(result);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '小红书图文描述填充失败');
      }
    }

    if (message.type === 'START_DISTRIBUTION') {
      clearAllFillCompletionTimeouts();
      const license = await requireActiveLicense();
      if (!license.ok) {
        return fail(license.error || license.settings.statusMessage || '授权无效，请先在设置中完成激活。');
      }
      // TODO(remote-selector): 远程 selector 曾用于发布前动态下发平台策略，但当前 selector 已全部内置在
      // src/platforms。为了降低开始发布的延迟和失败点，暂时废弃云端 selector 刷新；后续如果恢复，
      // 需要做成后台异步刷新，不能阻塞用户点击发布后的主链路。
      // await refreshRemotePlatformPolicyForLicense(license.settings);
      const supportedPlatforms = message.payload.platforms.filter((platformId) =>
        supportsContentType(getPlatformConfig(platformId), message.payload.content.contentType || 'video'),
      );
      if (!supportedPlatforms.length) {
        return fail('当前内容类型没有可发布的平台，请检查目标平台选择。');
      }
      const permit = await issueDistributionPermit(license.settings, {
        content: message.payload.content,
        platforms: supportedPlatforms,
        videoId: message.payload.videoId,
      });
      currentTask = {
        id: crypto.randomUUID(),
        videoId: message.payload.videoId,
        content: message.payload.content,
        platforms: supportedPlatforms.map((platformId) => ({
          platformId,
          status: 'pending',
        })),
        currentIndex: 0,
        status: 'running',
        createdAt: Date.now(),
        permitId: permit.permitId,
        permitExpiresAt: permit.expiresAt,
        permitTaskHash: permit.taskHash,
      };
      await persistAndBroadcast();
      const first = currentTask.platforms[0];
      if (first) {
        await openPlatform(first.platformId);
      }
      return ok(currentTask);
    }

    if (message.type === 'OPEN_PLATFORM') {
      ensureTask();
      // TODO(auth-ux): 当前产品优先保证一轮发布过程顺滑，授权/permit 只在 START_DISTRIBUTION 入口校验。
      // 后续如果风险升高，可以恢复这里的过程校验，但应做成低频缓存校验，避免每个平台打开都请求服务器。
      // const license = await requireActiveLicense();
      // await refreshRemotePlatformPolicyForLicense(license.settings);
      await openPlatform(message.payload.platformId);
      return ok(currentTask);
    }

    if (message.type === 'CONTINUE_FILL') {
      ensureTask();
      // TODO(auth-ux): 当前产品优先保证一轮发布过程顺滑，授权/permit 只在 START_DISTRIBUTION 入口校验。
      // 后续如果风险升高，可以恢复这里的过程校验，但应做成低频缓存校验，避免每个填充步骤都请求服务器。
      // const license = await requireActiveLicense();
      // await refreshRemotePlatformPolicyForLicense(license.settings);
      await continueFill(message.payload.platformId);
      return ok(currentTask);
    }

    if (message.type === 'SKIP_PLATFORM') {
      ensureTask();
      updatePlatform(message.payload.platformId, {
        status: 'skipped',
        message: '用户已跳过',
      });
      await persistAndBroadcast();
      await openNextPending();
      return ok(currentTask);
    }

    if (message.type === 'PAUSE_TASK') {
      const task = ensureTask();
      task.status = 'paused';
      await persistAndBroadcast();
      return ok(currentTask);
    }

    if (message.type === 'RESUME_TASK') {
      const task = ensureTask();
      task.status = 'running';
      await persistAndBroadcast();
      return ok(currentTask);
    }

    if (message.type === 'PAGE_STATUS') {
      const tabId = sender.tab?.id;
      const platformTask = currentTask?.platforms.find(
        (item) => item.platformId === message.payload.platformId,
      );
      if (!isMessageFromPlatformTask(message.payload.platformId, sender)) {
        return ok(currentTask);
      }
      if (platformTask && !['opening', 'waitingUser'].includes(platformTask.status)) {
        return ok(currentTask);
      }
      const needsUserAction = message.payload.requiresUserAction === true;
      updatePlatform(message.payload.platformId, {
        tabId,
        frameId: sender.frameId,
        status: needsUserAction ? 'waitingUser' : message.payload.ready ? 'ready' : 'opening',
        message: message.payload.message,
      });
      await persistAndBroadcast();
      if (message.payload.ready === true && !needsUserAction && currentTask?.status === 'running') {
        void continueFill(message.payload.platformId);
      }
      return ok(currentTask);
    }

    if (message.type === 'CONTENT_FILLED') {
      if (!isMessageFromPlatformTask(message.payload.platformId, sender)) {
        return ok(currentTask);
      }
      const platformTask = currentTask?.platforms.find(
        (item) => item.platformId === message.payload.platformId,
      );
      if (platformTask?.status !== 'filling') {
        return ok(currentTask);
      }
      clearFillCompletionTimeout(message.payload.platformId);
      if (isFillFailureMessage(message.payload.message)) {
        updatePlatform(message.payload.platformId, {
          status: 'error',
          error: message.payload.message,
        });
        await persistAndBroadcast();
        await openNextPending();
        return ok(currentTask);
      }
      updatePlatform(message.payload.platformId, {
        status: 'filled',
        message: message.payload.message,
      });
      await persistAndBroadcast();
      await openNextPending();
      return ok(currentTask);
    }

    if (message.type === 'FILL_CONTENT_ACK') {
      if (!isMessageFromPlatformTask(message.payload.platformId, sender)) {
        return ok(currentTask);
      }
      const resolveAck = pendingFillAcks.get(message.payload.requestId);
      if (resolveAck) {
        pendingFillAcks.delete(message.payload.requestId);
        resolveAck();
      }
      return ok(currentTask);
    }

    if (message.type === 'FILL_ERROR') {
      if (!isMessageFromPlatformTask(message.payload.platformId, sender)) {
        return ok(currentTask);
      }
      const platformTask = currentTask?.platforms.find(
        (item) => item.platformId === message.payload.platformId,
      );
      if (platformTask?.status !== 'filling') {
        return ok(currentTask);
      }
      clearFillCompletionTimeout(message.payload.platformId);
      updatePlatform(message.payload.platformId, {
        status: 'error',
        error: message.payload.error,
      });
      await persistAndBroadcast();
      await openNextPending();
      return ok(currentTask);
    }

    return fail('未知消息');
  } catch (error) {
    return fail(error instanceof Error ? error.message : '操作失败');
  }
}

/** 判断消息是否来自当前任务绑定的平台 tab，避免旧标签页回传状态污染新任务。 */
function isMessageFromPlatformTask(platformId: PlatformId, sender: Browser.runtime.MessageSender) {
  const platformTask = currentTask?.platforms.find((item) => item.platformId === platformId);
  if (!platformTask?.tabId || !sender.tab?.id) return false;
  return platformTask.tabId === sender.tab.id;
}

/** 在视频号页面 MAIN world 执行操作，解决 isolated content script 无法直接访问 wujie 内部状态的问题。 */
async function executeWeixinPageWorldAction<T = { ok: boolean; error?: string }>(
  sender: Browser.runtime.MessageSender,
  action: PageWorldAction,
  payload: PageWorldPayload,
): Promise<T | undefined> {
  const tabId = sender.tab?.id;
  if (!tabId) {
    throw new Error('无法确定目标标签页');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: runWeixinChannelsPageWorldAction as (...args: unknown[]) => Promise<unknown>,
    args: [action, payload],
  });
  return results?.[0]?.result as T | undefined;
}

/** 打开目标平台编辑页，并登记 tab、状态和自动填充兜底计时器。 */
async function openPlatform(platformId: PlatformId) {
  const config = getPlatformConfig(platformId);
  const content = currentTask?.content;
  const editorUrl = resolveEditorUrl(config, content);
  const uploadConfig = resolveUploadConfig(config, content);
  clearFillCompletionTimeout(platformId);
  const tab = await browser.tabs.create({
    url: editorUrl,
    active: !!uploadConfig?.requiresActiveTab,
  });

  updatePlatform(platformId, {
    tabId: tab.id,
    status: 'opening',
    message: '页面打开中，准备自动上传并填充。',
  });
  await persistAndBroadcast();
  scheduleOpenPlatformAutofillFallback(platformId, tab.id);
  scheduleOpeningStatusRefresh(platformId, tab.id);
}

/** 打开或聚焦 PubFlow Dashboard。 */
async function openDashboard() {
  const url = browser.runtime.getURL('dashboard.html' as never);
  const existing = await browser.tabs.query({ url });
  if (existing[0]?.id) {
    await browser.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId) {
      await browser.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }
  await browser.tabs.create({ url, active: true });
}

/** 向平台页发送填充指令，并等待某个 frame 用 requestId 回执“我已接手”。 */
async function continueFill(platformId: PlatformId) {
  if (fillingPlatforms.has(platformId)) {
    return;
  }
  const platformTask = currentTask?.platforms.find((item) => item.platformId === platformId);
  if (!platformTask?.tabId) {
    throw new Error('找不到平台标签页，请先打开平台。');
  }
  if (platformTask.status === 'filling') {
    return;
  }
  if (!currentTask) {
    throw new Error('没有正在运行的任务。');
  }

  fillingPlatforms.add(platformId);
  try {
    updatePlatform(platformId, {
      status: 'filling',
      message: '已发送填充指令',
      error: undefined,
    });
    await persistAndBroadcast();

    const config = getPlatformConfig(platformId);
    const uploadConfig = resolveUploadConfig(config, currentTask.content);
    if (uploadConfig?.requiresActiveTab) {
      await browser.tabs.update(platformTask.tabId, { active: true });
    }

    // 视频号等 SPA 页面加载慢，content script 可能还没注册 listener，需要重试。
    let lastError: Error | undefined;

    const requestId = crypto.randomUUID();
    const message = {
      type: 'FILL_CONTENT',
      payload: {
        content: currentTask.content,
        platformId,
        requestId,
      },
    } satisfies RuntimeMessage;

    for (let attempt = 0; attempt < FILL_COMMAND_MAX_RETRIES; attempt++) {
      let ack: ReturnType<typeof waitForFillContentAck> | undefined;
      try {
        // frameId can become stale after reload/navigation. Broadcasting lets each
        // content script decide whether its frame owns the current editor.
        ack = waitForFillContentAck(requestId);
        await browser.tabs.sendMessage(platformTask.tabId, message);
        await ack.promise;

        console.info('[PubFlow] fill command accepted', {
          platformId,
          tabId: platformTask.tabId,
          frameId: platformTask.frameId,
          attempt: attempt + 1,
        });
        scheduleFillCompletionTimeout(platformId, platformTask.tabId);

        // 发送成功，content script 已接收并已立即回执。
        return;
      } catch (error) {
        ack?.cancel();
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn('[PubFlow] fill command failed', {
          platformId,
          tabId: platformTask.tabId,
          frameId: platformTask.frameId,
          attempt: attempt + 1,
          error: lastError.message,
        });
        if (shouldReloadForMissingReceiver(lastError)) {
          await browser.tabs.reload(platformTask.tabId);
          await new Promise((resolve) => setTimeout(resolve, FILL_COMMAND_RETRY_DELAY_MS));
        }
        if (attempt < FILL_COMMAND_MAX_RETRIES - 1) {
          await new Promise((resolve) => setTimeout(resolve, FILL_COMMAND_RETRY_DELAY_MS));
        }
      }
    }

    updatePlatform(platformId, {
      status: 'error',
      error: lastError?.message || 'content script 未响应，请刷新页面后重试。',
    });
    await persistAndBroadcast();
    await openNextPending();
  } finally {
    fillingPlatforms.delete(platformId);
  }
}

/** 页面已 ready 但 PAGE_STATUS 自动触发没推进时，兜底调用 continueFill，避免停在“可填充”。 */
function scheduleOpenPlatformAutofillFallback(platformId: PlatformId, tabId: number | undefined) {
  if (!tabId) return;
  globalThis.setTimeout(() => {
    const platformTask = currentTask?.platforms.find((item) => item.platformId === platformId);
    if (!currentTask || currentTask.status !== 'running') return;
    if (!platformTask || platformTask.tabId !== tabId) return;
    if (platformTask.status !== 'ready') return;
    void continueFill(platformId);
  }, OPEN_PLATFORM_AUTOFILL_FALLBACK_MS);
}

/** 打开平台后主动请求一次页面状态，解决 content script 比 background 消息晚注册的问题。 */
function scheduleOpeningStatusRefresh(platformId: PlatformId, tabId: number | undefined) {
  if (!tabId) return;
  globalThis.setTimeout(() => {
    const platformTask = currentTask?.platforms.find((item) => item.platformId === platformId);
    if (!currentTask || currentTask.status !== 'running') return;
    if (!platformTask || platformTask.tabId !== tabId || platformTask.status !== 'opening') return;
    void browser.tabs.sendMessage(tabId, {
      type: 'REQUEST_PAGE_STATUS',
      payload: { platformId },
    } satisfies RuntimeMessage).catch(() => undefined);
  }, OPENING_STATUS_REFRESH_MS);
}

/** 计算填充完成超时；视频要包含上传时长，图文/文章通常只需要等待 DOM 注入和文本填充。 */
function getFillCompletionTimeoutMs(platformId: PlatformId) {
  const contentType = currentTask?.content.contentType || 'video';
  if (contentType !== 'video') {
    return NON_VIDEO_FILL_COMPLETION_TIMEOUT_MS;
  }
  const config = getPlatformConfig(platformId);
  const uploadConfig = resolveUploadConfig(config, currentTask?.content);
  return Math.max(
    FILL_COMPLETION_MIN_TIMEOUT_MS,
    (uploadConfig?.timeoutMs || FILL_COMPLETION_MIN_TIMEOUT_MS) + FILL_COMPLETION_GRACE_MS,
  );
}

/** 给正在填充的平台挂超时保护，避免某个平台一直不回传导致后续平台全部卡住。 */
function scheduleFillCompletionTimeout(platformId: PlatformId, tabId: number | undefined) {
  clearFillCompletionTimeout(platformId);
  if (!tabId) return;
  const timeoutMs = getFillCompletionTimeoutMs(platformId);
  const timer = globalThis.setTimeout(() => {
    void handleFillCompletionTimeout(platformId, tabId, timeoutMs);
  }, timeoutMs);
  fillCompletionTimers.set(platformId, timer);
}

/** 填充超时后的失败落库和顺序发布推进。 */
async function handleFillCompletionTimeout(platformId: PlatformId, tabId: number, timeoutMs: number) {
  fillCompletionTimers.delete(platformId);
  const platformTask = currentTask?.platforms.find((item) => item.platformId === platformId);
  if (!currentTask || currentTask.status !== 'running') return;
  if (!platformTask || platformTask.tabId !== tabId || platformTask.status !== 'filling') return;

  updatePlatform(platformId, {
    status: 'error',
    error: `平台超过 ${Math.round(timeoutMs / 1000)} 秒没有返回填充结果，已继续下一个平台。`,
  });
  await persistAndBroadcast();
  await openNextPending();
}

/** 清理单个平台的填充超时计时器。 */
function clearFillCompletionTimeout(platformId: PlatformId) {
  const timer = fillCompletionTimers.get(platformId);
  if (timer) {
    clearTimeout(timer);
    fillCompletionTimers.delete(platformId);
  }
}

/** 清理所有填充超时计时器，通常在任务结束或重置任务时调用。 */
function clearAllFillCompletionTimeouts() {
  for (const timer of fillCompletionTimers.values()) {
    clearTimeout(timer);
  }
  fillCompletionTimers.clear();
}

/** 判断是否因为 content script 尚未注册/页面刷新导致无接收端，需要 reload 后重试。 */
function shouldReloadForMissingReceiver(error: Error) {
  return /Receiving end does not exist|Could not establish connection/i.test(error.message);
}

/** 从平台处理器的中文返回文案中识别失败态，统一转换为侧边栏 error。 */
function isFillFailureMessage(message: string) {
  return /没有等到|没有找到|未找到|没有打开|未打开|未关闭|未点击确认|未确认|未就绪|上传失败|填充失败|没有设置|不是\s*contenteditable|不存在|请检查封面预览/.test(message);
}

/** 等待 content script 回执接手填充；广播到多 frame 时用它确认不是发给了空壳 frame。 */
function waitForFillContentAck(requestId: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => {
      pendingFillAcks.delete(requestId);
      reject(new Error('没有编辑器 frame 接手填充指令，继续等待页面就绪。'));
    }, FILL_COMMAND_ACK_TIMEOUT_MS);

    pendingFillAcks.set(requestId, () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return {
    promise,
    cancel: () => {
      if (timer) clearTimeout(timer);
      pendingFillAcks.delete(requestId);
    },
  };
}

/** 按内容类型解析打开地址：视频、图文、文章可能对应同一平台的不同入口。 */
function resolveEditorUrl(config: PlatformConfig, content?: DistributionTask['content']) {
  const contentType = content?.contentType;
  const isImagePost = contentType === 'image' || (!contentType && Boolean(content?.imageCacheIds?.length));
  if (contentType === 'article') {
    return config.articlePageUrl || config.articleEditorUrl || config.editorUrl;
  }
  if (isImagePost) {
    return config.articleEditorUrl || config.editorUrl;
  }
  return config.editorUrl;
}

/** 按内容类型解析上传配置；图文和文章优先 articleUpload，视频走 upload。 */
function resolveUploadConfig(config: PlatformConfig, content?: DistributionTask['content']) {
  const contentType = content?.contentType;
  const isImagePost = contentType === 'image' || (!contentType && Boolean(content?.imageCacheIds?.length));
  if (contentType === 'article') {
    return config.articleUpload || config.upload;
  }
  if (isImagePost) {
    return config.articleUpload || config.upload;
  }
  return config.upload;
}

/** 顺序发布模式下打开下一个 pending 平台，没有待处理项则结束任务。 */
async function openNextPending() {
  if (!currentTask) return;
  normalizeCurrentTaskPlatforms();
  const next = findNextSequentialPendingPlatform();
  if (!next) {
    if (currentTask.platforms.every((item) => isTerminalPlatformStatus(item.status))) {
      currentTask.status = 'completed';
      await persistAndBroadcast();
    }
    return;
  }
  await openPlatform(next.platformId);
}

/** 找到顺序队列中下一个待打开的平台。 */
function findNextSequentialPendingPlatform() {
  if (!currentTask) return undefined;
  for (const platform of currentTask.platforms) {
    if (platform.status === 'pending') return platform;
    if (!isTerminalPlatformStatus(platform.status)) return undefined;
  }
  return undefined;
}

/** 判断平台状态是否已经结束，不需要再等待或继续打开。 */
function isTerminalPlatformStatus(status: PlatformTaskStatus) {
  return ['filled', 'published', 'skipped', 'error'].includes(status);
}

/**
 * 归一化当前任务的平台列表。
 * 当内容类型切换到文章/图文时，会过滤掉不支持该内容类型的平台，避免继续/重发打开错误页面。
 */
function normalizeCurrentTaskPlatforms() {
  if (!currentTask) return false;
  const before = getTaskNormalizationSignature(currentTask);
  const contentType = currentTask.content.contentType || 'video';
  currentTask.platforms = currentTask.platforms.filter((item) =>
    supportsContentType(getPlatformConfig(item.platformId), contentType),
  );
  if (currentTask.currentIndex >= currentTask.platforms.length) {
    currentTask.currentIndex = Math.max(0, currentTask.platforms.length - 1);
  }
  if (
    currentTask.status === 'running' &&
    (
      currentTask.platforms.length === 0 ||
      currentTask.platforms.every((item) => isTerminalPlatformStatus(item.status))
    )
  ) {
    currentTask.status = 'completed';
  }
  return before !== getTaskNormalizationSignature(currentTask);
}

/** 生成任务关键状态签名，用于判断 normalize 是否真的改动了任务。 */
function getTaskNormalizationSignature(task: DistributionTask) {
  return JSON.stringify({
    status: task.status,
    currentIndex: task.currentIndex,
    platforms: task.platforms.map((item) => `${item.platformId}:${item.status}`),
  });
}

/** 更新单个平台任务状态，同时维护 currentIndex 和清理完成超时计时器。 */
function updatePlatform(platformId: PlatformId, patch: Partial<DistributionTask['platforms'][number]>) {
  if (!currentTask) return;
  const platform = currentTask.platforms.find((item) => item.platformId === platformId);
  if (!platform) return;
  Object.assign(platform, patch);
  if (patch.status && isTerminalPlatformStatus(patch.status)) {
    clearFillCompletionTimeout(platformId);
  }
  currentTask.currentIndex = Math.max(
    0,
    currentTask.platforms.findIndex((item) => item.platformId === platformId),
  );
}

/** 从 storage 恢复当前运行任务，扩展重载后继续保持侧边栏状态。 */
async function restoreTask() {
  currentTask = await loadCurrentTask();
  licensingSettings = await loadLicensingSettings();
  await verifyLicenseOnStartup();
  if (currentTask) {
    await normalizeAndPersistCurrentTask();
  }
}

async function verifyLicenseOnStartup() {
  if (!licensingSettings || !hasLicenseCredentials(licensingSettings)) return;
  try {
    const result = await verifyLicense(licensingSettings);
    licensingSettings = result.settings;
    await saveLicensingSettings(licensingSettings);
    // TODO(remote-selector): 远程 selector 策略暂时废弃，启动时不再联网刷新平台策略。
    // if (result.ok) {
    //   await refreshRemotePlatformPolicyForLicense(result.settings);
    // }
  } catch (error) {
    console.warn('[PubFlow] 启动授权验证失败', error);
  }
}

/** 等待首次任务恢复完成，保证所有消息处理都基于最新 currentTask。 */
async function ensureTaskRestored() {
  if (!restoreTaskPromise) return;
  await restoreTaskPromise;
  restoreTaskPromise = null;
}

async function ensureLicensingLoaded() {
  if (!licensingSettings) {
    licensingSettings = await loadLicensingSettings();
  }
}

async function verifyCurrentLicense(input?: LicensingSettings) {
  licensingSettings = input || await loadLicensingSettings();
  const result = await verifyLicense(licensingSettings);
  licensingSettings = result.settings;
  await saveLicensingSettings(licensingSettings);
  return result;
}

/** @deprecated 远程 selector 策略暂时废弃；当前 selector 全部以内置 src/platforms 为准。 */
async function refreshRemotePlatformPolicyForLicense(settings: LicensingSettings) {
  void settings;
  // TODO(remote-selector): 如果后续恢复云端策略，必须后台异步刷新并允许本地 selector 兜底，
  // 不能在发布开始、打开平台、继续填充这些用户主链路上阻塞。
  // const applied = await refreshRemotePlatformConfigs(settings);
  // if (!applied) {
  //   throw new Error('远程平台策略未包含当前支持平台，请联系支持更新策略配置。');
  // }
}

async function requireActiveLicense() {
  const result = await verifyCurrentLicense();
  if (!result.ok) {
    if (result.settings.status === 'restricted') {
      throw new Error(result.error || result.settings.statusMessage || '当前处于受限模式，请联网重新验证授权后再发布。');
    }
    throw new Error(result.error || result.settings.statusMessage || '授权无效，请先在设置中完成激活。');
  }
  return result;
}

/** 持久化当前任务，并广播给 dashboard/sidepanel 刷新 UI。 */
async function persistAndBroadcast() {
  normalizeCurrentTaskPlatforms();
  await syncCurrentTaskToLibrary();
  await saveCurrentTask(currentTask);
  await browser.runtime
    .sendMessage({
      type: 'TASK_UPDATED',
      payload: {
        task: currentTask,
      },
    } satisfies RuntimeMessage)
    .catch(() => undefined);
}

/** 如果当前任务平台列表因内容类型发生变化，则归一化后立即保存。 */
async function normalizeAndPersistCurrentTask() {
  if (!currentTask) return;
  if (normalizeCurrentTaskPlatforms()) {
    await persistAndBroadcast();
  }
}

/** 广播侧边栏是否打开，Dashboard 根据它决定是否提示用户。 */
async function broadcastSidePanelStatus() {
  await browser.runtime
    .sendMessage({
      type: 'SIDE_PANEL_STATUS',
      payload: {
        open: sidePanelPorts.size > 0,
      },
    } satisfies RuntimeMessage)
    .catch(() => undefined);
}

/** 将运行任务状态映射成素材库里的平台状态。 */
function toLibraryPlatformStatus(status: PlatformTaskStatus): PlatformStatus['status'] {
  if (status === 'error') return 'error';
  if (status === 'skipped') return 'skipped';
  if (status === 'published') return 'published';
  if (status === 'filled') return 'filled';
  if (status === 'filling' || status === 'ready' || status === 'opening' || status === 'waitingUser') {
    return 'filling';
  }
  return 'pending';
}

/** 将素材库平台状态映射成发布记录归档状态。 */
function toRecordStatus(status: PlatformStatus['status']): PublishRecord['status'] | null {
  if (status === 'published') return 'published';
  if (status === 'error') return 'error';
  if (status === 'filled') return 'pending';
  return null;
}

/** 根据内容记录和平台状态生成一条发布记录。 */
function buildPublishRecord(video: VideoRecord, platform: PlatformStatus): PublishRecord | null {
  const status = toRecordStatus(platform.status);
  if (!status) return null;
  return {
    id: `${video.id}:${platform.platformId}`,
    videoId: video.id,
    platformId: platform.platformId,
    title: video.title,
    coverFileName: video.coverFileName,
    publishedUrl: platform.publishedUrl,
    publishedAt: platform.publishedAt,
    status,
    error: platform.error,
  };
}

/**
 * 将当前任务进度同步回素材库。
 * 继续填充/重发依赖素材库保存的平台状态和内容字段，所以任务状态变化必须回写。
 */
async function syncCurrentTaskToLibrary() {
  if (!currentTask?.videoId) return;

  try {
    const library = await loadLibraryData();
    const videoIndex = library.videos.findIndex((video) => video.id === currentTask?.videoId);
    if (videoIndex < 0) return;

    const video = { ...library.videos[videoIndex] };
    const platforms = video.platforms.map((platform) => {
      const taskPlatform = currentTask?.platforms.find((item) => item.platformId === platform.platformId);
      if (!taskPlatform) return platform;

      const status = toLibraryPlatformStatus(taskPlatform.status);
      const next: PlatformStatus = {
        ...platform,
        status,
        error: taskPlatform.error,
      };
      if (status === 'published') {
        next.publishedAt ||= Date.now();
      }
      return next;
    });

    const updatedVideo: VideoRecord = {
      ...video,
      platforms,
      updatedAt: Date.now(),
    };

    const videos = [
      ...library.videos.slice(0, videoIndex),
      updatedVideo,
      ...library.videos.slice(videoIndex + 1),
    ];

    const recordByKey = new Map<string, PublishRecord>(
      library.records.map((record) => [`${record.videoId}:${record.platformId}`, record] as const),
    );
    for (const platform of updatedVideo.platforms) {
      const generated = buildPublishRecord(updatedVideo, platform);
      if (!generated) continue;

      const key = `${generated.videoId}:${generated.platformId}`;
      const existing = recordByKey.get(key);
      recordByKey.set(key, {
        ...generated,
        ...existing,
        id: existing?.id || generated.id,
        title: updatedVideo.title,
        coverFileName: updatedVideo.coverFileName,
        status: existing?.status === 'published' ? 'published' : generated.status,
        publishedUrl: existing?.publishedUrl || generated.publishedUrl,
        publishedAt: existing?.publishedAt || generated.publishedAt,
        error: generated.error || existing?.error,
      });
    }

    await saveLibraryData(videos, [...recordByKey.values()]);
  } catch (error) {
    console.warn('[PubFlow] 同步任务状态到素材库失败', error);
  }
}

/** 获取当前任务，不存在时给调用方明确错误。 */
function ensureTask() {
  if (!currentTask) {
    throw new Error('没有正在运行的分发任务。');
  }
  return currentTask;
}

/** 构造 runtime 成功返回。 */
function ok<T>(data: T): RuntimeResponse<T> {
  return { ok: true, data };
}

/** 构造 runtime 失败返回。 */
function fail(error: string): RuntimeResponse {
  return { ok: false, error };
}

/**
 * 通过 chrome.debugger 发送 CDP Input.dispatchMouseEvent，
 * 生成浏览器级别的可信点击事件。用于知乎等 React 组件，
 * 这些组件不响应 JavaScript 的 element.click()。
 */
async function cdpClick(tabId: number, x: number, y: number): Promise<void> {
  const debuggee = { tabId };
  let attachedHere = false;
  try {
    await chrome.debugger.attach(debuggee, '1.3');
    attachedHere = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Another debugger is already attached')) {
      throw new Error(`CDP 调试器连接失败：${message}`);
    }
  }
  try {
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
    });
    await new Promise((resolve) => setTimeout(resolve, CDP_CLICK_MOVE_SETTLE_MS));
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  } finally {
    if (attachedHere) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch { /* ignore */ }
    }
  }
}
