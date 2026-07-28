import { cdpFillDescriptionWithTopics } from '../../content/cdp';
import { humanDelay } from '../../content/fieldFiller';
import { findDeepElement, isVisible, waitForIdle } from '../../content/dom';
import { uploadVideoIfAvailable } from '../../content/videoUploader';
import { composePublishMessage, waitForEditorReady } from '../../content/publishSteps';
import type { ContentData } from '../../types';
import type { PlatformConfig } from '../types';

const X_UPLOAD_READY_POLL_MS = 500;
const X_UPLOAD_READY_TIMEOUT_MS = 180_000;
const X_SCHEDULE_DIALOG_TIMEOUT_MS = 8_000;
const X_SCHEDULE_CONTROL_SETTLE_MS = 250;
const X_COMPOSER_SETTLE_MS = 600;
const X_POST_TEXT_VERIFY_TIMEOUT_MS = 5_000;

type XReplyAudience = 'everyone' | 'following' | 'mentioned' | 'verified';
type XScheduleField = 'year' | 'month' | 'day' | 'hour' | 'minute';

export interface XScheduleParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

/** X 使用浏览器现有登录态打开原生编辑器，自动上传并填入一条帖子文案。 */
export async function fillXContent(config: PlatformConfig, content: ContentData) {
  const uploadMessage = await uploadVideoIfAvailable(config, content);
  await waitForXVideoReady(config.upload?.timeoutMs || X_UPLOAD_READY_TIMEOUT_MS);
  await humanDelay();

  await waitForEditorReady(config);
  const replyAudience = normalizeXReplyAudience(content.platformSettings?.x?.replyAudience);
  await fillXReplyAudience(replyAudience);

  const scheduleMessage = content.scheduledAt
    ? await fillXSchedule(content.scheduledAt)
    : '';

  // X 确认安排表时会重建 Draft 编辑器。先设置所有会切换弹窗的选项，最后再用
  // 浏览器级真实输入写正文，避免仅存在于旧 DOM 的合成文本在返回编辑器后消失。
  if (content.scheduledAt) await waitForIdle(X_COMPOSER_SETTLE_MS);
  await waitForEditorReady(config);
  if (config.fields.description) {
    await fillXPostText(buildXPostText(content));
    await humanDelay();
  }

  return composePublishMessage(
    uploadMessage,
    `X 视频已等待上传就绪；回复权限：${xReplyAudienceLabel(replyAudience)}。${scheduleMessage}`,
  );
}

async function fillXPostText(postText: string) {
  const editor = findXComposerEditor();
  if (!editor) throw new Error('X 没有找到返回后的帖子正文编辑器。');

  await cdpFillDescriptionWithTopics(editor, postText, [], 0);

  const expected = normalizeXComposerText(postText);
  const startedAt = Date.now();
  while (Date.now() - startedAt < X_POST_TEXT_VERIFY_TIMEOUT_MS) {
    const currentEditor = findXComposerEditor();
    const actual = normalizeXComposerText(currentEditor?.innerText || currentEditor?.textContent || '');
    if (actual === expected) return;
    await waitForIdle(X_SCHEDULE_CONTROL_SETTLE_MS);
  }
  throw new Error('X 填充标题、正文和话题后未能在编辑器中保留完整文案，已停止发布。');
}

function findXComposerEditor() {
  return findDeepElement<HTMLElement>(
    '[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]',
    (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
  );
}

/** X 出现视频预览不代表上传完成，必须等待附件状态明确显示“就绪/Ready”。 */
async function waitForXVideoReady(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const attachments = findDeepElement<HTMLElement>(
      '[data-testid="attachments"]',
      (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
    );
    if (attachments) {
      const statusTexts = Array.from(attachments.querySelectorAll<HTMLElement>('[role="status"]'))
        .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() || '')
        .filter(Boolean);
      if (statusTexts.some((text) => /(?:^|[:：]\s*)(?:就绪|ready)\s*$/i.test(text))) return;
      const failed = statusTexts.find((text) => /上传失败|处理失败|upload failed|processing failed|error/i.test(text));
      if (failed) throw new Error(`X 视频上传失败：${failed}`);
    }
    await waitForIdle(X_UPLOAD_READY_POLL_MS);
  }
  throw new Error('X 视频已出现预览，但长时间没有进入“就绪”状态，请等待平台上传完成后重试。');
}

function normalizeXReplyAudience(value: unknown): XReplyAudience {
  return value === 'following' || value === 'mentioned' || value === 'verified' ? value : 'everyone';
}

