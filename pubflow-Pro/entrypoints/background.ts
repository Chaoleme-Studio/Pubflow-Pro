import {
  getPlatformConfig,
  supportsContentType,
  type PlatformConfig,
} from '../src/platforms';
import { injectDouyinArticleCover, injectDouyinCover } from '../src/platforms/douyin/pageWorld';
import { injectXiaohongshuImageDescription } from '../src/platforms/xiaohongshu/pageWorld';
import { normalizeScheduledAt } from '../src/domain/content';
import { normalizeTopicIntervalMs } from '../src/domain/fillSettings';
import {
  getVerifiedFinalPublishButtonSpec,
  type FinalButtonSpec,
} from '../src/platforms/finalPublisher';
import { runWeixinChannelsPageWorldAction } from '../src/platforms/weixinChannels/pageWorld';
import type { PageWorldAction, PageWorldPayload } from '../src/platforms/weixinChannels/pageWorld';
import { loadLibraryData, saveLibraryData } from '../src/storage/libraryStorage';
import { loadCurrentTask, saveCurrentTask } from '../src/storage/taskStorage';
import {
  hasLicenseCredentials,
  hasLicenseFeature,
  loadLicensingSettings,
  mergeStoredLicenseWithRuntimeLease,
  saveLicensingSettings,
} from '../src/licensing/licenseStorage';
import { verifyLicense } from '../src/licensing/licenseManager';
import { issueDistributionPermit } from '../src/licensing/permitManager';
import { checkExtensionUpdate } from '../src/licensing/updateChecker';
import { AgentClient } from '../src/agent/agentClient';
import { CloudAgentClient } from '../src/agent/cloudAgentClient';
import { InboundTaskCoordinator } from '../src/agent/inboundTaskCoordinator';
import type { AgentJobDetail } from '../src/agent/protocol';
import { assembleProjectTask } from '../src/features/distribution/projectTaskAssembler';
import { readWorkspaceIdentity } from '../src/storage/workspaceStorage';
import {
  startDistribution,
  stopDistributionTask,
  type DistributionStartRequest,
} from '../src/features/distribution/distributionCoordinator';
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
const FINAL_PUBLISH_ACTIVATE_SETTLE_MS = 600;
const FINAL_PUBLISH_CLICK_SETTLE_MS = 800;
const FINAL_PUBLISH_TARGET_PROBE_FUNCTION = `function (platformId, rule, probeKey, mode) {
  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const originalTarget = this && this.nodeType === 3 ? this.parentElement : this;
  if (mode === 'verify') {
    const received = originalTarget && originalTarget[probeKey] === true;
    try { delete originalTarget[probeKey]; } catch { /* ignore */ }
    return received;
  }
  const matches = (element) => {
    const text = normalize(element.textContent);
    if (platformId === 'xiaohongshu') {
      return element.tagName === 'XHS-PUBLISH-BTN'
        && element.getAttribute('is-publish') === 'true'
        && element.getAttribute('submit-disabled') !== 'true'
        && element.getAttribute('submit-loading') !== 'true';
    }
    const label = normalize(element.getAttribute('aria-label') || text);
    try {
      return element.matches(rule.selector) && rule.texts.includes(label);
    } catch {
      return false;
    }
  };
  let candidate = originalTarget;
  while (candidate && candidate.nodeType === 1 && !matches(candidate)) {
    if (candidate.parentElement) {
      candidate = candidate.parentElement;
    } else {
      const root = candidate.getRootNode && candidate.getRootNode();
      candidate = root && root.host ? root.host : null;
    }
  }
  if (!candidate || !matches(candidate)) {
    return mode === 'arm'
      ? { ok: false, error: '点击坐标没有命中当前平台的最终发布按钮。' }
      : false;
  }
  const disabled = Boolean(
    candidate.disabled
    || candidate.hasAttribute('disabled')
    || candidate.getAttribute('aria-disabled') === 'true'
    || /(?:^|\\s)(?:is-)?disabled(?:\\s|$)/i.test(String(candidate.className || ''))
  );
  if (disabled) {
    return { ok: false, error: '最终发布按钮当前不可点击，请检查平台页面。' };
  }

  const view = candidate.ownerDocument && candidate.ownerDocument.defaultView;
  if (!view) {
    return { ok: false, error: '最终发布按钮不在当前可点击视口内，请重试。' };
  }

  const rect = candidate.getBoundingClientRect();
  const visualViewport = view.visualViewport;
  const viewportLeft = visualViewport ? visualViewport.offsetLeft : 0;
  const viewportTop = visualViewport ? visualViewport.offsetTop : 0;
  const viewportRight = viewportLeft + (visualViewport ? visualViewport.width : view.innerWidth);
  const viewportBottom = viewportTop + (visualViewport ? visualViewport.height : view.innerHeight);
  const visibleLeft = Math.max(rect.left, viewportLeft);
  const visibleTop = Math.max(rect.top, viewportTop);
  const visibleRight = Math.min(rect.right, viewportRight);
  const visibleBottom = Math.min(rect.bottom, viewportBottom);
  if (visibleRight - visibleLeft <= 2 || visibleBottom - visibleTop <= 2) {
    return { ok: false, error: '最终发布按钮不在当前可点击视口内，请重试。' };
  }

  const preferredX = platformId === 'xiaohongshu'
    ? rect.left + Math.min(
      Math.max(
        rect.width / 2 + (candidate.getAttribute('is-save-draft') === 'true' ? 72 : 0),
        1,
      ),
      Math.max(rect.width - 1, 1),
    )
    : rect.left + rect.width / 2;
  const preferredY = rect.top + rect.height / 2;
  const localX = Math.min(Math.max(preferredX, visibleLeft + 1), visibleRight - 1);
  const localY = Math.min(Math.max(preferredY, visibleTop + 1), visibleBottom - 1);

  const activation = candidate.tagName === 'BUTTON' ? 'keyboard' : 'mouse';
  if (activation === 'mouse') {
    let hit = candidate.ownerDocument.elementFromPoint(localX, localY);
    while (hit && hit !== candidate) {
      if (hit.parentElement) {
        hit = hit.parentElement;
      } else {
        const root = hit.getRootNode && hit.getRootNode();
        hit = root && root.host ? root.host : null;
      }
    }
    if (hit !== candidate) {
      return { ok: false, error: '最终发布按钮当前被其他页面元素遮挡，请重试。' };
    }
  }

  // 原生按钮使用键盘激活，验证 keydown 是否到达；B站等普通元素验证 click。
  // 小红书真实按钮位于 closed Shadow DOM，宿主收不到稳定的内部 click，只能依赖精确命中校验。
  const verificationEvent = platformId === 'xiaohongshu'
    ? ''
    : activation === 'keyboard' ? 'keydown' : 'click';
  if (verificationEvent) {
    Object.defineProperty(candidate, probeKey, {
      configurable: true,
      value: false,
      writable: true,
    });
    candidate.addEventListener(verificationEvent, (event) => {
      candidate[probeKey] = event.isTrusted === true;
    }, { capture: true, once: true });
  }
  if (activation === 'keyboard') {
    candidate.focus({ preventScroll: true });
    if (candidate.ownerDocument.activeElement !== candidate) {
      return { ok: false, error: '无法聚焦当前平台的最终发布按钮，请重试。' };
    }
  }

  let x = localX;
  let y = localY;
  let currentWindow = view;
  while (currentWindow && currentWindow !== currentWindow.parent) {
    try {
      const frameElement = currentWindow.frameElement;
      if (!frameElement) break;
      const frameRect = frameElement.getBoundingClientRect();
      x += frameRect.left;
      y += frameRect.top;
      currentWindow = currentWindow.parent;
    } catch { break; }
  }
  return { ok: true, activation, verifyEvent: Boolean(verificationEvent), x, y };
}`;
const FINAL_PUBLISH_TARGET_LOCATOR_FUNCTION = `async function (platformId, rule) {
  if (!rule) return { ok: false, error: '当前平台没有最终按钮实时定位规则。' };

  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument && element.ownerDocument.defaultView;
    const style = view && view.getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || '1') !== 0;
  };
  const isDisabled = (element) => Boolean(
    element.disabled
    || element.hasAttribute('disabled')
    || element.getAttribute('aria-disabled') === 'true'
    || /(?:^|\\s)(?:is-)?disabled(?:\\s|$)/i.test(String(element.className || ''))
  );
  const matches = (element) => {
    if (platformId === 'xiaohongshu') {
      return isVisible(element)
        && element.getAttribute('submit-disabled') !== 'true'
        && element.getAttribute('submit-loading') !== 'true';
    }
    const label = normalize(element.getAttribute('aria-label') || element.textContent);
    return rule.texts.includes(label) && isVisible(element) && !isDisabled(element);
  };

  const findInRoot = (root, visited) => {
    if (!root || visited.has(root)) return null;
    visited.add(root);
    try {
      for (const element of root.querySelectorAll(rule.selector)) {
        if (matches(element)) return element;
      }
    } catch { /* ignore invalid or inaccessible roots */ }

    let descendants = [];
    try { descendants = root.querySelectorAll('*'); } catch { return null; }
    for (const element of descendants) {
      if (element.shadowRoot) {
        const shadowResult = findInRoot(element.shadowRoot, visited);
        if (shadowResult) return shadowResult;
      }
      if (element.tagName === 'IFRAME') {
        try {
          const frameDocument = element.contentDocument;
          if (!frameDocument) continue;
          const frameResult = findInRoot(frameDocument, visited);
          if (frameResult) return frameResult;
        } catch { /* cross-origin iframe */ }
      }
    }
    return null;
  };

  let target = findInRoot(document, new Set());
  if (!target) return '没有找到当前平台可点击的最终发布按钮。';

  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  let currentWindow = target.ownerDocument && target.ownerDocument.defaultView;
  while (currentWindow && currentWindow !== currentWindow.parent) {
    try {
      const frameElement = currentWindow.frameElement;
      if (!frameElement) break;
      frameElement.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      currentWindow = currentWindow.parent;
    } catch { break; }
  }
  await new Promise((resolve) => setTimeout(resolve, 220));

  target = findInRoot(document, new Set());
  return target || '页面布局更新后最终发布按钮已失效，请重试。';
}`;
const pendingFillAcks = new Map<string, () => void>();
const fillingPlatforms = new Set<PlatformId>();
const fillCompletionTimers = new Map<PlatformId, ReturnType<typeof setTimeout>>();
const inboundTaskCoordinator = new InboundTaskCoordinator(() => hasActiveDistributionTask());
const agentClient = new AgentClient({
  canClaim: () => !hasActiveDistributionTask(),
  getWorkspaceId: readWorkspaceIdentity,
  getLicenseGrant: async () => {
    await ensureLicensingLoaded();
    const settings = licensingSettings;
    if (!settings?.tier || !hasLicenseFeature(settings, 'native-publish')) return null;
    return {
      tier: settings.tier,
      features: [...settings.features],
      validUntil: settings.validUntil,
    };
  },
  onJob: (job) => handleAgentJob(job, 'native'),
  onPending: () => inboundTaskCoordinator.notifyTaskMayBeAvailable(),
  onClaimSettled: () => inboundTaskCoordinator.claimSettled(),
});
const cloudAgentClient = new CloudAgentClient({
  canClaim: () => !hasActiveDistributionTask(),
  onJob: (job) => handleAgentJob(job, 'cloud'),
  onPending: () => inboundTaskCoordinator.notifyTaskMayBeAvailable(),
  onClaimSettled: () => inboundTaskCoordinator.claimSettled(),
});
inboundTaskCoordinator.setSources(agentClient, cloudAgentClient);

