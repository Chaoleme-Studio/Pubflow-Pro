# 多平台文章发布调研报告

> 调研时间：2026-05-22
> 当前实现状态：2026-07-04 已接入抖音、B站、知乎、微博文章填充；小红书文章 selector 有预留但发布入口暂不开放；快手、视频号、西瓜仍不支持文章。
> 调研方式：Chrome DevTools MCP 逐平台快照分析
> 范围：只覆盖“文章/专栏/长文”发布流程。视频和普通图文流程分别见 `platform-video-发布元素定位.md`、`platform-image-图文发布调研.md`。

---

## 一、各平台文章发布页面URL

| 平台 | 文章发布URL | 模式 | 备注 |
|------|------------|------|------|
| 抖音 | `https://creator.douyin.com/creator-micro/content/upload?default-tab=5` → 点击"我要发文" → `/content/post/article` | 独立文章编辑器 | 2024年新功能 |
| B站 | `https://member.bilibili.com/platform/upload/text/new-edit` | 专栏文章（iframe内编辑器） | EVA3编辑器 |
| 小红书 | `https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=article` | 写长文（Tiptap编辑器） | 2025年新功能 |
| 知乎 | `https://zhuanlan.zhihu.com/write` | 知乎专栏（原生Markdown） | 最成熟的编辑器 |
| 微博 | `https://card.weibo.com/article/v5/editor#/draft` | 头条文章编辑器 | 当前代码已接入文章页；首页发布框仍用于普通图文/视频 |
| 快手 | ❌ 不支持 | 无文章模式 | 仅视频/图文 |
| 视频号 | ❌ 不支持 | 无文章模式 | 仅视频/图文 |
| 西瓜 | ❌ 不支持 | 无文章模式 | 仅视频 |

---

## 二、文章编辑器分类

### 模式A：独立文章编辑器（抖音、知乎）

**特点**：
- 有独立的文章发布页面
- 专用的文章标题输入框
- 富文本/Markdown正文编辑器
- 与视频/图文发布完全分离

### 模式B：专栏/长文编辑器（B站、小红书）

**特点**：
- 专栏文章或长文模式
- 在iframe或独立页面中
- 专用的富文本编辑器
- 有独立的标题输入框

### 模式C：统一发布框（微博）

**特点**：
- 图文视频共用同一个发布框
- 没有独立的文章编辑功能
- 内容长度有限
- 现有代码已支持

---

## 三、各平台文章编辑器详细参数

### 3.1 抖音 (douyin)

**编辑器类型**：自研富文本编辑器

**页面结构**：

| 元素 | 类型 | 详情 |
|------|------|------|
| 文章标题 | `textbox "请输入文章标题，最多不超过30个字"` | 最大30字符 |
| 文章摘要 | `textbox "添加内容摘要或文章精彩部分吸引用户阅读，最多不超过30个字"` | 最大30字符 |
| 文章正文 | `textbox multiline` (contenteditable) | 最大8000字符 |
| 文章头图 | 图片上传 | 推荐有头图 |
| 封面设置 | 图片上传 | 选择封面 |
| 添加话题 | 标签输入 | 最多5个 |
| 选择配乐 | 音乐选择 | 可选 |
| 谁可以看 | radio | 公开/好友可见/仅自己可见 |
| 发布时间 | radio + datetime | 立即发布/定时发布 |

**工具栏**（`div.menu-DA6h3d`，9个SVG按钮）：

| 序号 | 功能 | 类型 |
|------|------|------|
| 0 | 撤销 | icon（默认disabled） |
| 1 | 重做 | icon（默认disabled） |
| 2 | 分隔线 | - |
| 3 | 标题(H1/H2/H3) | dropdown |
| 4 | 加粗 | icon |
| 5 | 斜体 | icon |
| 6 | 引用 | icon |
| 7 | 图片上传 | icon |
| 8 | 分隔线 | - |
| 9 | 链接 | icon |
| 10 | 列表 | icon |

**操作按钮**：
- `button "发布"`
- `button "暂存离开"`

