# PubFlow — 多平台短视频发布助手 PRD v2

## 1. 产品概述

### 1.1 产品名称
**PubFlow**（多平台短视频发布助手）

### 1.2 产品定位
Chrome 浏览器扩展，帮助短视频创作者将同一份内容（标题、描述、话题、视频、封面）快速分发到多个平台。
基于用户当前浏览器的登录态，自动填充各平台发布页表单，用户只需确认并点击发布。

### 1.3 交互架构
- **Dashboard（主页面）**：`chrome-extension://xxx/dashboard.html`，全屏管理后台
- **Side Panel（侧边栏）**：分发进度查看 + 快捷操作，作为 Dashboard 的辅助
- **Content Script**：注入各平台发布页，负责 DOM 操作填充

---

## 2. 支持平台（8 个）

| # | 平台 | ID | 发布页地址 | 备注 |
|---|------|----|-----------|------|
| 1 | 抖音创作者 | `douyin` | `creator.douyin.com` | ✅ 已配置 |
| 2 | 小红书 | `xiaohongshu` | `creator.xiaohongshu.com` | ✅ 已配置 |
| 3 | 视频号 | `weixinChannels` | `channels.weixin.qq.com` | ✅ 已配置 |
| 4 | B站 | `bilibili` | `member.bilibili.com` | ✅ 已配置 |
| 5 | 快手 | `kuaishou` | `creator.kuaishou.com` | 🔜 待配置 |
| 6 | 微博 | `weibo` | `weibo.com` / `weibo.com/upload/video` | 🔜 待配置 |
| 7 | 知乎 | `zhihu` | `zhihu.com/creator/content/video` | 🔜 待配置 |
| 8 | 西瓜视频 | `xigua` | `creator.ixigua.com` | 🔜 待配置 |

### 扩展平台（第二阶段）

| 平台 | 备注 |
|------|------|
| YouTube Studio | 海外视频，有官方 API |
| TikTok Creator | 海外短视频 |
| Twitter/X | 图文+视频 |
| 头条号 | 字节系图文平台 |
| 百家号 | 百度系内容平台 |

---

## 3. Dashboard 页面设计

### 3.1 布局风格
**后台管理系统布局**（左侧导航 + 右侧内容区），不是博客风格。
理由：这是一个任务管理工具，信息密度高，后台布局更合适。

```
┌──────────────────────────────────────────────────────────┐
│  🚀 PubFlow                          [用户名] [设置图标]  │ ← 顶栏
├────────┬─────────────────────────────────────────────────┤
│        │                                                 │
│ 📊 工作台│                                                 │
│        │                                                 │
│ 📹 我的 │                                                 │
│   视频  │              右侧内容区                          │
│        │              （根据左侧菜单切换）                  │
│ 📋 发布 │                                                 │
│   记录  │                                                 │
│        │                                                 │
│ ⚙️ 设置 │                                                 │
│        │                                                 │
├────────┤                                                 │
│ v0.1.0 │                                                 │
└────────┴─────────────────────────────────────────────────┘
  左侧导航            右侧内容区
```

### 3.2 页面 1：工作台（仪表盘）

**功能**：一眼看到今天的分发情况 + 快速发起新任务

