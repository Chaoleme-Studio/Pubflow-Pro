/** PubFlow 支持的平台标识，贯穿选择器配置、任务状态、素材库记录和平台个性化设置。 */
export type PlatformId =
  | 'douyin'
  | 'xiaohongshu'
  | 'weixinChannels'
  | 'bilibili'
  | 'kuaishou'
  | 'weibo'
  | 'zhihu'
  | 'xigua'
  | 'x'
  | 'youtube';

/** 单个平台在一次分发任务中的状态。 */
export type PlatformTaskStatus =
  | 'pending'
  | 'opening'
  | 'waitingUser'
  | 'ready'
  | 'filling'
  | 'publishing'
  | 'filled'
  | 'published'
  | 'skipped'
  | 'error';

export type Visibility = 'public' | 'friends' | 'private';
/** 内容类型：video 是短视频，image 是多图图文，article 是长文章/专栏。 */
export type ContentType = 'video' | 'image' | 'article';

/** 平台个性化设置容器，key 使用 PlatformId，value 由各平台处理器自行解释。 */
export interface PlatformSpecificSettings {
  [platformId: string]: Record<string, unknown>;
}

/**
 * 三类内容共用的基础内容模型。
 * 视频、图文、文章共享标题、描述、封面、定时、可见性等字段；具体是否使用由平台能力和 contentType 决定。
 */
export interface BaseContent {
  contentType?: ContentType;
  title: string;
  description: string;
  articleContent?: string;
  projectId?: string;
  videoCacheId?: string;
  coverCacheId?: string;
  imageCacheIds?: string[];
  videoFileName?: string;
  coverFileName?: string;
  musicFileName?: string;
  musicName?: string;
  imageFileNames?: string[];
  videoSize?: number;
  coverSize?: number;
  musicSize?: number;
  scheduledAt?: number;
  visibility?: Visibility;
  originalDeclare?: boolean;
  platformSettings?: PlatformSpecificSettings;
}

export interface ContentFillOptions {
  /** 输入 #话题 后及按 Enter 确认后的步骤间隔。 */
  topicIntervalMs?: number;
}

/** 运行时分发使用的内容数据，topics/campaignIds 已经被解析成数组。 */
export interface ContentData extends BaseContent {
  topics: string[];
  campaignIds: string[];
  fillOptions?: ContentFillOptions;
}

/** Dashboard 草稿结构，保留文本输入态和用户勾选的平台/活动。 */
export interface ContentDraft extends BaseContent {
  topicsText: string;
  selectedPlatforms: PlatformId[];
  selectedCampaignIds: string[];
  sourceVideoId?: string;
  /** 当前项目是可被后续“复刻”覆盖的草稿时，记录最近一次源项目身份。 */
  replicaSourceProjectId?: string;
}

/** 当前任务中某个平台的执行状态和对应 tab/frame。 */
export interface PlatformTask {
  platformId: PlatformId;
  tabId?: number;
  frameId?: number;
  status: PlatformTaskStatus;
  message?: string;
  error?: string;
  publishedUrl?: string;
}

/** 一次多平台分发任务，background 按 platforms 顺序打开页面并推进状态。 */
export interface DistributionTask {
  id: string;
  videoId?: string;
  content: ContentData;
  platforms: PlatformTask[];
  currentIndex: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  createdAt: number;
  permitId?: string;
  /** 填充完成后是否直接点击平台最终发布按钮。 */
  autoSubmit?: boolean;
  /** 任务来源及本地 Agent 幂等关联信息。 */
  source?: 'dashboard' | 'agent';
  externalTaskSource?: 'native' | 'cloud';
  externalJobId?: string;
  projectId?: string;
  statusSequence?: number;
  error?: string;
}

export type PublishedPlatformStatus = Extract<
  PlatformTaskStatus,
  'pending' | 'filling' | 'filled' | 'published' | 'skipped' | 'error'
>;

/** 素材库中某个平台的发布状态快照。 */
export interface PlatformStatus {
  platformId: PlatformId;
  status: PublishedPlatformStatus;
  publishedUrl?: string;
  publishedAt?: number;
  error?: string;
}

/**
 * 素材库中的一条内容记录。
 * 历史命名叫 VideoRecord，但现在同时承载视频、图文和文章，contentType 用来区分。
 */
export interface VideoRecord {
  contentType?: ContentType;
  id: string;
  title: string;
  description: string;
  topics: string[];
  campaignIds: string[];
  projectId: string;
  videoCacheId?: string;
  coverCacheId?: string;
  imageCacheIds?: string[];
  videoFileName?: string;
  coverFileName?: string;
  musicFileName?: string;
  musicName?: string;
  imageFileNames?: string[];
  videoSize?: number;
  coverSize?: number;
  musicSize?: number;
  articleContent?: string;
  scheduledAt?: number;
  visibility?: Visibility;
  originalDeclare?: boolean;
  platformSettings?: PlatformSpecificSettings;
  fillOptions?: ContentFillOptions;
  platforms: PlatformStatus[];
  createdAt: number;
  updatedAt: number;
}

