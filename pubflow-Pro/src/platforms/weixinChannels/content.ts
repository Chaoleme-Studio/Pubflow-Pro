import { loadFileForTransfer, loadVideoForTransfer } from '../../storage/videoTransferStorage';
import { humanDelay } from '../../content/fieldFiller';
import { composePublishMessage } from '../../content/publishSteps';
import { resolveContentFields } from '../shared';
import type { ContentData, RuntimeMessage } from '../../types';
import type { PlatformConfig } from '../types';

const PAGE_WORLD_UPLOAD_TIMEOUT_MS = 180000;

/** 等待视频号编辑器区域加载完成 */
async function waitForWeixinChannelsEditorReady(config: PlatformConfig, isArticle: boolean) {
  const uploadConfig = isArticle ? config.articleUpload || config.upload : config.upload;
  const selector = uploadConfig?.editorReadySelector || config.readySelector;
  const response = await browser.runtime.sendMessage({
    type: 'WAIT_WEIXIN_READY',
    payload: {
      selector,
      timeoutMs: uploadConfig?.timeoutMs || PAGE_WORLD_UPLOAD_TIMEOUT_MS,
    },
  } satisfies RuntimeMessage).catch((err: unknown) => ({ ok: false, error: String(err) })) as {
    ok: boolean;
    data?: { ok?: boolean; error?: string };
    error?: string;
  };

  if (!response?.ok || response.data?.ok === false) {
    throw new Error(response.data?.error || response?.error || `上传后没有等到可填写区域：${selector}`);
  }
}

/** 通过页面主世界批量上传图片 */
async function uploadImagesViaPageWorld(config: PlatformConfig, content: ContentData): Promise<string> {
  if (!content.imageCacheIds?.length) {
    return '未检测到可自动上传的图片缓存，跳过上传。';
  }

  const files: Array<{ fileName: string; fileType: string; fileDataBase64: string }> = [];
  for (const cacheId of content.imageCacheIds) {
    const file = await loadFileForTransfer(cacheId);
    if (!file) continue;

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    files.push({
      fileName: file.name,
      fileType: file.type,
      fileDataBase64: btoa(binary),
    });
  }

  if (files.length === 0) {
    return '图片缓存不存在，跳过自动上传。';
  }

  const uploadConfig = config.articleUpload || config.upload;
  const response = await browser.runtime.sendMessage({
    type: 'UPLOAD_IMAGES_IN_PAGE_WORLD',
    payload: {
      files,
      uploadDoneSelector: uploadConfig?.uploadDoneSelector || '',
      editorReadySelector: uploadConfig?.editorReadySelector || '',
      timeoutMs: uploadConfig?.timeoutMs || PAGE_WORLD_UPLOAD_TIMEOUT_MS,
    },
  } satisfies RuntimeMessage).catch((err: unknown) => ({
    ok: false,
    error: String(err),
  })) as { ok: boolean; data?: { ok?: boolean; error?: string; uploadedCount?: number }; error?: string };

  if (!response?.ok || response.data?.ok === false) {
    throw new Error(response.data?.error || response?.error || '页面主世界图片上传失败');
  }

  return `已上传 ${response.data?.uploadedCount || files.length} 张图片，继续填写文本。`;
}

/** 通过页面主世界上传视频文件 */
async function uploadVideoViaPageWorld(config: PlatformConfig, file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  const response = await browser.runtime.sendMessage({
    type: 'UPLOAD_FILE_IN_PAGE_WORLD',
    payload: {
      fileName: file.name,
      fileType: file.type,
      fileDataBase64: base64,
      acceptSelector: config.upload?.fileInputSelector?.[0] || '',
      uploadDoneSelector: config.upload?.uploadDoneSelector || '',
      editorReadySelector: config.upload?.editorReadySelector || '',
      timeoutMs: config.upload?.timeoutMs || PAGE_WORLD_UPLOAD_TIMEOUT_MS,
    },
  } satisfies RuntimeMessage).catch((err: unknown) => ({
    ok: false,
    error: String(err),
  })) as { ok: boolean; data?: { ok?: boolean; error?: string }; error?: string };

  if (!response?.ok || response.data?.ok === false) {
    throw new Error(response.data?.error || response?.error || '页面主世界视频上传失败');
  }

  return '视频已通过页面脚本上传，继续填写文本。';
}

/** 通过页面主世界填充编辑器内容（标题、话题、描述） */
async function fillWeixinChannelsEditor(content: ContentData, skipTitle = false) {
  const hasText = Boolean(content.title || content.description || content.topics.length > 0);
  if (!hasText) return;

  const response = await browser.runtime.sendMessage({
    type: 'EXECUTE_IN_PAGE_WORLD',
    payload: {
      title: content.title || '',
      topics: content.topics || [],
      description: content.description || '',
      skipTitle,
    },
  } satisfies RuntimeMessage).catch((err: unknown) => ({ ok: false, error: String(err) })) as {
    ok: boolean;
    data?: { ok?: boolean; error?: string };
    error?: string;
  };

  if (!response?.ok || response.data?.ok === false) {
    throw new Error(response.data?.error || response?.error || '页面脚本填充失败');
  }
}