function xReplyAudienceLabel(value: XReplyAudience) {
  const labels: Record<XReplyAudience, string> = {
    everyone: '每个人',
    following: '你关注的账号',
    mentioned: '只有你提及的账号',
    verified: '认证账号',
  };
  return labels[value];
}

/** 设置“谁可以回复”，它与帖子公开范围是两套独立设置。 */
async function fillXReplyAudience(target: XReplyAudience) {
  const editor = findXComposerEditor();
  const composer = editor?.closest<HTMLElement>('[role="dialog"]')
    || editor?.closest<HTMLElement>('[data-testid="primaryColumn"]')
    || editor?.parentElement;
  const trigger = Array.from(composer?.querySelectorAll<HTMLElement>('button, [role="button"]') || [])
    .find((element) => {
      if (!isVisible(element)) return false;
      const label = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`;
      return /可以回复|can reply/i.test(label);
    });
  if (!trigger) return;

  const currentText = `${trigger.getAttribute('aria-label') || ''} ${trigger.textContent || ''}`;
  const currentPatterns: Record<XReplyAudience, RegExp> = {
    everyone: /所有人可以回复|everyone can reply/i,
    following: /关注的账号可以回复|accounts you follow can reply/i,
    mentioned: /提及的账号可以回复|accounts you mention can reply/i,
    verified: /认证账号可以回复|verified accounts can reply/i,
  };
  if (currentPatterns[target].test(currentText)) return;

  trigger.click();
  await waitForIdle(450);

  const optionTexts: Record<XReplyAudience, string[]> = {
    everyone: ['每个人', 'Everyone'],
    following: ['你关注的账号', 'Accounts you follow'],
    mentioned: ['只有你提及的账号', 'Only accounts you mention'],
    verified: ['认证账号', 'Verified accounts'],
  };
  const option = findXReplyOption(optionTexts[target]);
  if (!option) throw new Error(`X 没有找到回复权限选项：${xReplyAudienceLabel(target)}`);
  option.click();
  await waitForIdle(500);
}

function findXReplyOption(targetTexts: string[]) {
  const popup = findDeepElement<HTMLElement>(
    '[data-testid="HoverCard"]',
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      isVisible(element) &&
      /谁可以回复|who can reply/i.test(element.textContent || ''),
  );
  if (!popup) return undefined;

  const candidates = Array.from(
    popup.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"], [role="radio"], button, [tabindex]'),
  );
  for (const candidate of candidates) {
    if (!isVisible(candidate)) continue;
    const text = candidate.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (targetTexts.some((target) => text === target || text.includes(target))) return candidate;
  }

  const descendants = Array.from(popup.querySelectorAll<HTMLElement>('span, div'));
  const label = descendants.find((element) => {
    const text = element.textContent?.replace(/\s+/g, ' ').trim() || '';
    return isVisible(element) && targetTexts.includes(text);
  });
  return label?.closest<HTMLElement>('[role="menuitem"], [role="option"], [role="radio"], button, [tabindex]')
    || label?.parentElement
    || undefined;
}

/** 打开 X 底栏“预排期帖子”入口，填写安排表并确认应用到当前帖子。 */
async function fillXSchedule(scheduledAt: number) {
  if (scheduledAt <= Date.now()) {
    throw new Error('X 定时发布时间必须晚于当前时间。');
  }
  const parts = resolveXScheduleParts(scheduledAt);
  let dialog = findXScheduleDialog();
  if (!dialog) {
    const trigger = findDeepElement<HTMLElement>(
      '[data-testid="scheduleOption"], button[aria-label="预排期帖子"], button[aria-label="Schedule post"]',
      (element): element is HTMLElement => (
        element instanceof HTMLElement
        && isVisible(element)
        && element.getAttribute('aria-disabled') !== 'true'
      ),
    );
    if (!trigger) throw new Error('X 没有找到编辑器底栏的“预排期帖子”按钮。');
    trigger.scrollIntoView({ block: 'center', behavior: 'auto' });
    trigger.click();
    dialog = await waitForXScheduleDialog();
  }

  // X 会在部分字段变更后重渲染弹窗，所以每一步都重新获取当前 select。
  const values: Array<[XScheduleField, string]> = [
    ['year', parts.year],
    ['month', parts.month],
    ['day', parts.day],
    ['hour', parts.hour],
    ['minute', parts.minute],
  ];
  for (const [field, value] of values) {
    await setXScheduleField(field, value);
  }

  dialog = findXScheduleDialog();
  const confirmButton = dialog?.querySelector<HTMLElement>('[data-testid="scheduledConfirmationPrimaryAction"]');
  if (!confirmButton || !isVisible(confirmButton) || confirmButton.getAttribute('aria-disabled') === 'true') {
    throw new Error('X 安排表已填写，但“确认”按钮当前不可用。');
  }
  confirmButton.click();

  const startedAt = Date.now();
  while (Date.now() - startedAt < X_SCHEDULE_DIALOG_TIMEOUT_MS) {
    if (!findXScheduleDialog()) {
      return `X 已设置定时发布：${formatXScheduleMessage(scheduledAt)}；`;
    }
    await waitForIdle(X_SCHEDULE_CONTROL_SETTLE_MS);
  }
  throw new Error('X 已点击安排表“确认”，但弹窗没有关闭。');
}

function findXScheduleDialog() {
  return findDeepElement<HTMLElement>(
    '[role="dialog"]',
    (element): element is HTMLElement => (
      element instanceof HTMLElement
      && isVisible(element)
      && Boolean(element.querySelector('[data-testid="scheduledConfirmationPrimaryAction"]'))
    ),
  );
}

async function waitForXScheduleDialog() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < X_SCHEDULE_DIALOG_TIMEOUT_MS) {
    const dialog = findXScheduleDialog();
    if (dialog) return dialog;
    await waitForIdle(X_SCHEDULE_CONTROL_SETTLE_MS);
  }
  throw new Error('X 已点击“预排期帖子”，但没有打开安排表。');
}

async function setXScheduleField(field: XScheduleField, value: string) {
  const dialog = await waitForXScheduleDialog();
  const select = findXScheduleSelect(dialog, field);
  if (!select) throw new Error(`X 安排表没有找到“${xScheduleFieldLabel(field)}”选择器。`);
  if (!Array.from(select.options).some((option) => option.value === value)) {
    throw new Error(`X 安排表“${xScheduleFieldLabel(field)}”不支持目标值：${value}`);
  }
  if (select.value !== value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    nativeSetter?.call(select, value);
    if (!nativeSetter) select.value = value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForIdle(X_SCHEDULE_CONTROL_SETTLE_MS);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 3_000) {
    const currentDialog = findXScheduleDialog();
    const current = currentDialog && findXScheduleSelect(currentDialog, field);
    if (current?.value === value) return;
    await waitForIdle(100);
  }
  throw new Error(`X 安排表“${xScheduleFieldLabel(field)}”没有生效：${value}`);
}

function findXScheduleSelect(dialog: HTMLElement, field: XScheduleField) {
  const patterns: Record<XScheduleField, RegExp> = {
    year: /^(?:年|年份|year)$/i,
    month: /^(?:月|月份|month)$/i,
    day: /^(?:日|日期|day)$/i,
    hour: /^(?:时|小时|hour)$/i,
    minute: /^(?:分|分钟|minute)$/i,
  };
  return Array.from(dialog.querySelectorAll<HTMLSelectElement>('select')).find((select) => {
    const label = (select.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .map((id) => select.ownerDocument.getElementById(id)?.textContent?.trim() || '')
      .filter(Boolean)
      .join(' ');
    return patterns[field].test(label);
  });
}

function xScheduleFieldLabel(field: XScheduleField) {
  const labels: Record<XScheduleField, string> = {
    year: '年',
    month: '月',
    day: '日',
    hour: '时',
    minute: '分',
  };
  return labels[field];
}

export function resolveXScheduleParts(scheduledAt: number): XScheduleParts {
  const target = new Date(scheduledAt);
  return {
    year: String(target.getFullYear()),
    month: String(target.getMonth() + 1),
    day: String(target.getDate()),
    hour: String(target.getHours()),
    minute: String(target.getMinutes()),
  };
}

function formatXScheduleMessage(scheduledAt: number) {
  const target = new Date(scheduledAt);
  const date = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
  const time = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
}

/** X 单条帖子限制为 280 个 Unicode 字符，超出时保留前 279 字并加省略号。 */
export function buildXPostText(content: ContentData) {
  const topics = content.topics
    .map((topic) => topic.trim().replace(/^#+/, ''))
    .filter(Boolean)
    .map((topic) => `#${topic}`)
    .join(' ');
  const points = Array.from([
    content.title.trim(),
    content.description.trim(),
    topics,
  ].filter(Boolean).join('\n\n'));
  return points.length <= 280 ? points.join('') : `${points.slice(0, 279).join('')}…`;
}

/** 统一 X Draft 编辑器与源文案的空白字符，供填充后的完整性校验使用。 */
export function normalizeXComposerText(value: string) {
  return value.replace(/[\u00a0\u200b]/g, ' ').replace(/\s+/g, ' ').trim();
}
