import { fillField, humanDelay } from '../../content/fieldFiller';
import { findDeepElement, findElement, findVisibleElement, isVisible, waitForElement, waitForIdle } from '../../content/dom';
import { assignFilesToInput } from '../../content/uploadDom';
import { uploadVideoIfAvailable } from '../../content/videoUploader';
import { composePublishMessage, waitForEditorReady } from '../../content/publishSteps';
import { loadFileForTransfer } from '../../storage/videoTransferStorage';
import type { ContentData } from '../../types';
import type { PlatformConfig } from '../types';

const VIDEO_INPUT_WAIT_MS = 15_000;
const UPLOAD_ACTION_WAIT_MS = 8_000;
const UPLOAD_ACTION_POLL_MS = 250;
const YOUTUBE_CONTROL_SETTLE_MS = 450;
const YOUTUBE_COVER_CONFIRM_TIMEOUT_MS = 20_000;
const YOUTUBE_NEXT_STEP_TIMEOUT_MS = 180_000;
const YOUTUBE_STEP_TRANSITION_TIMEOUT_MS = 15_000;
const YOUTUBE_VISIBILITY_STABLE_MS = 800;

type YouTubeAudience = 'madeForKids' | 'notForKids';
type YouTubeAlteredContent = 'yes' | 'no' | '';
type YouTubeAgeRestriction = 'none' | 'over18';
type YouTubeRemixPermission = 'videoAndAudio' | 'audioOnly' | 'none';
type YouTubeVisibilityName = 'PUBLIC' | 'UNLISTED' | 'PRIVATE';

export type YouTubeVisibilityPlan =
  | { container: 'second'; scheduledAt: number }
  | { container: 'first'; visibilityName: YouTubeVisibilityName };

/** YouTube Studio 使用浏览器现有登录态打开上传弹窗并填写视频详情，不点击最终发布。 */
export async function fillYouTubeContent(config: PlatformConfig, content: ContentData) {
  await ensureYouTubeUploadDialog(config);

  const uploadMessage = await uploadVideoIfAvailable(config, content);
  await humanDelay();

  await waitForEditorReady(config);
  if (config.fields.title && content.title) {
    await fillField(config.fields.title, truncate(content.title, 100));
    await humanDelay();
  }
  if (config.fields.description) {
    const description = buildYouTubeDescription(content);
    if (description) {
      await fillField(config.fields.description, description);
      await humanDelay();
    }
  }

  const coverMessage = await uploadYouTubeCover(content);
  if (coverMessage) await humanDelay();
  const settingsMessage = await fillYouTubePlatformSettings(content);
  const reviewMessage = await fillYouTubeVisibilityAndSchedule(content);
  return composePublishMessage(uploadMessage, coverMessage, `${settingsMessage}${reviewMessage}`);
}

/**
 * Studio 的直达上传地址依赖当前账号的 channelId，不能写入公共平台配置。
 * 通用流程从 Studio 首页进入，优先直接点击首页“上传视频”；首页没有入口时再走“创建”菜单。
 */
async function ensureYouTubeUploadDialog(config: PlatformConfig) {
  if (findElement<HTMLInputElement>(config.upload?.fileInputSelector || [])) return;

  let uploadAction = findYouTubeUploadAction();
  if (!uploadAction) {
    const createButton = findVisibleElement([
      'button[aria-label="创建"]',
      'button[aria-label="Create"]',
      'ytcp-button#create-icon',
      '#create-icon',
      'button[aria-label*="创建"]',
      'button[aria-label*="Create"]',
    ]);
    if (!createButton) {
      throw new Error('没有找到 YouTube Studio 的“上传视频”或“创建”按钮，请确认已经登录并进入频道后台。');
    }
    createButton.click();
    await waitForIdle(400);
    uploadAction = await waitForYouTubeUploadAction();
  }
  if (!uploadAction) {
    throw new Error('没有找到 YouTube Studio 的“上传视频”入口，请手动打开上传弹窗后重试。');
  }
  uploadAction.click();

  const input = await waitForElement<HTMLInputElement>(config.upload?.fileInputSelector || [], VIDEO_INPUT_WAIT_MS);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('YouTube 上传弹窗已打开，但没有找到视频文件输入框。');
  }
}