```
┌─────────────────────────────────────────────────────────┐
│  工作台                                                   │
├─────────┬─────────┬─────────┬─────────┐                  │
│ 今日已发 │ 待确认   │ 本月累计 │ 平台数   │  ← 数据卡片     │
│   5     │   2     │   48    │   8     │                  │
└─────────┴─────────┴─────────┴─────────┘                  │
│                                                          │
│  ┌── 快速发布 ──────────────────────────────────────────┐│
│  │ 标题: [_________________________________]             ││
│  │ 描述: [_________________________________]             ││
│  │       [_________________________________]             ││
│  │ 话题: [#___] [#___] [#___] [+ 添加]                   ││
│  │ 视频: [选择文件 xxx.mp4]  封面: [选择图片]              ││
│  │                                                       ││
│  │ 目标平台: [☑抖音] [☑快手] [☑小红书] [☐B站] [☐视频号]  ││
│  │           [☐微博] [☐知乎] [☐西瓜]                      ││
│  │                                                       ││
│  │              [🚀 开始分发]                             ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ┌── 进行中的任务 ──────────────────────────────────────┐│
│  │ #048  "5个Excel技巧..."  3/8 平台已完成               ││
│  │ #047  "手机摄影教程..."  ✅ 已全部完成                 ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

**数据卡片说明**：

| 卡片 | 数据来源 | 说明 |
|------|---------|------|
| 今日已发 | 本地存储 | 今天成功发布的平台数 |
| 待确认 | 本地存储 | 已填充但用户还没点发布的数量 |
| 本月累计 | 本地存储 | 本月成功发布的总次数 |
| 平台数 | 配置 | 已启用的平台数量 |

### 3.3 页面 2：我的视频

**功能**：管理所有待分发 / 已分发的视频内容，是"内容资产"视图。

```
┌──────────────────────────────────────────────────────────┐
│  我的视频                          [搜索_______] [+ 新建] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 🎬 5个Excel技巧，职场人必备        2026-05-06 14:30 │ │
│  │    标签: #职场 #Excel #办公技巧                       │ │
│  │    平台状态:  [✅抖音] [✅快手] [⏳小红书] [⬜B站]    │ │
│  │    操作: [编辑] [重新分发] [删除]                      │ │
│  ├─────────────────────────────────────────────────────┤ │
│  │ 🎬 手机摄影教程：从入门到精通      2026-05-05 10:00 │ │
│  │    标签: #摄影 #手机摄影 #教程                        │ │
│  │    平台状态:  [✅抖音] [✅快手] [✅小红书] [✅B站]    │ │
│  │    操作: [编辑] [重新分发] [删除]                      │ │
│  ├─────────────────────────────────────────────────────┤ │
│  │ 🎬 AI工具推荐合集                  2026-05-04 09:00 │ │
│  │    标签: #AI #工具推荐 #效率                          │ │
│  │    平台状态:  [✅抖音] [⬜快手] [⬜小红书] [⬜B站]    │ │
│  │    操作: [编辑] [继续分发] [删除]                      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ◀ 1  2  3  ...  ▶                    共 48 条           │
└──────────────────────────────────────────────────────────┘
```

**数据模型**：

```typescript
interface VideoRecord {
  id: string
  title: string
  description: string
  topics: string[]
  videoFileName?: string        // 视频文件名（文件本身不存，仅记引用）
  coverFileName?: string        // 封面文件名
  platforms: PlatformStatus[]   // 各平台发布状态
  createdAt: number
  updatedAt: number
}