**技术栈**：React + Semi Design
**需要激活标签页**：是
**入口**：需要先点击"我要发文"按钮进入

**选择器**：
```typescript
文章字段: {
  标题: 'input[placeholder*="文章标题"]',
  摘要: 'input[placeholder*="文章摘要"]',
  正文: 'div[contenteditable="true"]',  // 需要区分标题/摘要/正文
  头图: 'input[type="file"]',
  封面: 'input[type="file"]',
  话题: '.topic-input',
}
```

**2026-06-08 实测补充：文章封面上传**

- 抖音文章页初始 DOM 中没有常驻的 `input[type=file]`，不能照知乎方案直接查隐藏 input。
- “点击上传封面图”并不是稳定入口；实测真正能打开封面编辑器的是同一区域右侧的“选择封面”。
- 打开“编辑封面”弹窗后，“+替换封面”会在点击瞬间临时创建一个 `input[type=file]`：
  - `accept="image/png,image/jpeg,image/jpg,image/bmp,image/webp,image/tif"`
  - 文件选择结束后这个 input 会从 DOM 中移除。
- 因为扩展缓存里保存的是 `File` 对象，不是本机文件路径，不能直接复用 Chrome DevTools 的 `upload_file` / CDP 文件路径能力。
- 当前可行方案是在页面主世界短暂拦截 `HTMLInputElement.prototype.click`：当临时图片 input 被创建并触发 `click()` 时，将缓存中的 `File` 赋给 input，再派发 `input/change` 事件。
- 旧的视频封面弹窗仍是 Semi Design Upload 组件，走 React fiber/Semi Upload 注入；文章封面编辑器不是 Semi Upload 结构，不能共用这套逻辑。

**代码约定**

- 抖音视频封面：`injectDouyinCover`，服务于视频发布页的横/竖封面弹窗。
- 抖音文章封面：`injectDouyinArticleCover`，服务于文章发布页“编辑封面”弹窗的临时 input。
- 不要把文章封面逻辑兜底到视频封面逻辑；二者 DOM 结构和上传生命周期完全不同。

---

### 3.2 B站 (bilibili)

**编辑器类型**：EVA3自定义Web Components编辑器（iframe内）

**页面结构**：

| 元素 | 类型 | 详情 |
|------|------|------|
| 标题 | `textbox "请输入标题（建议30字以内）"` | multiline |
| 正文 | `textbox multiline` (contenteditable) | 最大100,000字符 |
| 可见范围 | radio | 所有人可见/仅自己可见 |
| 自定义封面 | checkbox | 未设置则自动抓取正文开头文字 |
| 评论开关 | checkbox | 开启/关闭（默认开启） |
| 精选评论 | checkbox | 开启/关闭 |
| 定时发布 | checkbox | 当前+2小时~7天内 |
| 创作声明 | checkbox | 原创声明/AI辅助创作声明 |
| 话题 | button "添加话题" | |
| 文集 | button "选择文集" | |

**工具栏**（`div.toolbar.eva3-toolbar`，28个自定义元素）：

| 元素 | 功能 |
|------|------|
| `EVA3-TOOLBAR-UNDO` | 撤销 |
| `EVA3-TOOLBAR-REDO` | 重做 |
| `EVA3-TOOLBAR-FORMAT-PAINTER` | 格式刷 |
| `EVA3-TOOLBAR-FORMAT-CLEAR` | 清除格式 |
| `EVA3-TOOLBAR-HEAD` | 标题 |
| `EVA3-TOOLBAR-FONT-SMALL` | 小字号 |
| `EVA3-TOOLBAR-BOLD` | 加粗 |
| `EVA3-TOOLBAR-ITALIC` | 斜体 |
| `EVA3-TOOLBAR-UNDERLINE` | 下划线 |
| `EVA3-TOOLBAR-STRIKE` | 删除线 |
| `EVA3-TOOLBAR-TEXT-COLOR` | 文字颜色 |
| `EVA3-TOOLBAR-BACKGROUND-COLOR` | 背景颜色 |
| `EVA3-TOOLBAR-ALIGN` | 对齐方式 |
| `EVA3-TOOLBAR-ORDERED-LIST` | 有序列表 |
| `EVA3-TOOLBAR-BULLET-LIST` | 无序列表 |
| `EVA3-TOOLBAR-IMAGE` | 图片上传 |
| `EVA3-TOOLBAR-LINK` | 链接 |
| `EVA3-TOOLBAR-HR` | 分割线 |
| `EVA3-TOOLBAR-BLOCKQUOTE` | 引用 |
| `EVA3-TOOLBAR-EMOJI` | 表情 |
| `EVA3-TOOLBAR-PLUS` | 更多（添加视频等） |
| `EVA3-TOOLBAR-IMPORT` | 导入 |
| `EVA3-TOOLBAR-PREVIEW` | 预览 |