/** 优先命中 Studio 首页的上传按钮，也兼容“创建”菜单里的上传入口。 */
function findYouTubeUploadAction() {
  return findDeepElement<HTMLElement>(
    'button[aria-label="上传视频"], button[aria-label="Upload videos"], tp-yt-paper-item[role="menuitem"], ytcp-text-menu-item, [role="menuitem"]',
    (element): element is HTMLElement => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
      const text = `${element.textContent || ''} ${element.getAttribute('aria-label') || ''}`
        .replace(/\s+/g, '')
        .toLowerCase();
      return text.includes('上传视频') || text.includes('uploadvideos');
    },
  );
}

/** 等待“创建”菜单动画和异步节点完成，避免固定延时后偶发找不到上传入口。 */
async function waitForYouTubeUploadAction() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < UPLOAD_ACTION_WAIT_MS) {
    const action = findYouTubeUploadAction();
    if (action) return action;
    await waitForIdle(UPLOAD_ACTION_POLL_MS);
  }
  return undefined;
}

async function uploadYouTubeCover(content: ContentData) {
  if (!content.coverCacheId) return '未选择封面，YouTube 将自动生成视频缩略图。';
  if (isYouTubeShortsThumbnailFlow(getYouTubeUploadDialogText())) return '';

  const file = await loadFileForTransfer(content.coverCacheId);
  if (!file) return '封面缓存不存在，跳过 YouTube 自定义封面。';

  const input = await waitForElement<HTMLInputElement>([
    'ytcp-thumbnail-uploader input#file-loader[type="file"]',
    'ytcp-thumbnails-compact-editor-uploader input[type="file"]',
    'ytcp-thumbnail-uploader input[type="file"][accept*="image"]',
  ], 8_000);
  if (!(input instanceof HTMLInputElement)) {
    if (isYouTubeShortsThumbnailFlow(getYouTubeUploadDialogText())) return '';
    return 'YouTube 当前页面未显示自定义缩略图入口，已跳过封面上传。';
  }

  const beforePreview = getYouTubeCustomThumbnailSignatures();
  assignFilesToInput(input, [file]);
  const startedAt = Date.now();
  while (Date.now() - startedAt < YOUTUBE_COVER_CONFIRM_TIMEOUT_MS) {
    const dialogText = getYouTubeUploadDialogText();
    if (isYouTubeShortsThumbnailFlow(dialogText)) return '';
    if (/验证.*(?:手机|电话号码)|verify.*(?:phone|number)|自定义缩略图.*(?:不可用|未启用)/i.test(dialogText)) {
      return 'YouTube 当前页面不支持自定义缩略图，已跳过封面上传。';
    }
    const currentPreview = getYouTubeCustomThumbnailSignatures();
    if (currentPreview.some((signature) => !beforePreview.includes(signature))) {
      return 'YouTube 自定义封面已上传并显示预览。';
    }
    await waitForIdle(500);
  }
  return 'YouTube 封面预览未确认，已继续填写，请在发布前检查缩略图。';
}

function getYouTubeUploadDialogText() {
  return document.querySelector('ytcp-uploads-dialog')?.textContent || '';
}

export function isYouTubeShortsThumbnailFlow(dialogText: string) {
  const normalizedText = dialogText.replace(/\s+/g, ' ');
  return /(?:移动版\s*YouTube\s*应用.*(?:缩略图|视频帧)|(?:缩略图|视频帧).*移动版\s*YouTube\s*应用)/i.test(normalizedText)
    || /(?:YouTube\s+mobile\s+app.*(?:thumbnail|frame)|(?:thumbnail|frame).*YouTube\s+mobile\s+app)/i.test(normalizedText);
}

