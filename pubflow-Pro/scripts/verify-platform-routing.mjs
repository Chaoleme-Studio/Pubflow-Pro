import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function read(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), 'utf8');
}

function assertIncludes(file, text, message) {
  const source = read(file);
  if (!source.includes(text)) {
    throw new Error(`${message}\nMissing in ${file}: ${text}`);
  }
}

function assertMatches(file, pattern, message) {
  const source = read(file);
  if (!pattern.test(source)) {
    throw new Error(`${message}\nPattern not found in ${file}: ${pattern}`);
  }
}

function assertNotIncludes(file, text, message) {
  const source = read(file);
  if (source.includes(text)) {
    throw new Error(`${message}\nUnexpected in ${file}: ${text}`);
  }
}

assertIncludes(
  'src/platforms/weixinChannels/selectors.ts',
  "图文发布页地址: 'https://channels.weixin.qq.com/platform/post/finderNewLifeCreate'",
  '视频号图文必须打开 finderNewLifeCreate 创建页，不能打开列表页。',
);

assertIncludes(
  'src/platforms/kuaishou/selectors.ts',
  "图文发布页地址: 'https://cp.kuaishou.com/article/publish/video?tabType=2'",
  '快手文章/图文必须打开 tabType=2。',
);

assertMatches(
  'src/platforms/bilibili/selectors.ts',
  /上传:\s*\{[\s\S]*?需要激活标签页:\s*true/,
  'B站视频上传必须激活当前标签页。',
);

assertIncludes(
  'src/platforms/bilibili/selectors.ts',
  "[class*=\"title\"] textarea",
  'B站文章标题 selector 必须包含通用 title textarea 兜底。',
);

assertIncludes(
  'src/platforms/bilibili/selectors.ts',
  '文章就绪选择器: \'[contenteditable="true"][role="textbox"], .ProseMirror[contenteditable="true"]\'',
  'B站文章必须等正文编辑器出现后才进入填充，不能只等标题输入框。',
);

assertNotIncludes(
  'src/platforms/bilibili/selectors.ts',
  '图文发布页地址:',
  'B站当前只支持视频/文章，不应进入图文发布任务。',
);

assertNotIncludes(
  'src/platforms/zhihu/selectors.ts',
  '图文发布页地址:',
  '知乎当前只支持视频/文章，不应进入图文发布任务。',
);

assertIncludes(
  'src/platforms/index.ts',
  'if (platform.supportedContentTypes)',
  '平台内容类型支持必须允许显式配置，避免图文字段兜底误判文章支持。',
);

assertIncludes(
  'src/platforms/kuaishou/selectors.ts',
  "支持内容类型: ['video', 'image']",
  '快手不支持发布文章，文章模式必须禁用。',
);

assertIncludes(
  'src/platforms/weixinChannels/selectors.ts',
  "支持内容类型: ['video', 'image']",
  '视频号不支持发布文章，文章模式必须禁用。',
);

assertIncludes(
  'src/platforms/xiaohongshu/selectors.ts',
  "支持内容类型: ['video', 'image']",
  '小红书文章流程需要一键排版生成图片，当前文章模式先禁用。',
);

assertIncludes(
  'src/platforms/index.ts',
  "if (contentType === 'image') return Boolean(platform.articleEditorUrl && platform.articleUpload && platform.imageFields);",
  '图文发布必须按平台支持能力过滤。',
);

assertIncludes(
  'src/platforms/index.ts',
  "return Boolean((platform.articlePageUrl || platform.articleEditorUrl) && platform.articleFields);",
  '文章发布必须按平台支持能力过滤。',
);

assertIncludes(
  'entrypoints/background.ts',
  "if (platformTask.status !== 'ready') return;",
  '自动填充 fallback 只能在平台 ready 后触发，不能 opening 抢跑。',
);

assertMatches(
  'entrypoints/background.ts',
  /const supportedPlatforms = message\.payload\.platforms\.filter\(\(platformId\) =>[\s\S]*?supportsContentType\(PLATFORM_CONFIGS\[platformId\], message\.payload\.content\.contentType \|\| 'video'\)/,
  '后台 START_DISTRIBUTION 必须二次过滤当前内容类型支持的平台。',
);

assertMatches(
  'entrypoints/background.ts',
  /const uploadConfig = resolveUploadConfig\(config, currentTask\.content\);[\s\S]*?if \(uploadConfig\?\.requiresActiveTab\) \{[\s\S]*?await browser\.tabs\.update\(platformTask\.tabId, \{ active: true \}\);/,
  '需要激活标签页的平台在填充前必须切到前台。',
);

assertMatches(
  'entrypoints/background.ts',
  /if \(contentType === 'article'\) \{[\s\S]*?return config\.articlePageUrl \|\| config\.articleEditorUrl \|\| config\.editorUrl;/,
  '文章发布 URL 必须优先 articlePageUrl，其次 articleEditorUrl。',
);

assertMatches(
  'entrypoints/background.ts',
  /if \(isImagePost\) \{[\s\S]*?return config\.articleEditorUrl \|\| config\.editorUrl;/,
  '图文发布 URL 必须优先 articleEditorUrl。',
);

assertMatches(
  'entrypoints/background.ts',
  /if \(contentType === 'article'\) \{[\s\S]*?return config\.articleUpload \|\| config\.upload;/,
  '文章发布上传配置必须优先 articleUpload。',
);

assertMatches(
  'entrypoints/background.ts',
  /if \(isImagePost\) \{[\s\S]*?return config\.articleUpload \|\| config\.upload;/,
  '图文发布上传配置必须优先 articleUpload。',
);

assertIncludes(
  'entrypoints/content.ts',
  'const effectiveReadySelector = resolveReadySelector(config, contentType);',
  'content script iframe 接管必须使用内容类型感知的 ready selector。',
);

assertIncludes(
  'entrypoints/content.ts',
  'const contentType = await getCurrentTaskContentType(config);',
  '页面 ready 上报必须读取当前任务内容类型，避免文章/图文使用视频 ready selector 卡在打开中。',
);

assertMatches(
  'entrypoints/content.ts',
  /waitForReadySignal\([\s\S]*?contentType,[\s\S]*?\);/,
  '页面 ready 等待必须把当前任务内容类型传给 ready signal。',
);

assertMatches(
  'entrypoints/content.ts',
  /if \(frameDecision !== 'handle'\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?type: 'FILL_CONTENT_ACK'/,
  '忽略的 iframe 不能确认填充指令，只有实际处理的 frame 才能发送 ACK。',
);

assertMatches(
  'entrypoints/background.ts',
  /ack = waitForFillContentAck\(requestId\);[\s\S]*?await browser\.tabs\.sendMessage\(platformTask\.tabId, message\);[\s\S]*?await ack\.promise;/,
  '后台必须等待实际编辑器 frame 的 ACK，避免消息被非编辑器 frame 响应后卡住。',
);

assertIncludes(
  'src/content/dom.ts',
  'return element?.ownerDocument || _overrideDoc || document;',
  '跨 iframe 填充时必须使用字段元素所属 document 执行输入命令。',
);

assertIncludes(
  'src/content/dom.ts',
  'const selection = activeDocument.defaultView?.getSelection();',
  '跨 iframe 填充时必须使用字段元素所属 window 的 selection。',
);

assertIncludes(
  'src/features/tasks/components/TaskProgress.vue',
  "return ['pending', 'opening', 'waitingUser', 'ready', 'error'].includes(status);",
  '任务面板不能对已填充/填充中的平台继续打开，避免人为触发并发平台页。',
);

assertMatches(
  'entrypoints/background.ts',
  /if \(message\.type === 'CONTENT_FILLED'\) \{[\s\S]*?await openNextPending\(\);[\s\S]*?await openNextPending\(\);/,
  '平台填充成功或填充失败文案都必须继续打开下一个 pending 平台。',
);

assertMatches(
  'entrypoints/background.ts',
  /if \(message\.type === 'FILL_ERROR'\) \{[\s\S]*?await openNextPending\(\);/,
  '平台 FILL_ERROR 后必须继续打开下一个 pending 平台。',
);

assertMatches(
  'entrypoints/background.ts',
  /error: lastError\?\.message \|\| 'content script 未响应，请刷新页面后重试。'[\s\S]*?await openNextPending\(\);/,
  'content script 未响应最终失败后必须继续打开下一个 pending 平台。',
);

assertMatches(
  'entrypoints/background.ts',
  /async function handleFillCompletionTimeout[\s\S]*?status: 'error'[\s\S]*?await openNextPending\(\);/,
  '平台接手填充但长时间无结果时必须继续打开下一个 pending 平台。',
);

assertIncludes(
  'entrypoints/background.ts',
  'const next = findNextSequentialPendingPlatform();',
  '多平台发布必须按顺序推进，不能越过正在 opening/ready/filling/waitingUser 的平台打开后续 pending。',
);

assertMatches(
  'entrypoints/background.ts',
  /function findNextSequentialPendingPlatform\(\) \{[\s\S]*?if \(platform\.status === 'pending'\) return platform;[\s\S]*?if \(!isTerminalPlatformStatus\(platform\.status\)\) return undefined;/,
  'openNextPending 必须在前序平台进入终态后才打开下一个平台。',
);

assertMatches(
  'entrypoints/background.ts',
  /if \(message\.type === 'GET_TASK'\) \{[\s\S]*?await normalizeAndPersistCurrentTask\(\);[\s\S]*?return ok\(currentTask\);/,
  '读取任务时必须归一化历史任务，避免旧任务继续携带不支持当前内容类型的平台。',
);

assertIncludes(
  'entrypoints/background.ts',
  'const NON_VIDEO_FILL_COMPLETION_TIMEOUT_MS = 120000;',
  '图文/文章填充已接手但无结果时必须比视频更快超时，避免长期停在填充中。',
);

assertMatches(
  'entrypoints/background.ts',
  /if \(contentType !== 'video'\) \{[\s\S]*?return NON_VIDEO_FILL_COMPLETION_TIMEOUT_MS;/,
  '图文/文章填充完成超时必须走非视频分支。',
);

assertIncludes(
  'src/types.ts',
  "type: 'REQUEST_PAGE_STATUS';",
  '后台必须能请求 content script 重新上报页面状态。',
);

assertMatches(
  'entrypoints/background.ts',
  /function scheduleOpeningStatusRefresh[\s\S]*?platformTask\.status !== 'opening'[\s\S]*?type: 'REQUEST_PAGE_STATUS'/,
  '平台打开后如果仍停在 opening，后台必须请求页面重新上报状态。',
);

assertMatches(
  'entrypoints/content.ts',
  /if \(message\.type === 'REQUEST_PAGE_STATUS'\) \{[\s\S]*?void reportPageStatus\(platform\);/,
  'content script 必须响应 REQUEST_PAGE_STATUS 并重新上报 ready/blocker。',
);

assertMatches(
  'entrypoints/dashboard/App.vue',
  /const enabledPlatforms = computed\(\(\) => platforms\.value\.filter\(\(p\) => platformSettings\[p\.id\]\?\.enabled !== false\)\);/,
  '发布页必须显示所有启用平台，由卡片禁用表达当前内容类型不支持。',
);

assertIncludes(
  'entrypoints/dashboard/views/PublishView.vue',
  ':disabled="!isPlatformSelectable(platform)"',
  '发布页目标平台卡片必须对当前内容类型不支持的平台置为不可选。',
);

assertIncludes(
  'entrypoints/dashboard/views/PublishView.vue',
  'const selectablePlatforms = computed(() =>',
  '发布页全选必须只作用于当前内容类型支持的平台。',
);

assertMatches(
  'entrypoints/dashboard/App.vue',
  /const supportedSelected = draft\.selectedPlatforms\.filter\(\(id\) => supportsContentType\(PLATFORM_CONFIGS\[id\], tab\)\);/,
  '切换发布类型时必须剔除不支持的平台。',
);

assertMatches(
  'src/features/distribution/useDistributionLauncher.ts',
  /const enabledOnly = PLATFORM_ORDER\.filter\(\(id\) => \([\s\S]*?supportsContentType\(PLATFORM_CONFIGS\[id\], content\.contentType \|\| 'video'\)/,
  '启动分发任务时必须只提交启用且支持当前内容类型的平台。',
);

assertMatches(
  'src/storage/draftStorage.ts',
  /selectedPlatforms: PLATFORM_ORDER\.filter\(\(id\) =>[\s\S]*?supportsContentType\(PLATFORM_CONFIGS\[id\], contentType\)/,
  '保存草稿时必须剔除不支持当前内容类型的平台。',
);

assertIncludes(
  'entrypoints/dashboard/views/PublishView.vue',
  'const hasZhihuPersonalSettings = computed(',
  '知乎平台个性化设置必须有显示兜底，避免内容类型过滤后只看不到配置。',
);

assertIncludes(
  'src/platforms/zhihu/content.ts',
  "const domainItem = findZhihuFormItem('所属领域');",
  '知乎所属领域必须先定位所属领域表单项，不能全局误点其他字段。',
);

assertIncludes(
  'src/platforms/zhihu/content.ts',
  "typeof platformSettings.declaration === 'string'",
  '知乎视频标记必须使用平台个性化设置中的选项。',
);

assertIncludes(
  'src/platforms/zhihu/content.ts',
  'await waitForZhihuInjectedCoverReady(input, 2200);',
  '知乎封面注入后不能长时间等待预览稳定，确认按钮可用后应快速继续。',
);

assertIncludes(
  'src/platforms/zhihu/content.ts',
  "const hasConfirmButton = Boolean(dialog && findZhihuButton(dialog, ['确认选择', '确认', '完成']));",
  '知乎封面等待必须把确认按钮可用作为就绪条件，避免上传完成后继续空等。',
);

assertIncludes(
  'src/content/publishSteps.ts',
  'Math.ceil(minutes / TIME_PICKER_MINUTE_STEP) * TIME_PICKER_MINUTE_STEP',
  'B站 5 分钟粒度定时控件必须向后取最近可选分钟，不能四舍五入到过去时间。',
);

assertIncludes(
  'src/content/imageUploader.ts',
  '/已添加\\s*\\d+\\s*张图片/',
  '抖音图文上传成功后以“已添加 N 张图片”为主要完成信号，不能继续等待不存在的预览 class。',
);

assertIncludes(
  'src/platforms/xiaohongshu/content.ts',
  '} else if (fields.description && content.description) {',
  '小红书图文正文必须使用 description 填入正文编辑器。',
);

assertIncludes(
  'src/platforms/douyin/content.ts',
  '} else if (fields.description && content.description) {',
  '抖音图文正文必须使用 description 填入正文编辑器。',
);

assertIncludes(
  'src/platforms/douyin/content.ts',
  'if (fields.cover) {',
  '抖音视频/图文/文章必须按当前内容字段设置封面，不能跳过必填封面流程。',
);

assertIncludes(
  'src/content/imageUploader.ts',
  'await waitForImageUploadSignal(uploadConfig, uploadSignals, Math.min(timeoutMs, IMAGE_UPLOAD_SIGNAL_TIMEOUT_MS))',
  '图文上传完成信号必须并行检查平台文案和 selector，不能先空等到 selector 超时。',
);

assertIncludes(
  'src/platforms/weixinChannels/pageWorld.ts',
  'if (!skipTitle && title && (topics.length > 0 || description))',
  '视频号图文描述跳过标题时不能先插入多余换行。',
);

assertNotIncludes(
  'src/platforms/weixinChannels/pageWorld.ts',
  'countExistingUploadedImages',
  '视频号重复上传不能靠泛化 DOM 计数判断，应由填充指令和上传签名幂等控制。',
);

assertMatches(
  'entrypoints/background.ts',
  /const requestId = crypto\.randomUUID\(\);[\s\S]*?for \(let attempt = 0; attempt < FILL_COMMAND_MAX_RETRIES; attempt\+\+\)/,
  '后台重试同一次填充命令必须复用 requestId，避免 ACK 超时后触发第二次真实填充。',
);

assertIncludes(
  'src/platforms/weixinChannels/pageWorld.ts',
  "const uploadStateKey = '__pubflowWeixinImageUploadState';",
  '视频号图文上传必须对同一页面同一批图片加幂等锁，避免重试时重复上传。',
);

assertIncludes(
  'src/platforms/xiaohongshu/content.ts',
  'async function fillXiaohongshuImageDescription(value: string)',
  '小红书图文描述必须使用专用填充兜底，确保 Tiptap 描述编辑器状态同步。',
);

assertIncludes(
  'src/features/distribution/useDistributionLauncher.ts',
  'scheduledAt: draft.scheduledAt || 0',
  '从我的视频重发/继续必须保存定时发布时间。',
);

assertIncludes(
  'src/features/publish/usePublishDraft.ts',
  'draft.scheduledAt = video.scheduledAt || 0;',
  '从我的视频重发/继续必须恢复定时发布时间。',
);

assertIncludes(
  'entrypoints/background.ts',
  '没有设置|不是\\s*contenteditable',
  '知乎所属领域设置失败必须被后台识别为失败状态。',
);

console.info('[PubFlow] platform routing invariants verified.');