/** 平台发布记录，用于统计和历史列表；filled 表示平台已填充、等待用户确认发布。 */
export interface PublishRecord {
  id: string;
  videoId: string;
  platformId: PlatformId;
  title: string;
  coverFileName?: string;
  publishedUrl?: string;
  publishedAt?: number;
  /** 最近一次填充、失败或发布状态发生变化的时间。 */
  updatedAt?: number;
  status: 'published' | 'error' | 'pending' | 'filled';
  error?: string;
  stats?: {
    views?: number;
    likes?: number;
    comments?: number;
    updatedAt?: number;
  };
}

/** 平台级设置，保留自定义 selector、默认话题和自动提交开关。 */
export interface PlatformSettings {
  enabled: boolean;
  customSelectors?: {
    title?: string[];
    description?: string[];
    topics?: string[];
  };
  autoSubmit?: boolean;
  defaultTopics?: string[];
}

/** 全局发布设置，例如填充速度、是否自动提交、平台间隔。 */
export interface GlobalSettings {
  fillSpeed: 'slow' | 'normal' | 'fast';
  autoSubmit: boolean;
  distributionInterval: number;
  /** 输入 #话题 后及按 Enter 确认后的步骤间隔，单位毫秒。 */
  topicIntervalMs: number;
}

/** 后端服务器连接配置。 */
export interface ServerConfig {
  apiUrl: string;
  apiKey: string;
  pollingInterval: number;
  connected: boolean;
}

export type LicenseStatus =
  | 'unconfigured'
  | 'inactive'
  | 'active'
  | 'restricted'
  | 'expired'
  | 'device_mismatch'
  | 'invalid';

export type LicenseTier = 'basic' | 'plus' | 'pro';

export type LicenseFeature =
  | 'publish'
  | 'batch'
  | 'selector-updates'
  | 'native-publish'
  | 'remote-publish';

export interface LicensingSettings {
  apiBaseUrl: string;
  activationCode: string;
  /** 浏览器插件安装实例 ID，不是硬件设备码。 */
  clientInstallId: string;
  /** 旧字段兼容；订阅版新逻辑不再使用 Machine Hash 语义。 */
  machineHash?: string;
  leaseToken: string;
  tier?: LicenseTier;
  features: LicenseFeature[];
  status: LicenseStatus;
  statusMessage?: string;
  validUntil?: number;
  serverTime?: number;
  serverTimeCheckedAt?: number;
}

/** 内置 AI 服务商类型，custom 表示用户手动配置的兼容 OpenAI 协议服务。 */
export type AIProviderBuiltinId = 'deepseek' | 'openai' | 'qwen' | 'siliconflow' | 'xiaomi' | 'custom';

/** 单个 AI 服务商配置，key 存在 secrets 时 apiKey 可为空。 */
export interface AIProviderConfig {
  id: string;
  builtinId: AIProviderBuiltinId;
  name: string;
  baseUrl: string;
  apiKey: string;
  textModel: string;
  imageModel: string;
  enabled: boolean;
}

/** AI 功能开关和当前默认服务商。 */
export interface AIProviderSettings {
  enabled: boolean;
  activeProviderId: string;
  providers: AIProviderConfig[];
  useForTitle: boolean;
  useForDescription: boolean;
  useForCover: boolean;
}

/** 本地工作区授权和当前项目选择状态。 */
export interface WorkspaceSettings {
  directoryName: string;
  permission: PermissionState | 'unsupported' | 'unknown';
  currentProjectId?: string;
  currentProjectName?: string;
  updatedAt?: number;
}

/** Chrome storage key 集中定义，避免 dashboard/background/content 各自硬编码。 */
export const STORAGE_KEYS = {
  draft: 'pubflow:draft',
  videos: 'pubflow:videos',
  records: 'pubflow:records',
  platformSettings: 'pubflow:platform-settings',
  globalSettings: 'pubflow:global-settings',
  currentTask: 'pubflow:current-task',
  serverConfig: 'pubflow:server-config',
  licensingSettings: 'pubflow:licensing-settings',
  aiSettings: 'pubflow:ai-settings',
  secrets: 'pubflow:secrets',
  workspaceSettings: 'pubflow:workspace-settings',
} as const;