/** 通过页面主世界填充图文标题 */
async function fillWeixinChannelsArticleTitle(content: ContentData) {
  if (!content.title) return;

  const response = await browser.runtime.sendMessage({
    type: 'FILL_WEIXIN_ARTICLE_TITLE',
    payload: {
      title: content.title,
    },
  } satisfies RuntimeMessage).catch((err: unknown) => ({ ok: false, error: String(err) })) as {
    ok: boolean;
    data?: { ok?: boolean; error?: string };
    error?: string;
  };

  if (!response?.ok || response.data?.ok === false) {
    throw new Error(response.data?.error || response?.error || '页面脚本图文标题填充失败');
  }
}

/** 通过页面主世界填充视频号短标题 */
async function fillWeixinChannelsShortTitle(content: ContentData) {
  if (!content.title) return;

  const response = await browser.runtime.sendMessage({
    type: 'FILL_WEIXIN_SHORT_TITLE',
    payload: {
      title: content.title,
    },
  } satisfies RuntimeMessage).catch((err: unknown) => ({ ok: false, error: String(err) })) as {
    ok: boolean;
    data?: { ok?: boolean; error?: string };
    error?: string;
  };

  if (!response?.ok || response.data?.ok === false) {
    throw new Error(response.data?.error || response?.error || '视频号短标题填充失败');
  }
}

/** 通过页面主世界处理定时发布设置 */
async function fillWeixinChannelsScheduled(scheduledAt: number) {
  const response = await browser.runtime.sendMessage({
    type: 'HANDLE_WEIXIN_SCHEDULE',
    payload: { scheduledAt },
  } satisfies RuntimeMessage).catch((err: unknown) => ({ ok: false, error: String(err) })) as {
    ok: boolean;
    data?: { ok?: boolean; error?: string };
    error?: string;
  };
  if (!response?.ok || response.data?.ok === false) {
    throw new Error(response.data?.error || response?.error || '视频号定时发布处理失败');
  }
  await humanDelay(1500);
}

/** 通过页面主世界处理原创声明弹窗 */
async function fillWeixinChannelsOriginalDeclare() {
  const response = await browser.runtime.sendMessage({
    type: 'HANDLE_WEIXIN_DECLARE_POPUP',
  } satisfies RuntimeMessage).catch((err: unknown) => ({ ok: false, error: String(err) })) as {
    ok: boolean;
    data?: { ok?: boolean; error?: string };
    error?: string;
  };
  if (!response?.ok || response.data?.ok === false) {
    throw new Error(response.data?.error || response?.error || '视频号原创声明处理失败');
  }
  await humanDelay(1500);
}

/** 通过页面主世界上传封面图片 */
async function uploadCoverViaPageWorld(config: PlatformConfig, file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  const response = await browser.runtime.sendMessage({
    type: 'UPLOAD_COVER_IN_PAGE_WORLD',
    payload: {
      fileName: file.name,
      fileType: file.type,
      fileDataBase64: base64,
      coverSelector: '',
    },
  } satisfies RuntimeMessage).catch((err: unknown) => ({
    ok: false,
    error: String(err),
  })) as { ok: boolean; data?: { ok?: boolean; error?: string }; error?: string };

  if (!response?.ok || response.data?.ok === false) {
    throw new Error(response.data?.error || response?.error || '页面主世界封面上传失败');
  }

  return '封面已通过页面脚本上传（个人主页卡片 3:4 + 分享卡片 4:3）。';
}

/** 填充视频号内容主流程：上传媒体、填充字段、处理定时与原创声明 */
export async function fillWeixinChannelsContent(config: PlatformConfig, content: ContentData, isArticle: boolean = false) {
  let uploadMessage = '';
  const isImagePost = content.contentType === 'image' || isArticle;

  // 根据是否是图文选择不同的上传逻辑
  if (isImagePost && content.imageCacheIds?.length) {
    // 图文上传
    uploadMessage = await uploadImagesViaPageWorld(config, content);
    await humanDelay();
  } else if (content.videoCacheId) {
    // 视频上传
    const file = await loadVideoForTransfer(content.videoCacheId);
    if (!file) {
      throw new Error('视频缓存不存在，跳过自动上传。');
    }
    uploadMessage = await uploadVideoViaPageWorld(config, file);
    await humanDelay();
  }

  // 根据是否是图文选择不同的字段配置
  const fields = resolveContentFields(config, content.contentType, isArticle);

  await waitForWeixinChannelsEditorReady(config, isImagePost);

  if (isImagePost) {
    // 图文模式：标题是独立的 input，描述在 div.input-editor
    await fillWeixinChannelsArticleTitle(content);
    await humanDelay();
    await fillWeixinChannelsEditor(content, true);
  } else {
    // 视频模式：标题和描述都在 div.input-editor，短标题是独立 input
    await fillWeixinChannelsEditor(content);
    await fillWeixinChannelsShortTitle(content);
  }

  // 图文不需要上传封面（从已上传图片中选择）
  let coverMessage = '';
  if (!isImagePost && content.coverCacheId && config.fields.cover) {
    const coverFile = await loadFileForTransfer(content.coverCacheId);
    if (coverFile) {
      try {
        coverMessage = await uploadCoverViaPageWorld(config, coverFile);
      } catch (error) {
        coverMessage = error instanceof Error ? error.message : '封面上传失败';
      }
      await humanDelay();
    }
  }

  if (fields.scheduled && content.scheduledAt) {
    await fillWeixinChannelsScheduled(content.scheduledAt);
  }

  if (fields.originalDeclare && content.originalDeclare) {
    await fillWeixinChannelsOriginalDeclare();
  }

  return composePublishMessage(uploadMessage, coverMessage);
}