**操作按钮**：
- `button "发布设置"`
- `button "保存为草稿"`
- `button "发布"`

**技术栈**：Vue + BCC组件库 + EVA3编辑器
**需要激活标签页**：否
**特殊限制**：编辑器在iframe `https://member.bilibili.com/york/read-editor` 内，跨域限制

**选择器**：
```typescript
文章字段: {
  标题: 'textarea[placeholder*="标题"]',  // iframe内
  正文: 'div[contenteditable="true"]',  // iframe内
  // 工具栏用自定义元素，需要特殊处理
}
```

---

### 3.3 小红书 (xiaohongshu)

**编辑器类型**：Tiptap/ProseMirror富文本编辑器

**页面结构**：

| 元素 | 类型 | 详情 |
|------|------|------|
| 标题 | `textbox "输入标题"` | multiline, 最大64字符 |
| 正文 | `div.tiptap.ProseMirror` (contenteditable) | 字数统计显示 |
| 一键排版 | button | 内置排版功能 |

**工具栏**（11个menu-item按钮，SVG图标无文字标签）：

| 序号 | 状态 | 推测功能 |
|------|------|----------|
| 0 | disabled | 撤销 |
| 1 | disabled | 重做 |
| 2-10 | enabled | 格式化工具（标题、加粗、斜体、列表、引用、图片、链接等） |
| 10 | isFromFileRed | 图片上传 |

**操作按钮**：
- `button "暂存离开"`
- `button "一键排版"`

**技术栈**：React + Tiptap/ProseMirror
**需要激活标签页**：是
**特殊限制**：工具栏按钮无文字标签，需要通过SVG路径或位置识别

**选择器**：
```typescript
文章字段: {
  标题: 'textarea[placeholder*="输入标题"]',
  正文: '.tiptap.ProseMirror',  // contenteditable
}
```

---

### 3.4 知乎 (zhihu)

**编辑器类型**：原生Markdown + 富文本混合编辑器

**页面结构**：

| 元素 | 类型 | 详情 |
|------|------|------|
| 标题 | `textbox multiline` | 在编辑器顶部 |
| 正文 | `textbox multiline` (contenteditable) | 支持Markdown语法 |
| 添加封面 | 图片上传 | JPEG/JPG/PNG |
| 字数统计 | 显示 | 实时统计 |
| Markdown模式 | 状态显示 | "Markdown 语法输入中" |

**工具栏**（22个按钮，全部有文字标签）：

| 按钮 | 功能 |
|------|------|
| `button "撤销"` | 撤销 |
| `button "重做"` | 重做 |
| `button "清除格式"` | 清除格式 |
| `button "标题"` | 标题 |
| `button "加粗"` | 加粗 |
| `button "斜体"` | 斜体 |
| `button "列表"` | 列表 |
| `button "目录"` | 目录 |
| `button "引用"` | 引用 |
| `button "分割线"` | 分割线 |
| `button "代码块"` | 代码块 |
| `button "注释"` | 注释 |
| `button "图片"` | 图片上传 |
| `button "视频"` | 视频 |
| `button "链接"` | 链接 |
| `button "公式"` | 公式 |
| `button "表格"` | 表格 |
| `button "导入"` | 导入 |
| `button "草稿备份"` | 草稿备份 |
| `button "更多"` | 更多选项 |
| `button "创作助手"` | AI辅助功能 |