function getYouTubeCustomThumbnailSignatures() {
  const root = findElement<HTMLElement>([
    'ytcp-video-custom-still-editor',
    'ytcp-thumbnail-uploader',
  ]);
  if (!root) return [];
  const signatures = new Set<string>();
  for (const image of Array.from(root.querySelectorAll<HTMLImageElement>('img'))) {
    const src = image.getAttribute('src')?.trim() || '';
    if (src) signatures.add(`img:${src}`);
  }
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[style*="background-image"]'))) {
    const background = element.style.backgroundImage || getComputedStyle(element).backgroundImage;
    if (background && background !== 'none') signatures.add(`bg:${background}`);
  }
  return [...signatures];
}

/** 填写 YouTube 必填项和常用平台个性化设置，低频账号项保留平台默认。 */
async function fillYouTubePlatformSettings(content: ContentData) {
  const settings = content.platformSettings?.youtube ?? {};
  const remixPermission: YouTubeRemixPermission =
    settings.remixPermission === 'audioOnly' || settings.remixPermission === 'none'
      ? settings.remixPermission
      : 'videoAndAudio';
  const remixRadioNames: Record<YouTubeRemixPermission, string> = {
    videoAndAudio: 'REMIX_SOURCE_OPTION_OPT_IN',
    audioOnly: 'REMIX_SOURCE_OPTION_VISUAL_OPT_OUT_AND_PERFORM_ACTIONS',
    none: 'REMIX_SOURCE_OPTION_OPT_OUT_AND_MUTE_DERIVATIVES',
  };
  const remixRadioName = remixRadioNames[remixPermission];
  let advancedSettingsError = '';
  try {
    await expandYouTubeAdvancedSettings(remixRadioName);
  } catch (error) {
    advancedSettingsError = error instanceof Error ? error.message : String(error);
  }

  const audience: YouTubeAudience = settings.audience === 'madeForKids' ? 'madeForKids' : 'notForKids';
  await selectYouTubeRadio(
    audience === 'madeForKids' ? 'VIDEO_MADE_FOR_KIDS_MFK' : 'VIDEO_MADE_FOR_KIDS_NOT_MFK',
    '面向儿童',
  );

  const ageRestriction: YouTubeAgeRestriction = settings.ageRestriction === 'over18' ? 'over18' : 'none';
  await selectYouTubeRadio(
    ageRestriction === 'over18' ? 'VIDEO_AGE_RESTRICTION_SELF' : 'VIDEO_AGE_RESTRICTION_NONE',
    '年龄限制',
  );

  if (advancedSettingsError) {
    return `YouTube 高级设置未自动展开（${advancedSettingsError}），请在平台页面手动检查；`;
  }

  try {
    const alteredContent: YouTubeAlteredContent =
      settings.alteredContent === 'yes' || settings.alteredContent === 'no' ? settings.alteredContent : '';
    if (alteredContent) {
      await selectYouTubeRadio(
        alteredContent === 'yes' ? 'VIDEO_HAS_ALTERED_CONTENT_YES' : 'VIDEO_HAS_ALTERED_CONTENT_NO',
        'AI 使用情况',
      );
    }

    await setYouTubeCheckbox(['我的视频中包含付费宣传内容', 'paid promotion'], Boolean(settings.paidPromotion ?? false));
    await setYouTubeCheckbox(['允许自动划分章节', 'automatic chapters'], Boolean(settings.autoChapters ?? true));
    await setYouTubeCheckbox(['允许自动显示地点信息', 'automatic places'], Boolean(settings.autoPlaces ?? true));
    await setYouTubeCheckbox(['允许自动展示概念', 'automatic concepts'], Boolean(settings.autoConcepts ?? true));
    await setYouTubeCheckbox(['允许嵌入', 'allow embedding'], Boolean(settings.allowEmbedding ?? true));
    await setYouTubeCheckbox(['发布到订阅动态并通知订阅者', 'notify subscribers'], Boolean(settings.notifySubscribers ?? true));

    await selectYouTubeRadio(remixRadioName, 'Shorts 混剪权限');

    if (settings.fillTagsFromTopics !== false && content.topics.length) {
      const tagText = `${content.topics
        .map((topic) => topic.trim().replace(/^#+/, ''))
        .filter(Boolean)
        .join(',')},`;
      if (tagText !== ',') {
        await fillField({
          selectors: ['input[aria-label="标签"]', 'input[aria-label="Tags"]', '#tags-container input#text-input'],
          fillMethod: 'simulateTyping',
        }, tagText);
        await humanDelay();
      }
    }

    if (typeof settings.videoLanguage === 'string' && settings.videoLanguage) {
      await selectYouTubeDropdownOption(['视频语言', 'video language'], settings.videoLanguage);
    }
    if (typeof settings.category === 'string' && settings.category) {
      await selectYouTubeDropdownOption(['类别', 'category'], settings.category);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `YouTube 部分高级设置未自动填写（${message}），请在平台页面手动检查；`;
  }

  return '';
}

/** 依次进入视频元素、检查和公开范围；最终发布按钮始终留给用户确认。 */
async function advanceYouTubeToVisibilityStep() {
  for (let clickCount = 0; clickCount < 3; clickCount++) {
    if (isYouTubeVisibilityStepReady()) return;

    const previousStep = getYouTubeCurrentStepIndex();
    const nextButton = await waitForYouTubeNextButton();
    nextButton.scrollIntoView({ block: 'center', behavior: 'auto' });
    nextButton.click();

    const startedAt = Date.now();
    while (Date.now() - startedAt < YOUTUBE_STEP_TRANSITION_TIMEOUT_MS) {
      if (isYouTubeVisibilityStepReady()) return;
      const currentStep = getYouTubeCurrentStepIndex();
      if (currentStep > previousStep) break;
      await waitForIdle(250);
    }

    if (getYouTubeCurrentStepIndex() <= previousStep && !isYouTubeVisibilityStepReady()) {
      throw new Error(`YouTube 点击“继续”后没有进入下一步，当前步骤：${previousStep + 1}/4`);
    }
  }

  if (!isYouTubeVisibilityStepReady()) {
    throw new Error('YouTube 连续完成三个步骤后仍未进入“公开范围”。');
  }
}

function getYouTubeCurrentStepIndex() {
  const activeStep = findDeepElement<HTMLElement>(
    '#ytcp-uploads-dialog-stepper [step-index][aria-selected="true"], [step-index][active]',
    (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
  );
  const index = Number(activeStep?.getAttribute('step-index'));
  return Number.isFinite(index) ? index : -1;
}

function isYouTubeVisibilityStepReady() {
  return Boolean(findDeepElement<HTMLElement>(
    'ytcp-uploads-review #visibility-container, ytcp-video-visibility-select',
    (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
  ));
}

async function waitForYouTubeNextButton() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < YOUTUBE_NEXT_STEP_TIMEOUT_MS) {
    const button = findDeepElement<HTMLButtonElement>(
      '#next-button button[aria-label="继续"], #next-button button[aria-label="Next"], button[aria-label="继续"], button[aria-label="Next"]',
      (element): element is HTMLButtonElement => (
        element instanceof HTMLButtonElement &&
        isVisible(element) &&
        !element.disabled &&
        element.getAttribute('aria-disabled') !== 'true'
      ),
    );
    if (button) return button;
    await waitForIdle(500);
  }
  throw new Error('YouTube 的“继续”按钮长时间不可用，请检查视频处理或版权检查状态。');
}

async function fillYouTubeVisibilityAndSchedule(content: ContentData) {
  await advanceYouTubeToVisibilityStep();
  const visibilityRoot = findDeepElement<HTMLElement>(
    'ytcp-video-visibility-select',
    (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
  );
  if (!visibilityRoot) throw new Error('YouTube 已进入“公开范围”，但没有找到公开范围设置区域。');

  const plan = resolveYouTubeVisibilityPlan(content);
  if (plan.container === 'second') {
    if (plan.scheduledAt <= Date.now()) {
      throw new Error('YouTube 定时发布时间必须晚于当前时间。');
    }
    // 两个容器互斥：先稳定保存公开状态，再切换到安排时间，避免 Polymer 重渲染丢失可见性。
    await selectYouTubeVisibilityContainer(visibilityRoot, 'first');
    await selectYouTubeRadio('PUBLIC', '公开范围');
    await waitForYouTubeVisibilitySelectionStable(visibilityRoot, 'PUBLIC');
    await selectYouTubeVisibilityContainer(visibilityRoot, 'second');
    await fillYouTubeSchedule(visibilityRoot, plan.scheduledAt);
    const visibilityOverride = content.visibility && content.visibility !== 'public'
      ? 'YouTube 定时发布仅支持公开，已按平台规则覆盖通用可见性；'
      : '';
    return `${visibilityOverride}YouTube 已填写公开定时时间，未点击“预定”，请检查后确认；`;
  }

  await selectYouTubeVisibilityContainer(visibilityRoot, 'first');
  await selectYouTubeRadio(plan.visibilityName, '公开范围');
  await waitForYouTubeVisibilitySelectionStable(visibilityRoot, plan.visibilityName);
  return 'YouTube 已填写公开范围，未点击最终“发布 / 保存”，请检查后确认；';
}

/** 将互斥的“保存或发布 / 安排时间”建模成单选计划，避免定时任务同时操作两个容器。 */
export function resolveYouTubeVisibilityPlan(
  content: Pick<ContentData, 'scheduledAt' | 'visibility'>,
): YouTubeVisibilityPlan {
  if (content.scheduledAt) {
    return { container: 'second', scheduledAt: content.scheduledAt };
  }
  const visibilityNames: Record<NonNullable<ContentData['visibility']>, YouTubeVisibilityName> = {
    public: 'PUBLIC',
    friends: 'UNLISTED',
    private: 'PRIVATE',
  };
  return {
    container: 'first',
    visibilityName: visibilityNames[content.visibility || 'public'],
  };
}

async function selectYouTubeVisibilityContainer(root: HTMLElement, target: 'first' | 'second') {
  const attribute = `${target}-container-style`;
  if (root.getAttribute(attribute) === 'selected') {
    await waitForYouTubeVisibilityContainerReady(root, target);
    return;
  }

  const button = root.querySelector<HTMLElement>(`#${target}-container-expand-button`);
  if (!button) throw new Error(`YouTube 没有找到${target === 'first' ? '“保存或发布”' : '“安排时间”'}入口。`);
  button.scrollIntoView({ block: 'center', behavior: 'auto' });
  button.click();

  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    if (root.getAttribute(attribute) === 'selected') {
      await waitForYouTubeVisibilityContainerReady(root, target);
      return;
    }
    await waitForIdle(200);
  }
  throw new Error(`YouTube ${target === 'first' ? '“保存或发布”' : '“安排时间”'}没有展开。`);
}

async function waitForYouTubeVisibilityContainerReady(root: HTMLElement, target: 'first' | 'second') {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    const readyElement = target === 'first'
      ? root.querySelector<HTMLElement>('[name="PUBLIC"], [name="UNLISTED"], [name="PRIVATE"]')
      : root.querySelector<HTMLElement>('#datepicker-trigger');
    if (readyElement && isVisible(readyElement)) return;
    await waitForIdle(150);
  }
  throw new Error(`YouTube ${target === 'first' ? '公开范围选项' : '定时发布控件'}没有完成渲染。`);
}

