import type { PlatformId } from '../types';
import type { ContentType } from '../types';

export type PlatformSelectorKey =
  | '抖音'
  | '小红书'
  | '视频号'
  | 'B站'
  | '快手'
  | '微博'
  | '知乎'
  | '西瓜视频'
  | 'X'
  | 'YouTube';

/**
 * 平台上传区选择器配置。
 * 这里是“原始平台配置层”，直接给 selectors.ts 使用，允许用中文键维护。
 */
export interface PlatformUploadSelectorConfig {
  /** 上传容器本身，用来判断上传区是否已渲染。 */
  上传容器: string;
  /** 某些平台实际由拖拽区接收文件，这里保留拖拽容器。 */
  拖拽容器?: string[];
  /** 某些平台需要先点一下“上传按钮”才会出现 input。 */
  上传按钮?: string[];
  /** 真正接收视频文件的 input[type=file] 选择器。 */
  文件输入框: string[];
  /** 上传完成后页面上应该能命中的元素。 */
  上传完成标记: string;
  /** 上传完成后，文本编辑区已经可填写时应命中的元素。 */
  编辑器就绪标记: string;
  /** 等待上传完成/编辑区就绪的超时时间，单位毫秒。 */
  超时毫秒?: number;
  /** 某些平台上传时必须保持当前激活标签页。 */
  需要激活标签页?: boolean;
}

export interface DeclarationSelectorConfig {
  /** 声明/授权入口。 */
  触发器: string;
  /** 交互类型：下拉、开关、复选框、切换。 */
  类型: 'dropdown' | 'toggle' | 'checkbox' | 'switch' | 'button';
  /** 下拉项选择器。 */
  选项选择器?: string;
  /** 需要匹配的选项文案。 */
  选项文本?: string;
}

export interface CategorySelectorConfig {
  /** 分类触发器。 */
  触发器: string;
  /** 有些平台分类来自接口，这里保留接口地址。 */
  接口地址?: string;
}

export interface VisibilitySelectorConfig {
  /** 谁可以看触发器。 */
  触发器: string;
  /** 交互类型：radio、dropdown。 */
  类型: 'radio' | 'dropdown';
  /** 选项值选择器。 */
  选项选择器?: string;
}

export interface ScheduledSelectorConfig {
  /** 定时发布触发器。 */
  触发器: string;
  /** 交互类型：radio、switch、checkbox。 */
  类型: 'radio' | 'switch' | 'checkbox';
  /** 时间输入框选择器。 */
  时间输入?: string;
  /** 日期输入框选择器。 */
  日期输入?: string;
}

/**
 * 文本/封面等字段的页面选择器配置。
 */
export interface PlatformFieldSelectorConfig {
  /** 标题输入区。 */
  标题: string;
  /** 标题填充方式覆盖（默认 pasteLike）。 */
  标题填充方式?: FillMethod;
  /** 简介/正文输入区。 */
  简介: string;
  /** 文章正文编辑区（contenteditable，用于文章模式的 HTML 注入）。 */
  文章正文?: string;
  /** 话题输入区。 */
  话题?: string;
  /** 封面入口或封面区域。 */
  封面?: string;
  /** 发布前声明配置。 */
  声明?: DeclarationSelectorConfig;
  /** 分类配置。 */
  分类?: CategorySelectorConfig;
  /** 标签输入区。 */
  标签?: string;
  /** 谁可以看配置。 */
  谁可以看?: VisibilitySelectorConfig;
  /** 定时发布配置。 */
  定时发布?: ScheduledSelectorConfig;
  /** 原创声明配置。 */
  原创声明?: DeclarationSelectorConfig;
}

/**
 * 单个平台的原始选择器配置。
 * selectors.ts 里写的就是这个结构。
 */
export interface PlatformSelectorConfig {
  平台标识: PlatformId;
  名称: string;
  图标: string;
  启用?: boolean;
  /** 明确声明平台支持的内容类型。未配置时按页面/字段配置自动推断。 */
  支持内容类型?: ContentType[];
  /** 平台发布页地址。 */
  发布页地址: string;
  /** 图文发布页地址（可选）。 */
  图文发布页地址?: string;
  /** 文章发布页地址（可选）。 */
  文章发布页地址?: string;
  /** 文章入口按钮选择器（某些平台需要先点击按钮才能进入文章编辑器）。 */
  文章入口按钮?: string;
  /** 当前平台允许命中的 host 列表。 */
  匹配域名: string[];
  /** 页面整体可操作时应命中的元素。 */
  就绪选择器: string;
  /** X/YouTube 的编辑器本身是 dialog，关闭通用弹窗阻断后由平台流程自行判断。 */
  检测通用弹窗?: boolean;
  上传: PlatformUploadSelectorConfig;
  字段: PlatformFieldSelectorConfig;
  /** 图文上传配置（可选）。 */
  图文上传?: PlatformUploadSelectorConfig;
  /** 图文字段配置（可选）。 */
  图文字段?: PlatformFieldSelectorConfig;
  /** 文章字段配置（可选，用于长文章编辑器，优先级高于图文字段）。 */
  文章字段?: PlatformFieldSelectorConfig;
  /** 文章页面就绪选择器（可选，文章编辑器 DOM 结构与视频页不同时使用）。 */
  文章就绪选择器?: string;
}