**AI创作助手功能**：
- 内容检测：识别错别字，提供用词优化建议
- 智能排版：自动修正空格、标点及英文大小写
- 智能标题：提供更多标题灵感
- 提取导语：理清全文思路，轻松创作导语
- AI配图：输入图片灵感生成配图

**操作按钮**：
- `button "预览"` (disabled until content)
- `button "发布"` (disabled until content)

**技术栈**：React + 自定义编辑器
**需要激活标签页**：是
**特殊限制**：React组件需要CDP可信点击

**2026-06-08 实测补充：文章封面上传**

- 知乎文章页有常驻隐藏 input：`input.UploadPicture-input[type="file"]`。
- 该 input 位于“添加文章封面”区域下，`accept=".jpeg, .jpg, .png"`。
- 新开 `https://zhuanlan.zhihu.com/write` 实测：直接对这个 input 选择本地封面文件即可生成 `image "封面图"`，不会弹二次确认窗口。
- 上传成功后页面可能从 `/write` 自动变成 `/p/{id}/edit` 草稿编辑页，这是知乎保存草稿后的正常行为。
- 小尺寸测试图可能长期停在知乎图片接口 `processing`，不要用插件图标等非真实封面素材作为结论依据。

**代码约定**

- 文章封面只查 `.UploadPicture-input` 及其所在 `UploadPicture` 区域。
- 文章模式找不到该 input 时应直接报错，不要兜底打开视频封面弹窗。
- 视频封面仍使用“选择封面 → 本地上传 → 确认选择”的弹窗流程。

**选择器**：
```typescript
文章字段: {
  标题: '.WriteIndex-titleInput textarea',  // 顶部标题
  正文: 'div[contenteditable="true"]',  // 正文编辑器
  封面: 'input[type="file"]',
}
```

---

### 3.5 微博 (weibo)

**编辑器类型**：统一发布框（无独立文章编辑器）

**页面结构**：

| 元素 | 类型 | 详情 |
|------|------|------|
| 文本内容 | `textbox "有什么新鲜事想分享给大家？"` | multiline |
| 工具栏 | buttons | 表情、图片、视频、话题、头条文章、更多 |
| 内容声明 | 功能 | 内容无需标注 |
| 定时微博 | 功能 | 需要会员 |
| 可见性 | 选择 | 公开 |

**操作按钮**：
- `button "发送"`

**技术栈**：自定义组件（wbpro组件库）
**需要激活标签页**：否
**特殊限制**：
- 没有独立的文章编辑器
- "头条文章"是单独的功能入口
- 现有代码已支持微博发布，不需要额外开发

---

## 四、编辑器类型与填充方案

### 4.1 编辑器类型分类

| 平台 | 编辑器类型 | 原生Markdown支持 | 图片上传方式 | 特殊说明 |
|------|-----------|:----------------:|------------|----------|
| 抖音 | 自研contenteditable | ✗ | 工具栏按钮 | 工具栏SVG无标签 |
| B站 | EVA3 Web Components | ✗ | 工具栏按钮 | iframe内，自定义元素 |
| 小红书 | Tiptap/ProseMirror | ✗ | 工具栏按钮 | 有"一键排版" |
| 知乎 | 混合编辑器 | ✓ | 工具栏按钮 | 支持Markdown语法输入 |
| 微博 | 统一发布框 | ✗ | 工具栏按钮 | 非文章模式 |

### 4.2 Markdown → 各平台填充方案

**核心问题**：我们的内容是Markdown格式（文本+图片），需要填充到各平台的富文本编辑器中。

**方案分析**：

#### 方案A：Markdown → HTML → innerHTML注入（推荐）