async function waitForYouTubeVisibilitySelectionStable(root: HTMLElement, name: 'PUBLIC' | 'UNLISTED' | 'PRIVATE') {
  const startedAt = Date.now();
  let stableSince = 0;
  while (Date.now() - startedAt < 5_000) {
    const radio = root.querySelector<HTMLElement>(`[name="${name}"]`);
    const stable = root.getAttribute('first-container-style') === 'selected' &&
      Boolean(radio && isVisible(radio) && isYouTubeControlChecked(radio));
    if (stable) {
      stableSince ||= Date.now();
      if (Date.now() - stableSince >= YOUTUBE_VISIBILITY_STABLE_MS) return;
    } else {
      stableSince = 0;
    }
    await waitForIdle(100);
  }
  throw new Error(`YouTube 公开范围没有稳定生效：${name}`);
}

async function fillYouTubeSchedule(root: HTMLElement, scheduledAt: number) {
  const target = new Date(scheduledAt);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  const day = target.getDate();
  const time = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
  const dateTrigger = root.querySelector<HTMLElement>('#datepicker-trigger');
  if (!dateTrigger) throw new Error('YouTube 没有找到定时发布日期入口。');

  const expectedDateLabels = [
    `${year}年${month}月${day}日`,
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(target),
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(target),
  ];
  const currentDateText = (dateTrigger.textContent || '').replace(/\s+/g, ' ').trim();
  if (!expectedDateLabels.some((label) => currentDateText.includes(label))) {
    dateTrigger.click();
    const calendar = await waitForYouTubeCalendar();
    const dayElement = await findYouTubeCalendarDay(calendar, target);
    dayElement.scrollIntoView({ block: 'center', behavior: 'auto' });
    dayElement.click();
    await waitForIdle(YOUTUBE_CONTROL_SETTLE_MS);
  }

  const timeInput = root.querySelector<HTMLInputElement>('#time-of-day-container input');
  if (!timeInput) throw new Error('YouTube 没有找到定时发布时间输入框。');
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  timeInput.focus();
  nativeSetter?.call(timeInput, time);
  timeInput.dispatchEvent(new Event('input', { bubbles: true }));
  timeInput.dispatchEvent(new Event('change', { bubbles: true }));
  timeInput.blur();
  await waitForIdle(YOUTUBE_CONTROL_SETTLE_MS);
  if (timeInput.value !== time) {
    throw new Error(`YouTube 定时发布时间没有生效：${time}`);
  }
}

