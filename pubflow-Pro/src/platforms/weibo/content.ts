import { fillField, humanDelay } from '../../content/fieldFiller';
import { uploadVideoIfAvailable } from '../../content/videoUploader';
import { fillArticleBody } from '../../content/articleBodyFiller';
import {
  composePublishMessage,
  fillOriginalDeclare,
  fillPlatformSettings,
  fillScheduled,
  fillVisibility,
  waitForArticleEditorReady,
  waitForEditorReady,
  waitForImageEditorReady,
} from '../../content/publishSteps';
import { resolveContentFields } from '../shared';
import type { ContentData } from '../../types';
import type { PlatformConfig } from '../types';

/**
 * 微博「内容声明」专用填充逻辑。
 *
 * 微博的声明区有三种状态：
 * 1. 初始态：_compactTrigger 内显示 "请进行内容声明（必填）"，无按钮。
 * 2. 展开态：_panel 内有完整按钮组（"内容无需标注"、"内容为转载" 等）。
 * 3. 确认态：_compactTrigger 内显示已选文本，无按钮。
 *
 * 无论当前处于哪种状态，都先点击 _compactTrigger 展开面板，
 * 再选中目标按钮，最后点击「确定」确认。
 */
/** 填充微博的“内容声明”选项。 */
async function fillWeiboDeclaration(targetText: string) {
  console.info('[PubFlow][weibo] fillWeiboDeclaration start', { targetText });

  // 1. 点击 _compactTrigger 展开面板（初始态 / 确认态 → 展开态）
  const trigger = findWeiboDeclarationTrigger();
  console.info('[PubFlow][weibo] compactTrigger', {
    found: !!trigger,
    visible: trigger?.offsetParent !== null,
    text: trigger?.textContent?.trim(),
  });
  if (trigger && trigger.offsetParent !== null) {
    trigger.click();
    await humanDelay(400, 600);
  }

  // 2. 等待面板出现，找到目标按钮并点击
  let targetBtn: HTMLElement | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const buttons = findWeiboDeclarationOptionButtons();
    console.info('[PubFlow][weibo] looking for option buttons', {
      attempt,
      count: buttons.length,
    });
    for (const btn of buttons) {
      const text = btn.textContent?.replace(/\s+/g, '') || '';
      if ((text === targetText || text.includes(targetText)) && btn.offsetParent !== null) {
        targetBtn = btn;
        break;
      }
    }
    if (targetBtn) break;
    await humanDelay(300, 500);
  }
  if (!targetBtn) {
    console.warn('[PubFlow][weibo] target button not found, aborting');
    return;
  }

  console.info('[PubFlow][weibo] clicking target button');
  targetBtn.click();
  await humanDelay(300, 500);

  // 3. 点击「确定」确认（带重试，防 Vue 重渲染导致短暂找不到）
  for (let attempt = 0; attempt < 5; attempt++) {
    const confirmButton = findWeiboDeclarationConfirmButton();
    if (confirmButton) {
      console.info('[PubFlow][weibo] clicking confirm button');
      confirmButton.click();
      return;
    }
    console.info('[PubFlow][weibo] confirm button not found, retrying', { attempt });
    await humanDelay(200, 400);
  }
  console.warn('[PubFlow][weibo] confirm button not found after retries');
}

/** 查找微博内容声明的触发元素（_compactTrigger）。 */
function findWeiboDeclarationTrigger(): HTMLElement | null {
  const compactTrigger = document.querySelector<HTMLElement>('[class*="compactTrigger"]');
  if (compactTrigger?.offsetParent !== null) return compactTrigger;

  const candidates = queryWeiboClickableElements(
    '[class*="compactTrigger"], [class*="declaration"], [class*="Declaration"], [class*="statement"], [class*="Statement"], button, [role="button"]',
  );
  for (const candidate of candidates) {
    const text = candidate.textContent?.replace(/\s+/g, '') || '';
    if (
      candidate.offsetParent !== null &&
      (text.includes('请进行内容声明') ||
        text.includes('内容声明') ||
        text.includes('无需标注') ||
        text.includes('内容为转载') ||
        text.includes('AI生成'))
    ) {
      return candidate;
    }
  }
  return null;
}

/** 查找微博内容声明的展开面板元素。 */
function findWeiboDeclarationPanel(): HTMLElement | Document {
  const panels = queryWeiboClickableElements(
    '[class*="panel"], [class*="Panel"], [class*="popover"], [class*="Popover"], [class*="modal"], [class*="Modal"]',
  );
  for (const panel of panels) {
    const text = panel.textContent?.replace(/\s+/g, '') || '';
    if (panel.offsetParent !== null && (text.includes('内容无需标注') || text.includes('内容为转载'))) {
      return panel;
    }
  }
  return document;
}