export type FillMethod = 'pasteLike' | 'inputValue' | 'contentEditable' | 'simulateTyping';

export interface FieldConfig {
  selectors: string[];
  fillMethod: FillMethod;
  events?: Array<'beforeinput' | 'input' | 'change' | 'blur' | 'keydown' | 'paste'>;
  multiValue?: {
    prefix?: string;
    confirmKey?: string;
    delayMs?: number;
  };
}

export interface BlockerConfig {
  selectors: string[];
  message: string;
}

export interface UploadConfig {
  /** 上传容器选择器，用来等待平台上传区真正渲染完成。 */
  uploadContainerSelector?: string;
  /** 拖拽上传容器，用于在 change 事件不生效时兜底。 */
  dropContainerSelector?: string[];
  /** 上传按钮选择器。 */
  uploadButtonSelector?: string[];
  /** 文件 input 选择器。 */
  fileInputSelector: string[];
  /** 上传完成标记。 */
  uploadDoneSelector?: string;
  /** 编辑区就绪标记。 */
  editorReadySelector?: string;
  timeoutMs?: number;
  requiresActiveTab?: boolean;
}

export interface PlatformConfig {
  id: PlatformId;
  name: string;
  icon: string;
  supportedContentTypes?: ContentType[];
  editorUrl: string;
  articleEditorUrl?: string;
  articlePageUrl?: string;
  /** 文章入口按钮选择器（某些平台需要先点击按钮才能进入文章编辑器）。 */
  articleEntryButton?: string;
  matchHosts: string[];
  readySelector: string;
  /** 文章页面就绪选择器（文章编辑器 DOM 结构与视频页不同时使用）。 */
  articleReadySelector?: string;
  upload?: UploadConfig;
  articleUpload?: UploadConfig;
  blockers: BlockerConfig[];
  fields: {
    title?: FieldConfig;
    description?: FieldConfig;
    topics?: FieldConfig;
    cover?: { selectors: string[] };
    declaration?: DeclarationSelectorConfig;
    category?: CategorySelectorConfig;
    tags?: FieldConfig;
    visibility?: VisibilitySelectorConfig;
    scheduled?: ScheduledSelectorConfig;
    originalDeclare?: DeclarationSelectorConfig;
    /** 文章正文编辑区（contenteditable，用于 HTML 注入）。 */
    articleBody?: FieldConfig;
  };
  imageFields?: {
    title?: FieldConfig;
    description?: FieldConfig;
    topics?: FieldConfig;
    cover?: { selectors: string[] };
    declaration?: DeclarationSelectorConfig;
    category?: CategorySelectorConfig;
    tags?: FieldConfig;
    visibility?: VisibilitySelectorConfig;
    scheduled?: ScheduledSelectorConfig;
    originalDeclare?: DeclarationSelectorConfig;
    /** 图文正文编辑区。多数平台图文没有独立文章正文，这里保留兼容。 */
    articleBody?: FieldConfig;
  };
  articleFields?: {
    title?: FieldConfig;
    description?: FieldConfig;
    topics?: FieldConfig;
    cover?: { selectors: string[] };
    declaration?: DeclarationSelectorConfig;
    category?: CategorySelectorConfig;
    tags?: FieldConfig;
    visibility?: VisibilitySelectorConfig;
    scheduled?: ScheduledSelectorConfig;
    originalDeclare?: DeclarationSelectorConfig;
    /** 文章正文编辑区（contenteditable，用于 HTML 注入）。 */
    articleBody?: FieldConfig;
  };
}

export interface PlatformCampaign {
  标识: string;
  平台标识: PlatformId;
  标题: string;
  简称: string;
  类型: 'activityCenter' | 'growth' | 'monetization' | 'brand' | 'training';
  简介: string;
  参与提示: string;
  官方链接: string;
  标签: string[];
  关键词: string[];
  长期有效: boolean;
}

export interface CampaignRecommendation {
  活动: PlatformCampaign;
  得分: number;
  推荐理由: string[];
}