interface PlatformStatus {
  platformId: PlatformId
  status: 'pending' | 'filling' | 'filled' | 'published' | 'skipped' | 'error'
  publishedUrl?: string         // 发布后的文章/视频链接
  publishedAt?: number          // 发布时间
  error?: string                // 错误信息
}
```

**操作说明**：

| 操作 | 说明 |
|------|------|
| 编辑 | 修改标题/描述/话题，重新分发 |
| 重新分发 | 对已发布内容重新走一遍分发流程 |
| 继续分发 | 上次没发完的平台继续 |
| 删除 | 删除记录（不影响已发布内容） |

### 3.4 页面 3：发布记录

**功能**：查看所有已发布的内容，追踪各平台数据（阅读数等）。

```
┌──────────────────────────────────────────────────────────┐
│  发布记录                   [筛选平台▼] [筛选状态▼] [导出] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  平台  │ 标题                    │ 链接   │ 发布时间 │ 阅读 │ 状态 │ 操作 │
│  ──────┼─────────────────────────┼────────┼──────────┼──────┼──────┼──────│
│  🎵抖音 │ 5个Excel技巧...         │ 🔗链接 │ 05-06   │ 1.2w │ ✅   │ [查看]│
│  📕小红书│ 5个Excel技巧...         │ 🔗链接 │ 05-06   │ 856  │ ✅   │ [查看]│
│  🎵抖音 │ 手机摄影教程...          │ 🔗链接 │ 05-05   │ 3.4w │ ✅   │ [查看]│
│  📺B站  │ 手机摄影教程...          │ 🔗链接 │ 05-05   │ 567  │ ✅   │ [查看]│
│  🔴快手 │ AI工具推荐合集...        │   —    │ —       │  —   │ ⏳   │ [填充]│
│  📕小红书│ AI工具推荐合集...        │   —    │ —       │  —   │ ❌   │ [重试]│
│                                                          │
│  ◀ 1  2  3  ...  ▶                    共 128 条          │
└──────────────────────────────────────────────────────────┘
```

**数据模型**：

```typescript
interface PublishRecord {
  id: string
  videoId: string               // 关联到 VideoRecord
  platformId: PlatformId
  title: string
  publishedUrl?: string
  publishedAt?: number
  status: 'published' | 'error' | 'pending'
  error?: string
  stats?: {
    views?: number              // 阅读/播放数
    likes?: number              // 点赞数
    comments?: number           // 评论数
    updatedAt?: number          // 数据更新时间
  }
}
```

**筛选/排序**：
- 按平台筛选（多选）
- 按状态筛选（已发布/失败/待发布）
- 按时间排序
- 标题关键词搜索

**阅读数获取**（第二阶段）：
- 部分平台可通过 API 或 DOM 抓取数据
- 可定期更新（如每天一次）

### 3.5 页面 4：设置

**功能**：平台配置、API Key、默认设置

```
┌──────────────────────────────────────────────────────────┐
│  设置                                                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌── 渠道管理 ──────────────────────────────────────────┐│
│  │                                                      ││
│  │  平台         状态      操作                          ││
│  │  🎵 抖音创作者  [已启用✓]  [配置] [禁用]               ││
│  │  📕 小红书     [已启用✓]  [配置] [禁用]               ││
│  │  📺 视频号     [已启用✓]  [配置] [禁用]               ││
│  │  📺 B站       [已启用✓]  [配置] [禁用]               ││
│  │  🔴 快手       [已启用✓]  [配置] [禁用]               ││
│  │  🔵 微博       [已启用✓]  [配置] [禁用]               ││
│  │  💡 知乎       [已启用✓]  [配置] [禁用]               ││
│  │  🎬 西瓜视频   [已启用✓]  [配置] [禁用]               ││
│  │                                                      ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ┌── 通用设置 ──────────────────────────────────────────┐│
│  │                                                      ││
│  │  填充速度:    [慢速 ○] [正常 ●] [快速 ○]              ││
│  │  自动发布:    [关 ●]   [开 ○]   (填充后是否自动点发布) ││
│  │  默认平台:    [☑抖音] [☑快手] [☑小红书] [☐B站] ...   ││
│  │  分发间隔:    [3] 秒（平台间切换等待时间）              ││
│  │                                                      ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ┌── 与自有平台对接 ────────────────────────────────────┐│
│  │                                                      ││
│  │  服务地址:   [https://your-platform.com/api_____]    ││
│  │  API Key:    [••••••••••••••••]                      ││
│  │  连接状态:   ✅ 已连接 / ❌ 未连接                     ││
│  │  轮询间隔:   [30] 秒                                  ││
│  │                                                      ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ┌── 数据管理 ──────────────────────────────────────────┐│
│  │                                                      ││
│  │  [导出所有数据]  [导入数据]  [清空所有数据]            ││
│  │  已用存储: 2.3 MB / 10 MB (chrome.storage)           ││
│  │                                                      ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│                                    [保存设置]             │
└──────────────────────────────────────────────────────────┘
```

**渠道配置详情（点"配置"后展开）**：

```typescript
interface PlatformSettings {
  enabled: boolean
  // 高级选项（可选覆盖默认选择器）
  customSelectors?: {
    title?: string[]
    description?: string[]
    topics?: string[]
  }
  // 填充后是否自动点发布（覆盖全局设置）
  autoSubmit?: boolean
  // 该平台的默认话题（每次自动追加）
  defaultTopics?: string[]
}
```

---

## 4. Side Panel（侧边栏）

**功能**：分发进行中的实时进度查看 + 快捷操作

```
┌─────────────────────────────┐
│  PubFlow 分发进度            │
├─────────────────────────────┤
│  当前任务: #048              │
│  "5个Excel技巧，职场人必备"   │
│                              │
│  ✅ 抖音 — 已填充，待发布     │
│    [打开标签页]              │
│                              │
│  ✅ 快手 — 已填充，待发布     │
│    [打开标签页]              │
│                              │
│  ⏳ 小红书 — 正在填充...      │
│    [跳过]                    │
│                              │
│  ⬜ B站 — 等待中             │
│                              │
│  ⬜ 视频号 — 等待中           │
│                              │
│  ⬜ 微博 — 等待中             │
│                              │
│  ⬜ 知乎 — 等待中             │
│                              │
│  ⬜ 西瓜 — 等待中             │
│                              │
├─────────────────────────────┤
│  [⏸ 暂停]  [⏭ 跳过当前]     │
│  [打开 Dashboard →]          │
└─────────────────────────────┘
```

---

## 5. 核心流程

### 5.1 分发主流程

```
用户在 Dashboard 填写内容 + 选择平台
    │
    ├─ 点击"开始分发"
    │
    ├─ background 创建 DistributionTask，存入 storage
    │
    ├─ 对每个目标平台（按顺序）：
    │      │
    │      ├─ chrome.tabs.create() 打开平台发布页
    │      │
    │      ├─ content script 自动注入（WXT 按 matchHosts 匹配）
    │      │
    │      ├─ content script 检测页面状态：
    │      │      ├─ 检查 blocker（登录弹窗、确认框等）
    │      │      ├─ 如果有 blocker → 通知用户处理，status = 'waitingUser'
    │      │      └─ 如果页面就绪 → 等待 readySelector 出现
    │      │
    │      ├─ 按拟人节奏填充字段：
    │      │      ├─ 填充标题（pasteLike）
    │      │      ├─ 填充描述（contentEditable）
    │      │      ├─ 填充话题（simulateTyping，逐个输入+回车）
    │      │      ├─ 填入视频文件（DataTransfer API）
    │      │      └─ 填入封面图（DataTransfer API）
    │      │
    │      ├─ 通知 background："填充完成"
    │      │
    │      ├─ status = 'filled' → Side Panel 提示用户确认
    │      │
    │      ├─ 用户在目标标签页检查 → 手动点发布
    │      │
    │      └─ 用户在 Side Panel 点"下一个" → 继续下一个平台
    │
    └─ 全部完成 → task status = 'completed'
```

### 5.2 拟人填充策略

避免被平台检测为自动化操作：

| 策略 | 实现 |
|------|------|
| 输入延迟 | 每个字符间隔 50-150ms 随机 |
| 字段间停顿 | 每个字段填充完等 300-800ms |
| 焦点模拟 | 先 focus → 延迟 → 输入 → blur |
| 事件完整触发 | focus → keydown → beforeinput → input → keyup → change → blur |
| 平台间间隔 | 切换平台等待 2-5 秒（可配置） |

---

## 6. 数据存储设计

### 6.1 Storage Keys

```typescript
// chrome.storage.local keys
const STORAGE_KEYS = {
  // 内容草稿（工作台快速发布表单）
  'pubflow:draft': ContentDraft,

  // 视频记录列表（我的视频）
  'pubflow:videos': VideoRecord[],

  // 发布记录列表（发布记录）
  'pubflow:records': PublishRecord[],

  // 平台设置（设置页）
  'pubflow:platform-settings': Record<PlatformId, PlatformSettings>,

  // 全局设置
  'pubflow:global-settings': GlobalSettings,

  // 当前进行中的分发任务
  'pubflow:current-task': DistributionTask | null,

  // 自有平台对接配置
  'pubflow:server-config': ServerConfig,
}
```

### 6.2 数据模型汇总

```typescript
// ---- 平台 ID（扩展到 8 个）----
type PlatformId =
  | 'douyin'
  | 'xiaohongshu'
  | 'weixinChannels'
  | 'bilibili'
  | 'kuaishou'      // 新增
  | 'weibo'         // 新增
  | 'zhihu'         // 新增
  | 'xigua'         // 新增

// ---- 内容草稿 ----
interface ContentDraft {
  title: string
  description: string
  topicsText: string           // 空格分隔的话题文本
  selectedPlatforms: PlatformId[]
  videoFileName?: string       // 仅记文件名，不存文件本身
  coverFileName?: string
}

// ---- 视频记录 ----
interface VideoRecord {
  id: string
  title: string
  description: string
  topics: string[]
  platforms: PlatformStatus[]
  createdAt: number
  updatedAt: number
}

interface PlatformStatus {
  platformId: PlatformId
  status: 'pending' | 'filling' | 'filled' | 'published' | 'skipped' | 'error'
  publishedUrl?: string
  publishedAt?: number
  error?: string
}

// ---- 发布记录 ----
interface PublishRecord {
  id: string
  videoId: string
  platformId: PlatformId
  title: string
  publishedUrl?: string
  publishedAt?: number
  status: 'published' | 'error' | 'pending'
  error?: string
  stats?: {
    views?: number
    likes?: number
    comments?: number
    updatedAt?: number
  }
}

// ---- 分发任务 ----
interface DistributionTask {
  id: string
  videoId: string              // 关联到 VideoRecord
  content: ContentData
  platforms: PlatformTask[]
  currentIndex: number
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error'
  createdAt: number
}

interface PlatformTask {
  platformId: PlatformId
  tabId?: number
  status: PlatformTaskStatus
  message?: string
  error?: string
}

type PlatformTaskStatus =
  | 'pending'
  | 'opening'
  | 'waitingUser'     // 等待用户处理 blocker
  | 'ready'
  | 'filling'
  | 'filled'          // 已填充，等待用户点发布
  | 'published'
  | 'skipped'
  | 'error'

// ---- 全局设置 ----
interface GlobalSettings {
  fillSpeed: 'slow' | 'normal' | 'fast'  // 填充速度
  autoSubmit: boolean                      // 是否自动点发布
  defaultPlatforms: PlatformId[]           // 默认勾选的平台
  distributionInterval: number             // 平台间切换间隔（秒）
}

// ---- 自有平台对接 ----
interface ServerConfig {
  apiUrl: string
  apiKey: string
  pollingInterval: number     // 轮询间隔（秒）
  connected: boolean
}
```

---

## 7. 需要新增的平台配置

### 7.1 快手

```typescript
kuaishou: {
  id: 'kuaishou',
  name: '快手',
  icon: 'KS',
  editorUrl: 'https://creator.kuaishou.com/publish/video',
  matchHosts: ['creator.kuaishou.com'],
  readySelector: 'input, textarea, div[contenteditable="true"]',
  blockers: commonBlockers,
  fields: {
    title: {
      selectors: [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        'input[placeholder*="作品标题"]',
      ],
      fillMethod: 'pasteLike',
    },
    description: {
      selectors: [
        'textarea[placeholder*="描述"]',
        'textarea[placeholder*="作品描述"]',
        'div[contenteditable="true"]',
      ],
      fillMethod: 'contentEditable',
    },
    topics: {
      selectors: [
        'input[placeholder*="话题"]',
        'input[placeholder*="#"]',
      ],
      fillMethod: 'simulateTyping',
      multiValue: { prefix: '#', confirmKey: 'Enter', delayMs: 450 },
    },
  },
}
```

### 7.2 微博

```typescript
weibo: {
  id: 'weibo',
  name: '微博',
  icon: 'WB',
  editorUrl: 'https://weibo.com',
  matchHosts: ['weibo.com', 'www.weibo.com'],
  readySelector: 'textarea, div[contenteditable="true"]',
  blockers: commonBlockers,
  fields: {
    // 微博视频发布通常是一个带视频的微博，没有独立标题字段
    description: {
      selectors: [
        'textarea[placeholder*="分享"]',
        'textarea[placeholder*="说"]',
        'div[contenteditable="true"]',
        'textarea.W_input',
      ],
      fillMethod: 'contentEditable',
    },
    topics: {
      selectors: [
        'input[placeholder*="话题"]',
      ],
      fillMethod: 'simulateTyping',
      multiValue: { prefix: '#', confirmKey: 'Enter', delayMs: 500 },
    },
  },
}
```

### 7.3 知乎

```typescript
zhihu: {
  id: 'zhihu',
  name: '知乎',
  icon: 'ZH',
  editorUrl: 'https://www.zhihu.com/creator/content-manage/video',
  matchHosts: ['zhihu.com', 'www.zhihu.com'],
  readySelector: 'input, textarea, div[contenteditable="true"]',
  blockers: commonBlockers,
  fields: {
    title: {
      selectors: [
        'input[placeholder*="标题"]',
        'input[placeholder*="视频标题"]',
        'input.Input',
      ],
      fillMethod: 'pasteLike',
    },
    description: {
      selectors: [
        'textarea[placeholder*="描述"]',
        'textarea[placeholder*="简介"]',
        'div[contenteditable="true"]',
      ],
      fillMethod: 'contentEditable',
    },
    topics: {
      selectors: [
        'input[placeholder*="话题"]',
        'input[placeholder*="标签"]',
      ],
      fillMethod: 'simulateTyping',
      multiValue: { prefix: '', confirmKey: 'Enter', delayMs: 450 },
    },
  },
}
```

### 7.4 西瓜视频

```typescript
xigua: {
  id: 'xigua',
  name: '西瓜视频',
  icon: 'XG',
  editorUrl: 'https://creator.ixigua.com/upload',
  matchHosts: ['creator.ixigua.com'],
  readySelector: 'input, textarea, div[contenteditable="true"]',
  blockers: commonBlockers,
  fields: {
    title: {
      selectors: [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
      ],
      fillMethod: 'pasteLike',
    },
    description: {
      selectors: [
        'textarea[placeholder*="简介"]',
        'textarea[placeholder*="描述"]',
        'div[contenteditable="true"]',
      ],
      fillMethod: 'contentEditable',
    },
    topics: {
      selectors: [
        'input[placeholder*="标签"]',
        'input[placeholder*="话题"]',
      ],
      fillMethod: 'simulateTyping',
      multiValue: { prefix: '', confirmKey: 'Enter', delayMs: 450 },
    },
  },
}
```

---

## 8. 技术架构

### 8.1 技术栈

| 层 | 技术 |
|----|------|
| 框架 | WXT 0.20+ |
| 前端 | Vue 3 + TypeScript |
| 状态管理 | Pinia |
| 样式 | Tailwind CSS 4 |
| 存储 | WXT Storage API（chrome.storage.local） |
| 构建 | Vite（WXT 内置） |

### 8.2 目录结构

```
multi-publisher-extension/
├── wxt.config.ts
├── package.json
├── PRD.md
├── src/
│   ├── shared.css                          ← 全局样式（已有）
│   ├── types.ts                            ← 类型定义（需扩展到 8 平台）
│   ├── platforms.ts                        ← 平台配置（需扩展到 8 平台）
│   ├── messaging.ts                        ← 消息通信（已有）
│   ├── contentDraft.ts                     ← 内容草稿工具（已有）
│   │
│   ├── entrypoints/
│   │   ├── background.ts                   ← Service Worker：任务调度
│   │   ├── dashboard.html                  ← Dashboard 入口 HTML
│   │   ├── dashboard/
│   │   │   ├── App.vue                     ← Dashboard 根组件（左侧导航+右侧内容）
│   │   │   ├── main.ts
│   │   │   ├── components/
│   │   │   │   ├── Layout.vue              ← 左侧导航 + 右侧内容布局
│   │   │   │   ├── Workspace.vue           ← 工作台（仪表盘）
│   │   │   │   ├── QuickPublish.vue        ← 快速发布表单
│   │   │   │   ├── StatsCards.vue          ← 数据卡片
│   │   │   │   ├── ActiveTasks.vue         ← 进行中任务列表
│   │   │   │   ├── MyVideos.vue            ← 我的视频列表
│   │   │   │   ├── VideoCard.vue           ← 视频卡片组件
│   │   │   │   ├── PublishRecords.vue      ← 发布记录表格
│   │   │   │   ├── Settings.vue            ← 设置页
│   │   │   │   ├── PlatformList.vue        ← 渠道管理列表
│   │   │   │   └── GlobalSettings.vue      ← 通用设置
│   │   │   └── stores/
│   │   │       ├── content.ts              ← 内容草稿状态
│   │   │       ├── videos.ts               ← 我的视频状态
│   │   │       ├── records.ts              ← 发布记录状态
│   │   │       ├── task.ts                 ← 当前分发任务状态
│   │   │       └── settings.ts             ← 设置状态
│   │   │
│   │   └── sidepanel.html                  ← 侧边栏入口 HTML
│   │   └── sidepanel/
│   │       ├── App.vue                     ← 侧边栏 UI（进度查看）
│   │       ├── main.ts
│   │       └── components/
│   │           ├── TaskProgress.vue        ← 分发进度列表
│   │           └── QuickActions.vue        ← 暂停/跳过/打开Dashboard
│   │
│   ├── content-scripts/                    ← Content Scripts（按平台）
│   │   ├── base.ts                         ← 公共填充逻辑
│   │   ├── douyin.ts
│   │   ├── xiaohongshu.ts
│   │   ├── bilibili.ts
│   │   ├── weixin-channels.ts
│   │   ├── kuaishou.ts                     ← 新增
│   │   ├── weibo.ts                        ← 新增
│   │   ├── zhihu.ts                        ← 新增
│   │   └── xigua.ts                        ← 新增
│   │
│   └── utils/
│       ├── storage.ts                      ← 存储封装
│       ├── field-filler.ts                 ← 通用字段填充（拟人输入）
│       ├── tab-manager.ts                  ← 标签页管理
│       └── stats-fetcher.ts               ← 阅读数抓取（第二阶段）
```

---

## 9. 开发计划

### Phase 1：基础框架 + Dashboard + 2 个平台（2 周）
- [ ] WXT 项目重构（dashboard.html + sidePanel + content scripts）
- [ ] Dashboard 布局（左侧导航 + 4 个页面骨架）
- [ ] 工作台页面（快速发布表单 + 数据卡片）
- [ ] 设置页面（8 个平台启用/禁用）
- [ ] 抖音 + 小红书 content script 填充（从现有代码迁移）
- [ ] background 任务调度（打开标签页 → 填充 → 通知）
- [ ] Side Panel 基础进度显示

### Phase 2：完善 + 剩余 6 个平台（2 周）
- [ ] 视频号 + B站 + 快手 + 微博 + 知乎 + 西瓜 content scripts
- [ ] 视频文件/封面图自动填入
- [ ] 我的视频页面（CRUD + 平台状态）
- [ ] 发布记录页面（表格 + 筛选）
- [ ] 任务队列（暂停/继续/跳过）

### Phase 3：平台对接 + 高级功能（1-2 周）
- [ ] 与自有平台 HTTP 轮询对接
- [ ] 发布结果回传
- [ ] 阅读数抓取
- [ ] 数据导出/导入

---

## 10. 现有代码迁移清单

| 现有文件 | 改动 |
|---------|------|
| `types.ts` | PlatformId 扩展到 8 个，新增 VideoRecord/PublishRecord/GlobalSettings 类型 |
| `platforms.ts` | 新增 kuaishou/weibo/zhihu/xigua 配置，PLATFORM_ORDER 扩展 |
| `messaging.ts` | 保持，可能新增消息类型 |
| `contentDraft.ts` | 保持，小改 |
| `wxt.config.ts` | manifest 新增 kuaishou/weibo/zhihu/xigua 的 host_permissions |