```typescript
// 流程
Markdown → 解析为HTML → 设置编辑器innerHTML

// 优点
- 保留格式（标题、加粗、列表、引用等）
- 一次转换，多平台复用
- 不依赖平台工具栏

// 缺点
- 图片需要先上传到图床，替换为在线URL
- 不同平台的HTML标签支持不同
- 可能需要平台特定的HTML清理

// 实现
async function fillArticleEditor(markdown: string, images: File[]) {
  // 1. 上传图片到图床，获取URL
  const imageUrls = await uploadToImageHost(images);
  
  // 2. 替换Markdown中的本地图片路径为在线URL
  const mdWithUrls = replaceImagePaths(markdown, imageUrls);
  
  // 3. 转换为HTML
  const html = markdownToHtml(mdWithUrls);
  
  // 4. 注入到编辑器
  const editor = document.querySelector('[contenteditable="true"]');
  editor.innerHTML = html;
  
  // 5. 触发input事件，让编辑器识别内容变化
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}
```

#### 方案B：逐段填充（复杂但更安全）

```typescript
// 流程
解析Markdown → 逐段识别类型 → 使用平台API/工具栏逐段插入

// 优点
- 更精确的控制
- 兼容性更好
- 可以处理特殊平台限制

// 缺点
- 实现复杂度高
- 速度慢
- 需要为每个平台单独实现

// 实现
async function fillArticleEditorByChunks(markdown: string) {
  const blocks = parseMarkdownBlocks(markdown);
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        await insertHeading(block.level, block.text);
        break;
      case 'paragraph':
        await insertParagraph(block.text);
        break;
      case 'image':
        await insertImage(block.url);
        break;
      case 'list':
        await insertList(block.items);
        break;
      // ...
    }
  }
}
```

#### 方案C：模拟键盘输入（最慢但最兼容）

```typescript
// 流程
将Markdown渲染为纯文本 → 模拟逐字输入

// 优点
- 兼容性最好
- 不依赖innerHTML

// 缺点
- 速度极慢
- 无法保留格式
- 图片无法处理

// 结论：不推荐
```

### 4.3 推荐方案：方案A + 平台适配层

```typescript
// 统一接口
interface ArticleFiller {
  fillTitle(title: string): Promise<void>;
  fillBody(html: string): Promise<void>;
  uploadImages(images: File[]): Promise<string[]>;
  fillTopics(topics: string[]): Promise<void>;
  fillCover(image: File): Promise<void>;
  clickPublish(): Promise<void>;
}

// 平台实现
class DouyinArticleFiller implements ArticleFiller { /* ... */ }
class BilibiliArticleFiller implements ArticleFiller { /* ... */ }
class XiaohongshuArticleFiller implements ArticleFiller { /* ... */ }
class ZhihuArticleFiller implements ArticleFiller { /* ... */ }
```

---

## 五、图床方案分析

### 5.1 为什么需要图床？

**核心原因**：Markdown中的图片是本地文件路径，但富文本编辑器需要在线URL。

```markdown
# 文章标题

这是一段文字。

![图片描述](./images/photo1.jpg)  ← 本地路径，编辑器无法识别

需要转换为：

![图片描述](https://image-host.com/abc123.jpg)  ← 在线URL，编辑器可识别
```

### 5.2 图床方案对比

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|:------:|
| **SM.MS** | 免费、稳定、无需注册 | 有上传限制、可能被墙 | ★★★ |
| **路过图床** | 免费、国内访问快 | 稳定性一般 | ★★☆ |
| **腾讯云COS** | 稳定、速度快、有免费额度 | 需要配置、有成本 | ★★★★ |
| **阿里云OSS** | 稳定、速度快、有免费额度 | 需要配置、有成本 | ★★★★ |
| **Cloudflare R2** | 免费额度大、全球CDN | 国内访问可能慢 | ★★★ |
| **平台自有图床** | 无需额外服务 | 需要先登录平台、可能有防盗链 | ★★☆ |
| **Base64内联** | 无需上传 | 文件大、不支持所有编辑器 | ★☆☆ |

### 5.3 推荐方案：平台自有图床 + 公共图床兜底