export default defineBackground(() => {
  restoreTaskPromise = restoreTask();
  void checkExtensionUpdate(__PUBFLOW_DEFAULT_LICENSE_API_BASE_URL__, __PUBFLOW_OFFICIAL_SITE_URL__);
  // 必须先恢复 currentTask，避免 Service Worker 重启后把同一 Agent job 再领取并启动一次。
  void restoreTaskPromise.finally(() => syncAgentConnections());

  browser.alarms.onAlarm.addListener((alarm) => {
    agentClient.handleAlarm(alarm.name);
    cloudAgentClient.handleAlarm(alarm.name);
  });

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

    if (message.type === 'CDP_FILL_DESCRIPTION_TOPICS') {
      const tabId = sender.tab?.id;
      if (!tabId) {
        return fail('无法确定目标标签页');
      }
      try {
        await cdpFillDescriptionTopics(tabId, message.payload);
        return ok(undefined);
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'CDP 描述和话题输入失败');
      }
    }

    if (message.type === 'CDP_DRAG') {
      const tabId = sender.tab?.id;
      if (!tabId) {
        return fail('无法确定目标标签页');
      }
      try {
        await cdpDrag(tabId, message.payload);
        return ok(undefined);
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'CDP 拖拽失败');
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
        const { title, topics, description, skipTitle, topicIntervalMs } = message.payload;
        return ok(await executeWeixinPageWorldAction(sender, 'fillEditor', {
          title,
          topics,
          description,
          skipTitle,
          topicIntervalMs,
        }));
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

    if (message.type === 'FILL_WEIXIN_VIDEO_MARK') {
      try {
        return ok(await executeWeixinPageWorldAction(sender, 'fillVideoMark', {
          videoMark: message.payload.videoMark,
        }));
      } catch (error) {
        return fail(error instanceof Error ? error.message : '视频号视频标注设置失败');
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
      return ok(await beginDistribution({
        content: message.payload.content,
        platforms: message.payload.platforms,
        videoId: message.payload.videoId,
        source: 'dashboard',
        projectId: message.payload.content.projectId,
        autoSubmit: message.payload.autoSubmit === true,
      }));
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
      const task = ensureTask();
      if (task.status === 'paused') task.status = 'running';
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
      await openNextPending();
      return ok(currentTask);
    }

    if (message.type === 'STOP_TASK') {
      const task = ensureTask();
      clearAllFillCompletionTimeouts();
      const tabIds = stopDistributionTask(task);
      await persistAndBroadcast();
      if (tabIds.length) {
        await browser.tabs.remove(tabIds).catch(() => undefined);
      }
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

    if (message.type === 'FINAL_PUBLISH_PREPARE') {
      const { platformId } = message.payload;
      if (!isMessageFromPlatformTask(platformId, sender)) {
        return fail('最终发布请求不属于当前平台任务。');
      }
      if (!currentTask?.autoSubmit) {
        return fail('当前任务没有启用直接发布。');
      }
      const platformTask = currentTask.platforms.find((item) => item.platformId === platformId);
      if (!platformTask?.tabId || platformTask.status !== 'filling') {
        return fail('当前平台不在可直接发布状态。');
      }

      await browser.tabs.update(platformTask.tabId, { active: true });
      await new Promise((resolve) => setTimeout(resolve, FINAL_PUBLISH_ACTIVATE_SETTLE_MS));
      return ok(currentTask);
    }

    if (message.type === 'FINAL_PUBLISH_CLICK') {
      const { platformId, x, y } = message.payload;
      if (!isMessageFromPlatformTask(platformId, sender)) {
        return fail('最终发布请求不属于当前平台任务。');
      }
      if (!currentTask?.autoSubmit) {
        return fail('当前任务没有启用直接发布。');
      }
      const platformTask = currentTask.platforms.find((item) => item.platformId === platformId);
      if (!platformTask?.tabId || platformTask.status !== 'filling') {
        return fail('当前平台不在可直接发布状态。');
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return fail('最终发布按钮坐标无效。');
      }

      clearFillCompletionTimeout(platformId);
      updatePlatform(platformId, {
        status: 'publishing',
        message: '内容已填充，正在点击最终发布按钮。',
        error: undefined,
      });
      await persistAndBroadcast();

      try {
        const activeTab = await browser.tabs.get(platformTask.tabId);
        if (!activeTab.active) {
          throw new Error('平台发布页面失去焦点，请重试直接发布。');
        }
        const verifiedSpec = getVerifiedFinalPublishButtonSpec(platformId);
        if (verifiedSpec) {
          await cdpClickFinalPublishButton(platformTask.tabId, x, y, platformId, verifiedSpec);
        } else {
          await cdpClick(platformTask.tabId, x, y);
        }
        await new Promise((resolve) => setTimeout(resolve, FINAL_PUBLISH_CLICK_SETTLE_MS));
        updatePlatform(platformId, {
          status: 'published',
          message: currentTask.content.scheduledAt
            ? '已点击最终发布按钮，平台将按设定时间发布。'
            : '已点击最终发布按钮。',
        });
        await persistAndBroadcast();
        await openNextPending();
        return ok(currentTask);
      } catch (error) {
        updatePlatform(platformId, {
          status: 'error',
          error: error instanceof Error ? error.message : '最终发布按钮点击失败',
        });
        await persistAndBroadcast();
        await openNextPending();
        return fail(error instanceof Error ? error.message : '最终发布按钮点击失败');
      }
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

/** 统一判断后台是否正占用发布状态机，Agent 仅在空闲时领取下一条任务。 */
function hasActiveDistributionTask() {
  return Boolean(
    currentTask
    && (currentTask.status === 'running' || currentTask.status === 'paused')
    && currentTask.platforms.some((item) => !isTerminalPlatformStatus(item.status)),
  );
}

/** 使用现有授权、permit 和页面打开能力启动一次分发。 */
async function beginDistribution(request: DistributionStartRequest) {
  const permitSource = request.source === 'agent' ? request.externalTaskSource : 'manual';
  if (!permitSource) {
    throw new Error('Agent 发布任务缺少来源标识，请更新插件后重试。');
  }
  return startDistribution(request, {
    getCurrentTask: () => currentTask,
    authorize: async (content, platforms, videoId) => {
      const license = await requireActiveLicense();
      return issueDistributionPermit(license.settings, {
        content,
        platforms,
        videoId,
        source: permitSource,
        externalJobId: request.externalJobId,
      });
    },
    setCurrentTask: (task) => {
      currentTask = task;
    },
    persist: persistAndBroadcast,
    openPlatform,
    clearTimers: clearAllFillCompletionTimeouts,
  });
}

/** 接收 Agent 已领取任务：恢复 Project 素材，然后进入与 Dashboard 相同的发布入口。 */
async function handleAgentJob(job: AgentJobDetail, source: 'native' | 'cloud') {
  let accepted = false;
  try {
    const assembled = await assembleProjectTask(job.projectId, job.platforms);
    if (source === 'native') agentClient.acceptJob(job.jobId);
    accepted = true;
    await beginDistribution({
      ...assembled,
      source: 'agent',
      externalTaskSource: source,
      externalJobId: job.jobId,
      projectId: job.projectId,
      statusSequence: job.statusSequence,
      autoSubmit: job.autoSubmit === true,
    });
  } catch (error) {
    if (currentTask?.source === 'agent' && currentTask.externalJobId === job.jobId) {
      currentTask.status = 'error';
      currentTask.error = error instanceof Error ? error.message : String(error);
      try {
        await persistAndBroadcast();
        return;
      } catch {
        // 持久化自身失败时仍通过 AgentClient 的失败重放兜底。
      }
    }
    // accepted 后初始 persist 可能已发送 sequence=2，失败必须使用更大的序号。
    if (source === 'native') {
      agentClient.reportFailure(job.jobId, error, accepted ? 4 : 1);
    } else {
      cloudAgentClient.reportFailure(job.jobId, error, Math.max(4, job.statusSequence + 1));
    }
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
        autoSubmit: currentTask.autoSubmit === true,
      },
    } satisfies RuntimeMessage;

    for (let attempt = 0; attempt < FILL_COMMAND_MAX_RETRIES; attempt++) {
      if (
        currentTask.status !== 'running'
        || currentTask.platforms.find((item) => item.platformId === platformId)?.status !== 'filling'
      ) return;
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
        if (
          currentTask.status !== 'running'
          || currentTask.platforms.find((item) => item.platformId === platformId)?.status !== 'filling'
        ) return;
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

/** 填充超时后记录当前平台失败，并继续顺序发布队列。 */
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
  if (currentTask.status !== 'running') return;
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
  currentTask.content.scheduledAt = normalizeScheduledAt(currentTask.content.scheduledAt) || undefined;
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
    scheduledAt: task.content.scheduledAt || 0,
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
    agentClient.resumeTask(currentTask);
    cloudAgentClient.resumeTask(currentTask);
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

async function syncAgentConnections() {
  const settings = licensingSettings;
  await Promise.all([
    hasLicenseFeature(settings, 'native-publish') ? agentClient.start() : agentClient.stop(),
    hasLicenseFeature(settings, 'remote-publish') ? cloudAgentClient.start() : cloudAgentClient.stop(),
  ]);
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
  const stored = input || await loadLicensingSettings();
  licensingSettings = mergeStoredLicenseWithRuntimeLease(stored, licensingSettings);
  const result = await verifyLicense(licensingSettings);
  licensingSettings = result.settings;
  await saveLicensingSettings(licensingSettings);
  await syncAgentConnections();
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
  if (currentTask) {
    agentClient.reportTask(currentTask);
    cloudAgentClient.reportTask(currentTask);
  }
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
  inboundTaskCoordinator.notifyTaskMayBeAvailable();
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
  if (
    status === 'filling'
    || status === 'publishing'
    || status === 'ready'
    || status === 'opening'
    || status === 'waitingUser'
  ) {
    return 'filling';
  }
  return 'pending';
}

/** 将素材库平台状态映射成发布记录归档状态。 */
function toRecordStatus(status: PlatformStatus['status']): PublishRecord['status'] | null {
  if (status === 'published') return 'published';
  if (status === 'error') return 'error';
  if (status === 'filled') return 'filled';
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
    updatedAt: platform.publishedAt || video.updatedAt,
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
        publishedUrl: taskPlatform.publishedUrl || platform.publishedUrl,
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
      const stateChanged = !existing ||
        existing.status !== generated.status ||
        existing.error !== generated.error ||
        existing.publishedUrl !== generated.publishedUrl ||
        existing.publishedAt !== generated.publishedAt;
      recordByKey.set(key, {
        ...generated,
        ...existing,
        id: existing?.id || generated.id,
        title: updatedVideo.title,
        coverFileName: updatedVideo.coverFileName,
        status: existing?.status === 'published' ? 'published' : generated.status,
        publishedUrl: existing?.publishedUrl || generated.publishedUrl,
        publishedAt: existing?.publishedAt || generated.publishedAt,
        updatedAt: stateChanged ? generated.updatedAt : existing?.updatedAt || generated.updatedAt,
        error: generated.error,
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
    throw new Error(`无法激活平台编辑器，请先关闭该页面的开发者工具后重试：${message}`);
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

async function locateFinalPublishTarget(
  debuggee: { tabId: number },
  platformId: PlatformId,
  spec: FinalButtonSpec,
): Promise<string> {
  const located = await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
    expression: `(${FINAL_PUBLISH_TARGET_LOCATOR_FUNCTION})(
      ${JSON.stringify(platformId)},
      ${JSON.stringify(spec)}
    )`,
    awaitPromise: true,
    returnByValue: false,
  }) as {
    result?: { objectId?: string; value?: unknown };
    exceptionDetails?: unknown;
  };
  const objectId = located.result?.objectId || '';
  if (located.exceptionDetails || !objectId) {
    const error = typeof located.result?.value === 'string'
      ? located.result.value
      : '无法在当前页面实时定位最终发布按钮。';
    throw new Error(error);
  }
  return objectId;
}

/**
 * 点击最终发布按钮前先用 CDP 命中测试确认目标节点，再确认可信 click 事件确实到达按钮。
 * 不能仅以 Input.dispatchMouseEvent 未抛错作为发布成功依据：坐标落在空白处时该命令同样会成功。
 */
async function cdpClickFinalPublishButton(
  tabId: number,
  x: number,
  y: number,
  platformId: PlatformId,
  spec: FinalButtonSpec,
): Promise<void> {
  const debuggee = { tabId };
  const probeKey = `__pubflowFinalClick_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let attachedHere = false;
  let objectId = '';

  try {
    await chrome.debugger.attach(debuggee, '1.3');
    attachedHere = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法激活平台编辑器，请先关闭该页面的开发者工具后重试：${message}`);
  }

  try {
    // 内容脚本坐标只做消息完整性校验。后台激活标签页后重新定位目标，
    // 避免长页面滚动、弹窗重排或按钮重渲染造成旧坐标失效。
    objectId = await locateFinalPublishTarget(debuggee, platformId, spec);

    const armed = await chrome.debugger.sendCommand(debuggee, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: FINAL_PUBLISH_TARGET_PROBE_FUNCTION,
      arguments: [{ value: platformId }, { value: spec }, { value: probeKey }, { value: 'arm' }],
      returnByValue: true,
    }) as {
      result?: {
        value?: {
          ok?: boolean;
          activation?: 'keyboard' | 'mouse';
          verifyEvent?: boolean;
          x?: number;
          y?: number;
          error?: string;
        };
      };
    };
    const armedValue = armed.result?.value;
    if (!armedValue?.ok) {
      throw new Error(armedValue?.error || '点击坐标没有命中最终发布按钮。');
    }
    x = armedValue.x!;
    y = armedValue.y!;

    if (armedValue.activation === 'keyboard') {
      // Space 是原生 button 的标准键盘激活键；CDP 会在 keyUp 后生成可信 click。
      await dispatchCdpKey(debuggee, ' ', 'Space', 32);
    } else {
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
    }

    if (armedValue.verifyEvent) {
      const verified = await chrome.debugger.sendCommand(debuggee, 'Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: FINAL_PUBLISH_TARGET_PROBE_FUNCTION,
        arguments: [{ value: platformId }, { value: spec }, { value: probeKey }, { value: 'verify' }],
        returnByValue: true,
      }) as { result?: { value?: boolean } };
      if (verified.result?.value !== true) {
        throw new Error('浏览器可信输入事件没有到达最终发布按钮，请重试。');
      }
    }
  } finally {
    if (objectId) {
      await chrome.debugger.sendCommand(debuggee, 'Runtime.releaseObject', { objectId }).catch(() => undefined);
    }
    if (attachedHere) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch { /* ignore */ }
    }
  }
}

/**
 * 真实点击并填写描述/话题。每个话题严格执行：逐字输入、等待、Enter、等待、空格。
 * 整段操作复用同一个 debugger 会话，避免逐个按键反复连接导致焦点丢失。
 */
async function cdpFillDescriptionTopics(
  tabId: number,
  payload: {
    x: number;
    y: number;
    description: string;
    topics: string[];
    topicIntervalMs: number;
  },
): Promise<void> {
  const debuggee = { tabId };
  const topicIntervalMs = normalizeTopicIntervalMs(payload.topicIntervalMs);
  const topics = payload.topics
    .map((topic) => topic.trim().replace(/^#+/, ''))
    .filter(Boolean);
  let attachedHere = false;

  try {
    await chrome.debugger.attach(debuggee, '1.3');
    attachedHere = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法激活平台编辑器，请先关闭该页面的开发者工具后重试：${message}`);
  }

  try {
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: payload.x,
      y: payload.y,
      button: 'none',
    });
    await new Promise((resolve) => setTimeout(resolve, CDP_CLICK_MOVE_SETTLE_MS));
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: payload.x,
      y: payload.y,
      button: 'left',
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: payload.x,
      y: payload.y,
      button: 'left',
      clickCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, CDP_CLICK_MOVE_SETTLE_MS));

    const platformInfo = await chrome.runtime.getPlatformInfo();
    const selectAllModifier = platformInfo.os === 'mac' ? 4 : 2;
    await dispatchCdpKey(debuggee, 'a', 'KeyA', 65, selectAllModifier);
    await dispatchCdpKey(debuggee, 'Backspace', 'Backspace', 8);

    if (payload.description) {
      await chrome.debugger.sendCommand(debuggee, 'Input.insertText', { text: payload.description });
    }
    if (payload.description && topics.length > 0) {
      await chrome.debugger.sendCommand(debuggee, 'Input.insertText', { text: ' ' });
    }

    for (const topic of topics) {
      for (const character of `#${topic}`) {
        await chrome.debugger.sendCommand(debuggee, 'Input.insertText', { text: character });
      }
      await new Promise((resolve) => setTimeout(resolve, topicIntervalMs));
      await dispatchCdpKey(debuggee, 'Enter', 'Enter', 13);
      await new Promise((resolve) => setTimeout(resolve, topicIntervalMs));
      await chrome.debugger.sendCommand(debuggee, 'Input.insertText', { text: ' ' });
    }
  } finally {
    if (attachedHere) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch { /* ignore */ }
    }
  }
}

/** 派发一组可信 keyDown/keyUp，修饰位遵循 CDP 的 Alt/Control/Meta 编码。 */
async function dispatchCdpKey(
  debuggee: { tabId: number },
  key: string,
  code: string,
  keyCode: number,
  modifiers = 0,
) {
  const params = {
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  };
  await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
  await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}

/** 通过 CDP 发送可信拖拽事件，让 ReactCrop 接收真实的裁剪框移动操作。 */
async function cdpDrag(
  tabId: number,
  points: { startX: number; startY: number; endX: number; endY: number },
): Promise<void> {
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
      x: points.startX,
      y: points.startY,
      button: 'none',
    });
    await new Promise((resolve) => setTimeout(resolve, CDP_CLICK_MOVE_SETTLE_MS));
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: points.startX,
      y: points.startY,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });

    const steps = 10;
    for (let index = 1; index <= steps; index++) {
      const progress = index / steps;
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: points.startX + (points.endX - points.startX) * progress,
        y: points.startY + (points.endY - points.startY) * progress,
        button: 'left',
        buttons: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 16));
    }

    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: points.endX,
      y: points.endY,
      button: 'left',
      buttons: 0,
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
