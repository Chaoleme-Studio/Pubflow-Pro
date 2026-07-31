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
  'src/features/distribution/distributionCoordinator.ts',
  /const contentType = request\.content\.contentType \|\| 'video';[\s\S]*?const supportedPlatforms = \[\.\.\.new Set\(request\.platforms\)\]\.filter\(\(platformId\) =>[\s\S]*?supportsContentType\(getPlatformConfig\(platformId\), contentType\)/,
  '统一分发协调器必须二次过滤当前内容类型支持的平台。',
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
  /if \(message\.type === 'FINAL_PUBLISH_CLICK'\) \{[\s\S]*?catch \(error\) \{[\s\S]*?status: 'error'[\s\S]*?await openNextPending\(\);/,
  '最终发布按钮点击失败后必须记录当前平台失败并继续下一个 pending 平台。',
);

assertMatches(
  'entrypoints/background.ts',
  /const visibleTop = Math\.max\(rect\.top, viewportTop\);[\s\S]*?const visibleBottom = Math\.min\(rect\.bottom, viewportBottom\);[\s\S]*?const localY = Math\.min\(Math\.max\(preferredY, visibleTop \+ 1\), visibleBottom - 1\);/,
  '最终发布点击点必须取按钮和可视视口的交集，不能因按钮中心越界而拒绝点击可见部分。',
);

assertMatches(
  'entrypoints/background.ts',
  /if \(mode === 'verify'\) \{[\s\S]*?originalTarget\[probeKey\] === true[\s\S]*?const matches = \(element\) =>/,
  '最终发布事后验证必须先读取原目标事件标记，不能因按钮点击后改文案或重渲染而假失败。',
);

assertMatches(
  'entrypoints/background.ts',
  /const verificationEvent = platformId === 'xiaohongshu'[\s\S]*?activation === 'keyboard' \? 'keydown' : 'click'/,
  '最终发布必须按激活方式验证可信输入，小红书 closed Shadow DOM 不得依赖宿主 click 冒泡。',
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

assertNotIncludes(
  'entrypoints/dashboard/views/PublishView.vue',
  'hasZhihuPersonalSettings',
  '未选择知乎时不能因为旧草稿中残留个性化设置而显示知乎标签。',
);

assertIncludes(
  'entrypoints/dashboard/views/PublishView.vue',
  'props.draft.selectedPlatforms.includes(platform.id)',
  '平台个性化标签必须只依据用户当前选择的平台生成。',
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
  'await waitForIdle(3800);',
  '知乎封面注入后必须等待 ReactCrop 和确认按钮完成渲染。',
);

assertIncludes(
  'src/platforms/zhihu/content.ts',
  'if (button && hasZhihuCoverAcceptedLocalFile(dialog, beforeDialogSignature)) return button;',
  '知乎封面等待必须同时校验确认按钮和本地封面预览，避免提前确认。',
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
  '} else if (fields.description && (content.description || content.topics.length > 0)) {',
  '小红书图文正文必须使用 description 和逐个话题填入正文编辑器。',
);

assertIncludes(
  'src/platforms/douyin/content.ts',
  '} else if (fields.description && (content.description || (!topicField && content.topics.length > 0))) {',
  '抖音图文正文必须使用 description 和逐个话题填入正文编辑器。',
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
  'if (!skipTitle && title && (description || topics.length > 0))',
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
  'src/platforms/weixinChannels/pageWorld.ts',
  "queryDeep('.post-with-mark-tag')",
  '视频号视频标注必须使用页面实际标注区域定位。',
);

assertIncludes(
  'src/platforms/weixinChannels/content.ts',
  'content.platformSettings?.weixinChannels?.videoMark',
  '视频号必须读取发布页的平台个性化视频标注设置。',
);

assertIncludes(
  'src/platforms/xiaohongshu/content.ts',
  'async function fillXiaohongshuImageDescription(value: string)',
  '小红书图文描述必须使用专用填充兜底，确保 Tiptap 描述编辑器状态同步。',
);

assertIncludes(
  'src/features/distribution/useDistributionLauncher.ts',
  'scheduledAt: normalizeScheduledAt(draft.scheduledAt)',
  '从我的视频重发/继续必须仅保存有效的未来定时发布时间。',
);

assertIncludes(
  'src/features/publish/usePublishDraft.ts',
  'draft.scheduledAt = asReplica ? 0 : normalizeScheduledAt(video.scheduledAt);',
  '从我的视频重发/继续必须只恢复有效的未来定时发布时间。',
);

assertIncludes(
  'src/platforms/x/selectors.ts',
  "发布页地址: 'https://x.com/compose/post'",
  'X 必须打开原生发帖编辑页。',
);

assertIncludes(
  'src/platforms/x/selectors.ts',
  "匹配域名: ['x.com']",
  'X 已统一使用 x.com，不应继续申请旧 twitter.com 页面权限。',
);

assertMatches(
  'src/platforms/x/selectors.ts',
  /上传:\s*\{[\s\S]*?需要激活标签页:\s*true/,
  'X 上传视频时必须激活当前标签页。',
);

assertIncludes(
  'src/platforms/x/content.ts',
  "attachments.querySelectorAll<HTMLElement>('[role=\"status\"]')",
  'X 不能以视频预览出现作为上传完成，必须等待附件状态显示就绪。',
);

assertIncludes(
  'src/platforms/x/content.ts',
  'content.platformSettings?.x?.replyAudience',
  'X 必须读取平台个性化回复权限。',
);

assertIncludes(
  'src/platforms/youtube/selectors.ts',
  "发布页地址: 'https://studio.youtube.com/'",
  'YouTube 必须打开 Studio 后台。',
);

assertIncludes(
  'src/platforms/youtube/selectors.ts',
  "'ytcp-uploads-file-picker input[type=\"file\"]'",
  'YouTube 当前上传 input 的 accept 为空，必须使用上传组件范围定位。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  'let uploadAction = findYouTubeUploadAction();',
  'YouTube 必须优先直接点击 Studio 首页上传按钮。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  'uploadAction = await waitForYouTubeUploadAction();',
  'Studio 首页没有上传按钮时，YouTube 必须回退创建菜单并轮询等待上传入口。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  "'VIDEO_MADE_FOR_KIDS_MFK' : 'VIDEO_MADE_FOR_KIDS_NOT_MFK'",
  'YouTube 必须填写面向儿童必填项。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  'button[aria-controls="age-restriction"]',
  'YouTube 选择年龄限制前必须展开“年龄限制（高级）”。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  "name.startsWith('VIDEO_AGE_RESTRICTION_')",
  'YouTube 年龄限制选择必须在同一次目标 radio 查找中完成展开，避免 Polymer 重渲染丢失节点。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  "section?.hasAttribute('hidden')",
  'YouTube 年龄限制展开必须以实际折叠容器 hidden 状态作为重试依据。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  'button[aria-label="显示高级设置"]',
  'YouTube 必须点击实测的高级设置原生按钮，不能点击内部触摸反馈层。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  'await expandYouTubeAdvancedSettings(remixRadioName);',
  'YouTube 展开高级设置后必须等待目标 Shorts 混剪权限节点实际渲染。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  "name.startsWith('REMIX_SOURCE_OPTION_')",
  'YouTube 选择 Shorts 混剪权限时必须再次确保目标节点可见。',
);

assertMatches(
  'src/platforms/youtube/content.ts',
  /const coverMessage = await uploadYouTubeCover\(content\);[\s\S]*?await fillYouTubePlatformSettings\(content\);/,
  'YouTube 长视频缩略图上传必须先于可选平台设置。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  'YouTube 部分高级设置未自动填写',
  'YouTube 可选高级设置失败必须降级为人工检查提示，不能让整个平台任务失败。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  'for (let clickCount = 0; clickCount < 3; clickCount++)',
  'YouTube 填写详情后必须依次经过视频元素、检查和公开范围三个步骤。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  "friends: 'UNLISTED'",
  'YouTube 必须将通用好友可见映射为不公开列出。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  "'#time-of-day-container input'",
  'YouTube 定时发布必须填写实测的时间输入框。',
);

assertMatches(
  'src/platforms/youtube/content.ts',
  /selectYouTubeVisibilityContainer\(visibilityRoot, 'first'\);[\s\S]*?selectYouTubeRadio\('PUBLIC', '公开范围'\);[\s\S]*?waitForYouTubeVisibilitySelectionStable\(visibilityRoot, 'PUBLIC'\);[\s\S]*?selectYouTubeVisibilityContainer\(visibilityRoot, 'second'\);[\s\S]*?fillYouTubeSchedule\(visibilityRoot, plan\.scheduledAt\);/,
  'YouTube 定时流程必须先稳定保存 PUBLIC，再切换互斥的安排时间容器。',
);

assertIncludes(
  'entrypoints/dashboard/views/PublishView.vue',
  'YouTube 定时公开范围',
  '发布页必须明确展示 YouTube 定时发布固定为公开，避免误认为通用可见性未关联。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  'YouTube 定时发布仅支持公开，已按平台规则覆盖通用可见性',
  'YouTube 定时发布覆盖非公开可见性时必须在任务结果中说明。',
);

assertNotIncludes(
  'src/platforms/youtube/content.ts',
  "querySelector('#done-button')?.click()",
  'YouTube 自动填充不能点击最终发布、保存或预定按钮。',
);

assertIncludes(
  'src/platforms/youtube/content.ts',
  "'ytcp-thumbnail-uploader input#file-loader[type=\"file\"]'",
  'YouTube 长视频必须支持上传自定义缩略图。',
);

assertMatches(
  'src/platforms/youtube/content.ts',
  /isYouTubeShortsThumbnailFlow\(getYouTubeUploadDialogText\(\)\)[\s\S]*?return '';/,
  'YouTube Shorts 没有网页端自定义缩略图入口时必须静默跳过。',
);

assertNotIncludes(
  'src/platforms/youtube/content.ts',
  '请确认频道已完成手机号验证并开通自定义缩略图',
  '找不到 YouTube 缩略图入口时不能直接误判为账号权限问题。',
);

assertMatches(
  'src/platforms/weixinChannels/pageWorld.ts',
  /function findCoverEntry[\s\S]*?queryDeep\(`\$\{entrySelector\} \.edit-btn`\)[\s\S]*?style\.visibility !== 'hidden'/,
  '视频号封面入口必须优先点击 hover 编辑按钮，避免点击封面容器触发视频播放。',
);

assertMatches(
  'src/platforms/weixinChannels/pageWorld.ts',
  /await sleep\(600\);[\s\S]*?const currentDialog = findActiveCoverDialog[\s\S]*?const confirmButton = findScopedButton/,
  '视频号封面预览完成后必须等待确认区稳定并重新获取按钮。',
);

assertIncludes(
  'src/platforms/weixinChannels/pageWorld.ts',
  'pauseVideosStartedByCoverClick(previouslyPlaying);',
  '视频号封面入口误触启动视频时必须恢复为暂停状态。',
);

assertIncludes(
  'entrypoints/dashboard/views/PublishView.vue',
  '谁可以回复',
  '发布页必须提供 X 回复权限个性化设置。',
);

assertIncludes(
  'entrypoints/dashboard/views/PublishView.vue',
  '观众（必填）',
  '发布页必须提供 YouTube 观众必填设置。',
);

assertMatches(
  'src/platforms/youtube/selectors.ts',
  /上传:\s*\{[\s\S]*?需要激活标签页:\s*true/,
  'YouTube Studio 上传时必须激活当前标签页。',
);

assertIncludes(
  'src/platforms/flows.ts',
  'x: fillXContent,',
  'X 必须进入统一网页内容填充路由。',
);

assertIncludes(
  'src/platforms/flows.ts',
  'youtube: fillYouTubeContent,',
  'YouTube 必须进入统一网页内容填充路由。',
);

assertIncludes(
  'src/content/dom.ts',
  'element.shadowRoot',
  'YouTube Studio 字段查询必须支持穿透开放的 Shadow DOM。',
);

assertNotIncludes(
  'wxt.config.ts',
  "'identity'",
  '网页自动填充方案不应申请 Chrome Identity 权限。',
);

assertNotIncludes(
  'wxt.config.ts',
  'oauth2:',
  '网页自动填充方案不应写入 OAuth 客户端配置。',
);

assertNotIncludes(
  'entrypoints/dashboard/views/SettingsView.vue',
  'API 直发账号',
  '设置页不应再展示 X/YouTube API 账号连接卡片。',
);

assertIncludes(
  'entrypoints/background.ts',
  '没有设置|不是\\s*contenteditable',
  '知乎所属领域设置失败必须被后台识别为失败状态。',
);

assertMatches(
  'src/content/fieldFiller.ts',
  /insertTopicAtCaret\(editable, `#\$\{topics\[index\]\}`\);[\s\S]*?await waitForIdle\(delayMs\);[\s\S]*?confirmTopicWithEnter\(editable\);[\s\S]*?await waitForIdle\(delayMs\);[\s\S]*?insertTopicSeparatorSpace\(editable\);/,
  '共用描述编辑器必须按 #话题、等待、Enter、等待、空格的顺序填写。',
);

assertIncludes(
  'src/platforms/douyin/content.ts',
  'fillDescriptionWithTopicsByTrustedInput(',
  '抖音描述和话题必须走可信点击及键盘输入，不能再用合成 Enter 造成换行。',
);

assertIncludes(
  'src/platforms/zhihu/content.ts',
  'fillDescriptionWithTopicsByTrustedInput(',
  '知乎视频简介必须先可信点击激活，并合并填写独立话题。',
);

assertMatches(
  'entrypoints/background.ts',
  /for \(const topic of topics\)[\s\S]*?Input\.insertText'[\s\S]*?topicIntervalMs[\s\S]*?dispatchCdpKey\(debuggee, 'Enter'[\s\S]*?topicIntervalMs[\s\S]*?Input\.insertText', \{ text: ' ' \}/,
  '可信话题输入必须按逐个输入、等待、Enter、等待、空格的顺序执行。',
);

assertMatches(
  'src/platforms/weixinChannels/pageWorld.ts',
  /insertTopicText\(editor, `#\$\{clean\}`\);[\s\S]*?await sleep\(topicIntervalMs\);[\s\S]*?confirmTopicWithEnter\(editor\);[\s\S]*?await sleep\(topicIntervalMs\);[\s\S]*?simulateKey\(editor, ' '\);/,
  '视频号主世界必须按 #话题、等待、Enter、等待、空格的顺序填写。',
);

assertIncludes(
  'entrypoints/dashboard/views/VideosView.vue',
  "platform.status === 'published' || platform.status === 'filled' ? 'badge-published'",
  '我的视频平台状态列必须把已填充和已发布都显示为完成绿色。',
);

assertIncludes(
  'entrypoints/dashboard/views/VideosView.vue',
  `@click="emit('replicateVideo', video)">复刻</button>`,
  '我的视频第二个操作必须是独立的复刻事件，不能继续复用编辑原项目事件。',
);

assertIncludes(
  'src/storage/workspaceStorage.ts',
  'resetPlatformStatuses: Boolean(draft.replicaSourceProjectId)',
  '复刻草稿项目不得继承源项目或旧草稿的已发布状态。',
);

assertIncludes(
  'src/features/publish/usePublishDraft.ts',
  'const reuseReplicaProject = Boolean(asReplica && draft.replicaSourceProjectId && draft.projectId);',
  '连续复刻必须复用同一个未发布复刻草稿项目。',
);

console.info('[PubFlow] platform routing invariants verified.');
