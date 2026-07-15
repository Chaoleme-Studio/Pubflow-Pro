import { fillField, humanDelay } from '../../content/fieldFiller';
import { findDeepElement, isVisible, waitForIdle } from '../../content/dom';
import { uploadVideoIfAvailable } from '../../content/videoUploader';
import { composePublishMessage, waitForEditorReady } from '../../content/publishSteps';
import type { ContentData } from '../../types';
import type { PlatformConfig } from '../types';

const X_UPLOAD_READY_POLL_MS = 500;
const X_UPLOAD_READY_TIMEOUT_MS = 180_000;

type XReplyAudience = 'everyone' | 'following' | 'mentioned' | 'verified';

/** X 使用浏览器现有登录态打开原生编辑器，自动上传并填入一条帖子文案。 */
export async function fillXContent(config: PlatformConfig, content: ContentData) {
  let uploadMessage = '';
  if (content.videoCacheId) {
    uploadMessage = await uploadVideoIfAvailable(config, content);
    await waitForXVideoReady(config.upload?.timeoutMs || X_UPLOAD_READY_TIMEOUT_MS);
    await humanDelay();
  }

  await waitForEditorReady(config);
  if (config.fields.description) {
    await fillField(config.fields.description, buildXPostText(content));
    await humanDelay();
  }

  const replyAudience = normalizeXReplyAudience(content.platformSettings?.x?.replyAudience);
  await fillXReplyAudience(replyAudience);

  return composePublishMessage(uploadMessage, `X 视频已等待上传就绪；回复权限：${xReplyAudienceLabel(replyAudience)}。`);
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
  const editor = findDeepElement<HTMLElement>(
    '[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]',
    (element): element is HTMLElement => element instanceof HTMLElement && isVisible(element),
  );
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