```typescript
// 优先使用平台自有图床（上传后可直接使用）
// 兜底使用公共图床（SM.MS等）

async function uploadImage(image: File, platform: string): Promise<string> {
  try {
    // 1. 尝试上传到平台自有图床
    return await uploadToPlatformImageHost(image, platform);
  } catch {
    // 2. 兜底：上传到公共图床
    return await uploadToPublicImageHost(image);
  }
}
```

**平台自有图床**：
- 抖音：上传图片时自动获得URL
- B站：通过工具栏IMAGE按钮上传
- 小红书：通过工具栏上传
- 知乎：通过工具栏图片按钮上传

**公共图床**：
- SM.MS：`https://sm.ms/api/v2/upload`
- 路过图床：`https://imgchr.com/api/v1/upload`

### 5.4 图床实现架构

```typescript
// src/content/imageHost.ts

interface ImageHost {
  name: string;
  upload(file: File): Promise<string>;
}

class SMMSImageHost implements ImageHost {
  name = 'smms';
  async upload(file: File): Promise<string> {
    const form = new FormData();
    form.append('smfile', file);
    const res = await fetch('https://sm.ms/api/v2/upload', {
      method: 'POST',
      headers: { 'Authorization': 'YOUR_TOKEN' },
      body: form,
    });
    const data = await res.json();
    return data.data.url;
  }
}

class PlatformImageHost implements ImageHost {
  name: string;
  constructor(private platform: string) { this.name = platform; }
  
  async upload(file: File): Promise<string> {
    // 每个平台的上传逻辑不同
    switch (this.platform) {
      case 'douyin':
        return await this.uploadToDouyin(file);
      case 'bilibili':
        return await this.uploadToBilibili(file);
      // ...
    }
  }
}
```

---

## 六、各平台技术难点

| 平台 | 难点 | 解决方案 |
|------|------|----------|
| 抖音 | React + Semi Design，工具栏SVG无标签 | 使用evaluate_script操作DOM |
| B站 | iframe跨域，EVA3自定义元素 | 需要注入到iframe内操作 |
| 小红书 | Tiptap/ProseMirror，工具栏无标签 | 使用evaluate_script操作DOM |
| 知乎 | React + CDP可信点击 | 使用CDP协议点击 |
| 微博 | 统一发布框，非文章模式 | 复用现有代码 |

---

## 七、Markdown解析方案

### 7.1 推荐库

| 库 | 特点 | 推荐度 |
|----|------|:------:|
| **marked** | 轻量、快速、纯JS | ★★★★ |
| **markdown-it** | 插件丰富、可扩展 | ★★★★★ |
| **unified/remark** | AST级别处理、最灵活 | ★★★★ |
| **showdown** | 双向转换 | ★★★ |

### 7.2 推荐方案：markdown-it

```typescript
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,        // 禁用HTML标签（安全）
  breaks: true,       // 换行转<br>
  linkify: true,      // 自动链接
});

function markdownToHtml(markdown: string): string {
  return md.render(markdown);
}

// 平台特定的HTML清理
function cleanHtmlForPlatform(html: string, platform: string): string {
  switch (platform) {
    case 'douyin':
      // 抖音不支持某些标签
      return html.replace(/<iframe.*?<\/iframe>/gi, '');
    case 'bilibili':
      // B站支持更多标签
      return html;
    case 'zhihu':
      // 知乎支持原生Markdown，可以直接使用
      return html;
    default:
      return html;
  }
}
```

---

## 八、实现优先级

### P0 - 核心功能
1. Markdown解析器（markdown-it）
2. 图床上传模块
3. HTML注入到contenteditable
4. 标题填充

### P1 - 高优先级
5. 知乎文章填充（原生Markdown支持）
6. 抖音文章填充
7. 图片上传到编辑器

### P2 - 中优先级
8. B站文章填充（iframe操作）
9. 小红书文章填充
10. 格式兼容性处理

### P3 - 低优先级
11. 更多平台真实回归
12. 小红书文章入口开放评估
13. 富文本图片插入稳定性优化

---

## 九、实施建议

### 第一步：Markdown解析模块