async function waitForYouTubeCalendar() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    const calendar = findDeepElement<HTMLElement>(
      'ytcp-scrollable-calendar#calendar, ytcp-scrollable-calendar',
      (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
    );
    if (calendar) return calendar;
    await waitForIdle(200);
  }
  throw new Error('YouTube 点击日期后没有显示日历。');
}

async function findYouTubeCalendarDay(calendar: HTMLElement, target: Date) {
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  const day = target.getDate();
  const targetMonthLabels = [
    `${year}年${month}月`,
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long' }).format(target),
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short' }).format(target),
  ];
  const monthDifference = (year - new Date().getFullYear()) * 12 + target.getMonth() - new Date().getMonth();
  const scrollContainer = calendar.querySelector<HTMLElement>('#calendar-main');

  for (let attempt = 0; attempt < 5; attempt++) {
    const monthContainer = Array.from(calendar.querySelectorAll<HTMLElement>('.calendar-month')).find((candidate) => {
      const label = candidate.querySelector<HTMLElement>('.calendar-month-label')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      return targetMonthLabels.some((targetLabel) => label.includes(targetLabel));
    });
    const dayElement = monthContainer
      ? Array.from(monthContainer.querySelectorAll<HTMLElement>('.calendar-day')).find((candidate) => {
        const className = candidate.className?.toString() || '';
        return candidate.textContent?.trim() === String(day) &&
          !className.includes('disabled') &&
          !className.includes('invisible');
      })
      : undefined;
    if (dayElement) return dayElement;

    if (scrollContainer) {
      scrollContainer.scrollTop = Math.max(0, monthDifference * 216);
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    await waitForIdle(300);
  }
  throw new Error(`YouTube 日历没有找到日期：${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
}

async function expandYouTubeAdvancedSettings(targetName: string): Promise<HTMLElement | undefined> {
  const findTargetRadio = () => findDeepElement<HTMLElement>(
    `[name="${targetName}"]`,
    (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
  );
  const visibleRadio = findTargetRadio();
  if (visibleRadio) return visibleRadio;

  // 中文版实测结构：ytcp-button#toggle-button > ... > button[aria-label="显示高级设置"]
  // ytSpecTouchFeedbackShapeHost 只是按钮内部的触摸反馈层，不能作为点击目标。
  let button = findDeepElement<HTMLElement>(
    [
      'ytcp-button#toggle-button button[aria-label="显示高级设置"]',
      'button[aria-label="显示高级设置"]',
      'button[aria-label="Show advanced settings"]',
    ].join(', '),
    (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
  );
  button ||= findDeepElement<HTMLElement>(
    'button, [role="button"]',
    (element): element is HTMLElement => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
      const text = element.textContent?.replace(/\s+/g, ' ').trim() || '';
      const ariaLabel = element.getAttribute('aria-label') || '';
      return /展开|显示更多|show more/i.test(text) || /显示高级设置|show advanced settings/i.test(ariaLabel);
    },
  );
  if (button) {
    button.scrollIntoView({ block: 'center', behavior: 'auto' });
    button.click();
  } else {
    const collapseButton = findDeepElement<HTMLElement>(
      'button[aria-label="隐藏高级设置"], button[aria-label="Hide advanced settings"]',
      (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
    );
    if (!collapseButton) throw new Error('YouTube 没有找到“展开 / 显示高级设置”按钮。');
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    const radio = findTargetRadio();
    if (radio) return radio;
    await waitForIdle(200);
  }
  throw new Error(`YouTube 已点击“展开”，但 Shorts 混剪权限仍未显示：${targetName}`);
}

/** 年龄限制是独立折叠项；展开后直接返回目标 radio，避免 Polymer 重渲染造成二次查找丢失。 */
async function expandYouTubeAgeRestriction(targetName: string): Promise<HTMLElement | undefined> {
  const findTargetRadio = (visibleOnly: boolean) => findDeepElement<HTMLElement>(
    `[name="${targetName}"]`,
    (element): element is HTMLElement => (
      element instanceof HTMLElement && (!visibleOnly || isVisible(element))
    ),
  );
  const visibleRadio = findTargetRadio(true);
  if (visibleRadio) return visibleRadio;

  const section = findDeepElement<HTMLElement>(
    'ytcp-age-restriction-select#age-restriction, #age-restriction',
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
  let button = findDeepElement<HTMLElement>(
    'button[aria-controls="age-restriction"], [role="button"][aria-controls="age-restriction"]',
    (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
  );
  button ||= findDeepElement<HTMLElement>(
    'button, [role="button"]',
    (element): element is HTMLElement => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
      const text = element.textContent?.replace(/\s+/g, ' ').trim() || '';
      return /年龄限制（高级）|age restriction/i.test(text);
    },
  );
  if (!button) {
    const hiddenRadio = findTargetRadio(false);
    if (hiddenRadio && isYouTubeControlChecked(hiddenRadio)) return hiddenRadio;
    throw new Error('YouTube 没有找到“年龄限制（高级）”展开按钮。');
  }

  button.scrollIntoView({ block: 'center', behavior: 'auto' });
  button.click();

  const startedAt = Date.now();
  let retried = false;
  while (Date.now() - startedAt < 5_000) {
    const radio = findTargetRadio(true);
    if (radio) return radio;

    // 实测折叠容器通过 hidden 控制显示。如果平台吞掉第一次点击，仅在仍为 hidden 时重试一次。
    if (!retried && Date.now() - startedAt >= 1_000 && section?.hasAttribute('hidden')) {
      retried = true;
      button.click();
    }
    await waitForIdle(200);
  }

  const hiddenRadio = findTargetRadio(false);
  if (hiddenRadio && isYouTubeControlChecked(hiddenRadio)) return hiddenRadio;
  const sectionState = section?.hasAttribute('hidden') ? '仍处于折叠状态' : '已经展开但目标选项不可见';
  throw new Error(`YouTube 已点击“年龄限制（高级）”，但${sectionState}：${targetName}`);
}

async function selectYouTubeRadio(name: string, label: string) {
  const radio = name.startsWith('VIDEO_AGE_RESTRICTION_')
    ? await expandYouTubeAgeRestriction(name)
    : name.startsWith('REMIX_SOURCE_OPTION_')
      ? await expandYouTubeAdvancedSettings(name)
    : findDeepElement<HTMLElement>(
      `[name="${name}"]`,
      (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
    );
  if (!radio) throw new Error(`YouTube 没有找到${label}选项：${name}`);
  if (isYouTubeControlChecked(radio)) return;
  if (!isVisible(radio)) throw new Error(`YouTube ${label}选项仍处于折叠状态：${name}`);
  radio.scrollIntoView({ block: 'center', behavior: 'auto' });
  radio.click();
  await waitForIdle(YOUTUBE_CONTROL_SETTLE_MS);
  if (!isYouTubeControlChecked(radio)) throw new Error(`YouTube ${label}选项没有生效。`);
}

async function setYouTubeCheckbox(labels: string[], checked: boolean) {
  const checkbox = findDeepElement<HTMLElement>(
    '[role="checkbox"]',
    (element): element is HTMLElement => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
      const text = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.toLowerCase();
      return labels.some((label) => text.includes(label.toLowerCase()));
    },
  );
  if (!checkbox) return;
  if (isYouTubeControlChecked(checkbox) === checked) return;
  checkbox.scrollIntoView({ block: 'center', behavior: 'auto' });
  checkbox.click();
  await waitForIdle(YOUTUBE_CONTROL_SETTLE_MS);
}

function isYouTubeControlChecked(element: HTMLElement) {
  const withChecked = element as HTMLElement & { checked?: boolean };
  return withChecked.checked === true || element.getAttribute('aria-checked') === 'true' || element.hasAttribute('checked');
}

async function selectYouTubeDropdownOption(contextLabels: string[], targetText: string) {
  const trigger = findDeepElement<HTMLElement>(
    'ytcp-dropdown-trigger',
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      isVisible(element) &&
      elementHasYouTubeContext(element, contextLabels),
  );
  if (!trigger) throw new Error(`YouTube 没有找到设置项：${contextLabels[0]}`);
  if ((trigger.textContent || '').replace(/\s+/g, ' ').includes(targetText)) return;
  trigger.scrollIntoView({ block: 'center', behavior: 'auto' });
  trigger.click();
  await waitForIdle(400);
  const option = findDeepElement<HTMLElement>(
    'tp-yt-paper-item[role="option"], [role="option"]',
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      isVisible(element) &&
      (element.textContent || '').replace(/\s+/g, ' ').trim() === targetText,
  );
  if (!option) throw new Error(`YouTube ${contextLabels[0]}没有找到选项：${targetText}`);
  option.click();
  await waitForIdle(YOUTUBE_CONTROL_SETTLE_MS);
}

function elementHasYouTubeContext(element: HTMLElement, labels: string[]) {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
    const text = current.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
    if (text.length < 1_000 && labels.some((label) => text.includes(label.toLowerCase()))) return true;
  }
  return false;
}

function buildYouTubeDescription(content: ContentData) {
  const topics = content.topics
    .map((topic) => topic.trim().replace(/^#+/, ''))
    .filter(Boolean)
    .map((topic) => `#${topic}`)
    .join(' ');
  return truncate([content.description.trim(), topics].filter(Boolean).join('\n\n'), 5000);
}

function truncate(value: string, maxLength: number) {
  return Array.from(value).slice(0, maxLength).join('');
}