/** runtime 消息统一返回结构。 */
export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** background、content script、dashboard、page world 之间的 runtime 消息协议。 */
export type RuntimeMessage =
  | {
    type: 'START_DISTRIBUTION';
    payload: {
      content: ContentData;
      platforms: PlatformId[];
      videoId?: string;
      autoSubmit?: boolean;
    };
  }
  | {
    type: 'OPEN_PLATFORM';
    payload: {
      platformId: PlatformId;
    };
  }
  | {
    type: 'CONTINUE_FILL';
    payload: {
      platformId: PlatformId;
    };
  }
  | {
    type: 'SKIP_PLATFORM';
    payload: {
      platformId: PlatformId;
    };
  }
  | {
    type: 'PAUSE_TASK';
  }
  | {
    type: 'RESUME_TASK';
  }
  | {
    type: 'STOP_TASK';
  }
  | {
    type: 'GET_TASK';
  }
  | {
    type: 'OPEN_DASHBOARD';
  }
  | {
    type: 'GET_SIDE_PANEL_STATUS';
  }
  | {
    type: 'GET_LICENSE_STATUS';
  }
  | {
    type: 'VERIFY_LICENSE';
    payload?: {
      licensingSettings?: LicensingSettings;
    };
  }
  | {
    type: 'SIDE_PANEL_STATUS';
    payload: {
      open: boolean;
    };
  }
  | {
    type: 'TASK_UPDATED';
    payload: {
      task: DistributionTask | null;
    };
  }
  | {
    type: 'FILL_CONTENT';
    payload: {
      content: ContentData;
      platformId: PlatformId;
      requestId?: string;
      autoSubmit?: boolean;
    };
  }
  | {
    type: 'FILL_CONTENT_ACK';
    payload: {
      platformId: PlatformId;
      requestId: string;
    };
  }
  | {
    type: 'REQUEST_PAGE_STATUS';
    payload: {
      platformId: PlatformId;
    };
  }
  | {
    type: 'PAGE_STATUS';
    payload: {
      platformId: PlatformId;
      ready: boolean;
      blocked: boolean;
      requiresUserAction?: boolean;
      message: string;
    };
  }
  | {
    type: 'CONTENT_FILLED';
    payload: {
      platformId: PlatformId;
      message: string;
    };
  }
  | {
    type: 'FINAL_PUBLISH_PREPARE';
    payload: {
      platformId: PlatformId;
    };
  }
  | {
    type: 'FINAL_PUBLISH_CLICK';
    payload: {
      platformId: PlatformId;
      x: number;
      y: number;
    };
  }
  | {
    type: 'FILL_ERROR';
    payload: {
      platformId: PlatformId;
      error: string;
    };
  }
  | {
    type: 'EXECUTE_IN_PAGE_WORLD';
    payload: {
      title: string;
      topics: string[];
      description: string;
      skipTitle?: boolean;
      topicIntervalMs?: number;
    };
  }
  | {
    type: 'FILL_WEIXIN_SHORT_TITLE';
    payload: {
      title: string;
    };
  }
  | {
    type: 'FILL_WEIXIN_ARTICLE_TITLE';
    payload: {
      title: string;
    };
  }
  | {
    type: 'FILL_WEIXIN_VIDEO_MARK';
    payload: {
      videoMark: string;
    };
  }
  | {
    type: 'UPLOAD_FILE_IN_PAGE_WORLD';
    payload: {
      fileName: string;
      fileType: string;
      fileDataBase64: string;
      acceptSelector: string;
      uploadDoneSelector: string;
      editorReadySelector: string;
      timeoutMs: number;
    };
  }
  | {
    type: 'UPLOAD_IMAGES_IN_PAGE_WORLD';
    payload: {
      files: Array<{ fileName: string; fileType: string; fileDataBase64: string }>;
      uploadDoneSelector: string;
      editorReadySelector: string;
      timeoutMs: number;
    };
  }
  | {
    type: 'UPLOAD_COVER_IN_PAGE_WORLD';
    payload: {
      fileName: string;
      fileType: string;
      fileDataBase64: string;
      coverSelector: string;
    };
  }
  | {
    type: 'CHECK_WUJIE_READY';
    payload: {
      readySelector: string;
      editorSelector: string;
      fileInputSelectors: string[];
      uploadContainerSelector: string;
    };
  }
  | {
    type: 'WAIT_WEIXIN_READY';
    payload: {
      selector: string;
      timeoutMs: number;
    };
  }
  | {
    type: 'HANDLE_WEIXIN_DECLARE_POPUP';
  }
  | {
    type: 'CDP_CLICK';
    payload: {
      x: number;
      y: number;
    };
  }
  | {
    type: 'CDP_FILL_DESCRIPTION_TOPICS';
    payload: {
      x: number;
      y: number;
      description: string;
      topics: string[];
      topicIntervalMs: number;
    };
  }
  | {
    type: 'CDP_DRAG';
    payload: {
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    };
  }
  | {
    type: 'HANDLE_WEIXIN_SCHEDULE';
    payload: {
      scheduledAt: number;
    };
  }
  | {
    type: 'DOUYIN_UPLOAD_COVER';
    payload: {
      fileName: string;
      fileType: string;
      fileDataBase64: string;
    };
  }
  | {
    type: 'DOUYIN_UPLOAD_ARTICLE_COVER';
    payload: {
      fileName: string;
      fileType: string;
      fileDataBase64: string;
    };
  }
  | {
    type: 'XIAOHONGSHU_FILL_IMAGE_DESCRIPTION';
    payload: {
      description: string;
    };
  };