```typescript
// src/content/article/markdownParser.ts
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
});

export function parseMarkdown(markdown: string): {
  title: string;
  body: string;
  images: string[];
} {
  // 提取标题（第一个#标题）
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : '';
  
  // 提取图片路径
  const imageRegex = /!\[.*?\]\((.+?)\)/g;
  const images: string[] = [];
  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    images.push(match[1]);
  }
  
  // 转换为HTML
  const body = md.render(markdown);
  
  return { title, body, images };
}
```

### 第二步：图床上传模块

```typescript
// src/content/article/imageUploader.ts
export interface ImageUploader {
  upload(file: File): Promise<string>;
}

export class SMMSUploader implements ImageUploader {
  async upload(file: File): Promise<string> {
    // SM.MS上传逻辑
  }
}

export class PlatformUploader implements ImageUploader {
  constructor(private platform: string) {}
  
  async upload(file: File): Promise<string> {
    // 平台自有图床上传逻辑
  }
}
```

### 第三步：文章填充器

```typescript
// src/content/article/articleFiller.ts
export interface ArticleFiller {
  fillTitle(title: string): Promise<void>;
  fillBody(html: string): Promise<void>;
  uploadAndInsertImages(images: File[]): Promise<void>;
  clickPublish(): Promise<void>;
}

export class DouyinArticleFiller implements ArticleFiller {
  async fillTitle(title: string) {
    const input = document.querySelector('input[placeholder*="文章标题"]');
    await this.fillInput(input, title);
  }
  
  async fillBody(html: string) {
    const editor = document.querySelector('div[contenteditable="true"]');
    editor.innerHTML = html;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
  
  // ...
}
```

### 第四步：平台注册

```typescript
// src/platforms/douyin/article.ts
import { DouyinArticleFiller } from '../../content/article/articleFiller';

export const douyinArticleConfig = {
  url: 'https://creator.douyin.com/creator-micro/content/upload?default-tab=5',
  entryButton: 'button:has-text("我要发文")',
  filler: DouyinArticleFiller,
  selectors: {
    title: 'input[placeholder*="文章标题"]',
    summary: 'input[placeholder*="文章摘要"]',
    body: 'div[contenteditable="true"]',
    topic: '.topic-input',
    publish: 'button:has-text("发布")',
  },
};
```

---

## 十、知乎特殊说明

知乎是唯一原生支持Markdown语法输入的平台，可以简化实现：

```typescript
export class ZhihuArticleFiller implements ArticleFiller {
  async fillBody(markdown: string) {
    // 知乎支持Markdown，可以直接粘贴Markdown文本
    const editor = document.querySelector('div[contenteditable="true"]');
    
    // 使用剪贴板API粘贴Markdown
    await navigator.clipboard.writeText(markdown);
    editor.focus();
    document.execCommand('paste');
    
    // 或者直接设置innerText（知乎会自动解析Markdown）
    editor.innerText = markdown;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
```

---

## 十一、总结

### 技术可行性

**完全可行**。各平台文章编辑器的技术实现与视频/图文发布高度相似：
- 标题/摘要填充使用相同的文本输入策略
- 正文填充使用innerHTML注入 + 事件触发
- 图片上传使用相同的DataTransfer/工具栏按钮方案
- 特殊平台（知乎CDP、B站iframe）已有解决方案

### 工作量估算

| 平台 | 工作量 | 说明 |
|------|--------|------|
| 知乎 | 低 | 原生Markdown支持，直接粘贴 |
| 抖音 | 中 | contenteditable注入 |
| B站 | 高 | iframe + EVA3自定义元素 |
| 小红书 | 中 | Tiptap注入 |
| 微博 | 无 | 已支持，不需要改动 |

### 关键依赖

1. **图床服务**：需要配置至少一个图床（SM.MS免费或云存储付费）
2. **Markdown解析**：需要引入`markdown-it`库
3. **HTML清理**：需要为每个平台编写HTML过滤规则

### 建议实施顺序

1. 知乎（最简单，原生Markdown）
2. 抖音（contenteditable注入）
3. 小红书（Tiptap注入）
4. B站（iframe + 自定义元素，最复杂）
