import type { BlockerConfig, FieldConfig, FillMethod, PlatformConfig, PlatformSelectorConfig } from './types';

export const commonBlockers: BlockerConfig[] = [
  {
    selectors: [
      'input[type="password"]',
      'button[class*="login"]',
      '[class*="login"] input',
      '[class*="Login"] input',
      '.qrcode-wrap',
      'img.qrcode',
      'iframe[src*="login-for-iframe"]',
      '[class*="login"] [class*="qrcode"]',
      '[class*="Login"] [class*="qrcode"]',
    ],
    message: '检测到登录或登录失效，请先完成登录。',
  },
  {
    selectors: [
      '[role="dialog"]',
      '.semi-modal',
      '.semi-modal-content',
      '.ant-modal',
      '.ant-modal-content',
      '.el-dialog',
      '.el-overlay-dialog',
      '[class*="modal"]',
      '[class*="Modal"]',
      '[class*="dialog"]',
      '[class*="Dialog"]',
    ],
    message: '检测到弹窗/确认框，请先手动处理后再继续填充。',
  },
];

/** 将旧的单 selector 配置转换成运行时字段配置，保留填充方式和多值策略。 */
function fieldFromSelector(
  selector: string | undefined,
  fillMethod: FillMethod,
  multiValue?: FieldConfig['multiValue'],
): FieldConfig | undefined {
  if (!selector) return undefined;
  return { selectors: [selector], fillMethod, ...(multiValue ? { multiValue } : {}) };
}

/**
 * 将平台 selector 配置中的中文字段映射到运行时字段结构。
 * 如果“简介”和“文章正文”指向同一个编辑器，说明该平台文章页复用正文，不再生成 description。
 */
function buildFieldsFromSelectorConfig(raw: PlatformSelectorConfig['字段']): PlatformConfig['fields'] {
  const descSelector = raw.简介;
  const bodySelector = raw.文章正文;
  const skipDesc = descSelector && bodySelector && descSelector === bodySelector;
  return {
    title: fieldFromSelector(raw.标题, raw.标题填充方式 || 'pasteLike'),
    description: skipDesc ? undefined : fieldFromSelector(descSelector, 'contentEditable'),
    topics: fieldFromSelector(raw.话题, 'simulateTyping', {
      prefix: '#',
      confirmKey: 'Enter',
      delayMs: 420,
    }),
    cover: raw.封面 ? { selectors: [raw.封面] } : undefined,
    declaration: raw.声明,
    category: raw.分类,
    tags: fieldFromSelector(raw.标签, 'simulateTyping', {
      prefix: '',
      confirmKey: 'Enter',
      delayMs: 420,
    }),
    visibility: raw.谁可以看,
    scheduled: raw.定时发布,
    originalDeclare: raw.原创声明,
    articleBody: fieldFromSelector(raw.文章正文, 'contentEditable'),
  };
}

/** 将 selectors.ts 里的平台原始配置构造成 content/background 可直接消费的 PlatformConfig。 */
export function buildPlatformConfig(raw: PlatformSelectorConfig): PlatformConfig {
  const config: PlatformConfig = {
    id: raw.平台标识,
    name: raw.名称,
    icon: raw.图标,
    supportedContentTypes: raw.支持内容类型,
    editorUrl: raw.发布页地址,
    articleEditorUrl: raw.图文发布页地址,
    articlePageUrl: raw.文章发布页地址,
    articleEntryButton: raw.文章入口按钮,
    matchHosts: raw.匹配域名,
    readySelector: raw.就绪选择器,
    articleReadySelector: raw.文章就绪选择器,
    upload: {
      uploadContainerSelector: raw.上传.上传容器,
      dropContainerSelector: raw.上传.拖拽容器,
      uploadButtonSelector: raw.上传.上传按钮,
      fileInputSelector: raw.上传.文件输入框,
      uploadDoneSelector: raw.上传.上传完成标记,
      editorReadySelector: raw.上传.编辑器就绪标记,
      timeoutMs: raw.上传.超时毫秒,
      requiresActiveTab: raw.上传.需要激活标签页,
    },
    blockers: commonBlockers,
    fields: buildFieldsFromSelectorConfig(raw.字段),
  };

  // 添加图文上传配置
  if (raw.图文上传) {
    config.articleUpload = {
      uploadContainerSelector: raw.图文上传.上传容器,
      dropContainerSelector: raw.图文上传.拖拽容器,
      uploadButtonSelector: raw.图文上传.上传按钮,
      fileInputSelector: raw.图文上传.文件输入框,
      uploadDoneSelector: raw.图文上传.上传完成标记,
      editorReadySelector: raw.图文上传.编辑器就绪标记,
      timeoutMs: raw.图文上传.超时毫秒,
      requiresActiveTab: raw.图文上传.需要激活标签页,
    };
  }

  if (raw.图文字段) {
    config.imageFields = buildFieldsFromSelectorConfig(raw.图文字段);
  }

  if (raw.文章字段) {
    config.articleFields = buildFieldsFromSelectorConfig(raw.文章字段);
  } else if (raw.图文字段) {
    config.articleFields = config.imageFields;
  }

  return config;
}

/** 按内容类型解析字段配置，避免图文误用文章字段、文章误用视频字段。 */
export function resolveContentFields(config: PlatformConfig, contentType: 'video' | 'image' | 'article' | undefined, isArticle: boolean) {
  // 字段配置按内容类型分三层：
  // - fields：视频发布页默认字段。
  // - imageFields：图文发布页字段。
  // - articleFields：长文章/专栏编辑器字段。
  //
  // 注意：content script 的 isArticleEditorContext 会把 image 也视作“文章型上下文”，
  // 但图文和长文章字段不一定相同，所以这里必须先按 contentType === 'image' 分流。
  if (contentType === 'image') return config.imageFields || config.articleFields || config.fields;
  if (isArticle) return config.articleFields || config.imageFields || config.fields;
  return config.fields;
}