/** 查找微博内容声明面板内的选项按钮列表。 */
function findWeiboDeclarationOptionButtons(): HTMLElement[] {
  const panel = findWeiboDeclarationPanel();
  const legacyButtons = Array.from(
    panel.querySelectorAll<HTMLElement>('button[class*="_option_6opfe_"]'),
  ).filter((button) => button.offsetParent !== null);
  if (legacyButtons.length > 0) return legacyButtons;

  return Array.from(
    queryWeiboClickableElements(
      'button, [role="button"], [class*="option"], [class*="Option"], [class*="woo-box-flex"]',
      panel,
    ),
  ).filter((candidate) => {
    const text = candidate.textContent?.replace(/\s+/g, '') || '';
    return candidate.offsetParent !== null && (
      text.includes('内容无需标注') ||
      text.includes('内容为转载') ||
      text.includes('含AI生成内容') ||
      text.includes('含虚构演绎内容') ||
      text.includes('个人观点') ||
      text.includes('营销信息') ||
      text.includes('内容疑似由AI生成') ||
      text.includes('内容由AI生成')
    );
  });
}

/** 查找微博内容声明面板内的「确定」确认按钮。 */
function findWeiboDeclarationConfirmButton(): HTMLElement | null {
  const panel = findWeiboDeclarationPanel();
  const buttons = queryWeiboClickableElements('button, [role="button"]', panel);
  for (const button of buttons) {
    const text = button.textContent?.trim() || '';
    if ((text === '确定' || text === '确认') && button.offsetParent !== null && !button.hasAttribute('disabled')) {
      return button;
    }
  }
  return null;
}

/** 在指定根节点下查询所有可点击的 HTMLElement 元素。 */
function queryWeiboClickableElements(selector: string, root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll(selector))
    .filter((element): element is HTMLElement => element instanceof HTMLElement && typeof element.click === 'function');
}

/** 根据内容类型填充微博发布内容（图文、视频或文章）。 */
export async function fillWeiboContent(config: PlatformConfig, content: ContentData, isArticle: boolean = false) {
  let uploadMessage = '';
  let articleBodyMessage = '';
  const isImagePost = content.contentType === 'image';

  if (isImagePost && content.imageCacheIds?.length) {
    // 文章模式：上传图片
    const { uploadImagesIfAvailable } = await import('../../content/imageUploader');
    uploadMessage = await uploadImagesIfAvailable(config, content);
    await humanDelay();
  } else if (!isArticle && content.videoCacheId) {
    uploadMessage = await uploadVideoIfAvailable(config, content);
    await humanDelay();
  }

  // 根据是否是文章选择不同的字段配置
  const fields = resolveContentFields(config, content.contentType, isArticle);

  if (isArticle) {
    await waitForArticleEditorReady(config);
  } else if (isImagePost) {
    await waitForImageEditorReady(config);
  } else {
    await waitForEditorReady(config);
  }

  if (fields.title && content.title) {
    await fillField(fields.title, content.title);
    await humanDelay();
  }

  // 文章模式：填充文章正文
  console.info('[PubFlow][weibo] article body check', {
    isArticle,
    hasArticleContent: Boolean(content.articleContent),
    hasArticleBodyField: Boolean(fields.articleBody),
    articleBodySelectors: fields.articleBody?.selectors,
  });
  if (isArticle && content.articleContent && fields.articleBody) {
    articleBodyMessage = await fillArticleBody(fields.articleBody, content.articleContent);
    await humanDelay();
  } else if (fields.description && content.description) {
    await fillField(fields.description, content.description);
    await humanDelay();
  }

  // 微博不支持单独上传封面，视频前几帧即为封面

  if (fields.visibility && content.visibility) {
    await fillVisibility(config, content.visibility);
    await humanDelay();
  }

  if (fields.scheduled && content.scheduledAt) {
    await fillScheduled(config, content.scheduledAt);
    await humanDelay();
  }

  if (fields.originalDeclare && content.originalDeclare) {
    await fillOriginalDeclare(config);
    await humanDelay();
  }

  console.info('[PubFlow][weibo] declaration check', {
    hasDeclaration: !!fields.declaration,
    config: fields.declaration,
  });
  if (fields.declaration) {
    const targetText = fields.declaration.选项文本 || '内容无需标注';
    console.info('[PubFlow][weibo] calling fillWeiboDeclaration', { targetText });
    await fillWeiboDeclaration(targetText);
    await humanDelay();
  }

  await fillPlatformSettings(config, content.platformSettings?.[config.id] ?? {});
  await humanDelay();

  return composePublishMessage(uploadMessage, '', articleBodyMessage);
}
