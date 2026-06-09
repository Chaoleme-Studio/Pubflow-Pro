# 平台自动化技术实现文档

每个平台发布页都有自己的前端框架和交互机制。本文档详细记录每个平台使用了什么技术、遇到了什么障碍、以及我们如何突破这些障碍实现自动化。

---

## 架构概览

```
content.ts (入口，~270 行)
  → getPlatformByUrl()          // 识别当前平台
  → reportPageStatus()          // 检测页面就绪/阻挡
  → observePageReady()          // MutationObserver 监听
  → getPlatformContentHandler() // 分发到各平台 handler

每个平台 src/platforms/<平台>/content.ts
  → uploadVideoIfAvailable()    // 视频上传
  → fillField() / fillTopics()  // 文本填充
  → uploadCoverIfAvailable()    // 封面上传
  → fillScheduled()             // 定时发布
  → fillDeclarationDropdown()   // 创作声明
  → fillVisibility()            // 谁可以看

特殊平台
  → weixinChannels/pageWorld.ts // MAIN world 注入（Shadow DOM）
  → cdp.ts                      // CDP 可信点击（React 组件）
```

---

## 通用技术方案

### 视频上传：DataTransfer 注入

浏览器禁止脚本直接设置 `input[type=file].value`。我们的方案：

```typescript
// 1. 从扩展存储恢复 File 对象
const file = await loadVideoForTransfer(content.videoCacheId);

// 2. 通过 DataTransfer 设置到 file input
const dataTransfer = new DataTransfer();
dataTransfer.items.add(file);
input.files = dataTransfer.files;

// 3. 触发 change 事件让框架感知
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

视频文件的跨 tab 传输流程：
```
用户选择视频
  → Dashboard 把 File 切成 chunk
  → 写入 chrome.storage.local
  → Background 打开平台页
  → Content script 读取 chunk，还原 File
  → DataTransfer 注入 file input
```

### 文本填充：三种策略

| 策略 | 适用场景 | 原理 |
|------|----------|------|
| `pasteLike` | 普通 input/textarea | `nativeValueSetter` 直接设值 + clipboard 事件 |
| `contentEditable` | 富文本编辑器 | `document.execCommand('insertText')` |
| `simulateTyping` | 话题标签（需要逐字触发补全） | 逐字符 keydown/keyup + input 事件 |

### CDP 可信点击

某些 React 组件不响应 `element.click()` 或 `dispatchEvent(new MouseEvent(...))`。需要通过 Chrome DevTools Protocol 发送浏览器级鼠标事件：

```typescript
// content.ts: 获取元素坐标
const rect = el.getBoundingClientRect();
const x = rect.left + rect.width / 2;
const y = rect.top + rect.height / 2;

// 发送给 background
await browser.runtime.sendMessage({
  type: 'CDP_CLICK',
  payload: { x, y },
});

// background.ts: 通过 chrome.debugger 发送真实鼠标事件
await chrome.debugger.attach(debuggee, '1.3');
await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
  type: 'mousePressed', x, y, button: 'left', clickCount: 1,
});
await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
  type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
});
await chrome.debugger.detach(debuggee);
```

---

## 各平台技术详情

### 抖音 (douyin)

**技术栈**：React + Semi Design (字节跳动内部 UI 库)

**页面结构**：标准 React SPA，所有元素在主文档中，无 Shadow DOM。

**就绪检测**：
- 选择器：`.container-drag-VAfIfu, .semi-input.semi-input-default, .editor-comp-publish`
- Semi Design 组件的 class 名带 hash 后缀（如 `-VAfIfu`），版本更新后可能变化

**突破点**：
- 标题是 `input.semi-input`，标准 input，用 `nativeValueSetter` 设值
- 简介是 `div.editor-kit-container[contenteditable]`，用 `execCommand('insertText')`
- 声明下拉触发器 `.selectText-XSrMFZ` 是自定义 div，点击后搜索 `[role="option"]`
- 定时发布用 checkbox 触发，时间输入是 `input.semi-input[placeholder="日期和时间"]`

**需要激活标签页**：是（抖音检测 `document.visibilityState`）

---

### 小红书 (xiaohongshu)

**技术栈**：React + 自定义组件

**页面结构**：标准 React SPA，无 Shadow DOM。

**突破点**：
- 标题是 `input.d-text`，标准 input
- 简介是 `div.tiptap.ProseMirror`（基于 Tiptap/ProseMirror 富文本编辑器），用 `execCommand`
- 声明用 toggle 开关 `.d-switch-box`，点击后弹出确认对话框
- 定时发布用 switch 开关，时间输入是 `.d-datepicker-input-filter input`

**需要激活标签页**：是

---

### 视频号 (weixinChannels) — 大坑

**技术栈**：Vue + **Wujie（无界）微前端框架**

**这是最复杂的平台**。视频号发布页不是传统的单体 HTML，而是使用了 [wujie](https://wujie-micro.github.io/doc/) 微前端框架，把真正的表单隔离在 Shadow DOM 中。

#### Wujie 的页面结构

```
顶层文档 (document)
├── <wujie-app>                    ← 自定义元素
│   └── #shadow-root (open)        ← open shadow DOM
│       ├── <html>
│       │   └── <body>
│       │       ├── div.ant-upload.ant-upload-drag   ← 上传区域
│       │       ├── input[type="file"][accept="video"] ← 文件上传
│       │       ├── div.input-editor                  ← 文本编辑器
│       │       ├── button.weui-desktop-btn_primary   ← 发表按钮
│       │       └── ...（2449 个元素，完整 SPA）
│       └── ...
└── <iframe name="content">        ← wujie 的 JS 隔离 iframe
    └── ...（shadow root 的镜像）
```

#### 为什么 Content Script 无法访问

Chrome 扩展的 content script 运行在 **isolated world** 中。理论上 isolated world 可以通过 `element.shadowRoot` 访问 open shadow root。但实际上：

```javascript
// 在 MAIN world 执行 → 找到！
document.querySelector('wujie-app').shadowRoot.querySelector('div.input-editor')

// 在 isolated world 执行相同逻辑 → 找不到！
// 原因：wujie 的特殊初始化机制导致 isolated world 和 main world 对 shadow root 的访问存在差异
```

**这是 wujie 框架特有的问题**，其他使用 Shadow DOM 的框架（如 Lit、Stencil）不会出现。

#### 解决方案：MAIN World 注入

既然 content script (isolated world) 无法访问 wujie shadow DOM，就通过 `chrome.scripting.executeScript({ world: 'MAIN' })` 将代码注入到页面的 main world 中执行。

```typescript
// background.ts: 注入到 MAIN world
const results = await chrome.scripting.executeScript({
  target: { tabId },
  world: 'MAIN',
  func: runWeixinChannelsPageWorldAction,
  args: ['fillEditor', { title, topics, description }],
});
```

所有 MAIN world 函数统一放在 `src/platforms/weixinChannels/pageWorld.ts` 的 dispatcher 中：

```typescript
// pageWorld.ts: 单一入口 dispatcher
export async function runWeixinChannelsPageWorldAction(
  action: 'fillEditor' | 'uploadFile' | 'handleDeclarePopup' | 'checkReady' | 'handleSchedule',
  payload: Record<string, unknown>,
): Promise<unknown> {
  // helper 函数必须在同一函数体内（executeScript 序列化限制）
  function queryDeep(selector: string): Element | null { ... }
  function queryDeepAll(selector: string): Element[] { ... }

  if (action === 'fillEditor') return fillEditor();
  if (action === 'uploadFile') return uploadFile();
  // ...
}
```

#### 视频上传的特殊处理

标准平台用 content script 直接操作 file input。视频号需要在 MAIN world 中找到 shadow DOM 内的 input：

```typescript
// pageWorld.ts 的 uploadFile
function findVideoInput(): HTMLInputElement | null {
  const wujieApp = document.querySelector('wujie-app');
  if (wujieApp?.shadowRoot) {
    const inputs = wujieApp.shadowRoot.querySelectorAll('input[type="file"]');
    for (const inp of inputs) {
      if (inp.accept && inp.accept.includes('video')) return inp;
    }
  }
  // 遍历所有 shadow root...
}
```

视频文件需要先转为 base64 传入 MAIN world（因为 `executeScript` 的 args 只能传可序列化数据）：

```typescript
// content.ts: 转 base64
const reader = new FileReader();
reader.readAsDataURL(file);
const base64 = reader.result.split(',')[1];

// 传给 background → 注入 MAIN world → 还原 File → 注入 input
```

#### 定时发布的特殊处理

视频号的日期时间输入是 `readonly` 的，`nativeValueSetter` 无效。解决方案：

1. 点击 readonly input 打开日历弹窗
2. 找到日历中的目标日期链接（`<a>` 标签）
3. 点击日期链接
4. 找到时间 textbox，用 `nativeValueSetter` 设值
5. 点击 body 关闭弹窗

#### 关键文件

- `src/platforms/weixinChannels/pageWorld.ts` — MAIN world 注入函数（dispatcher 模式）
- `src/platforms/weixinChannels/content.ts` — content script 侧调度
- `src/platforms/weixinChannels/selectors.ts` — 选择器配置

---

### B站 (bilibili)

**技术栈**：Vue + BCC 组件库（B站自研）

**页面结构**：标准 Vue SPA，无 Shadow DOM。

**突破点**：
- 标题是 `div.video-title-content[contenteditable]`，用 `execCommand`
- 简介是 `div.archive-info-editor[contenteditable]`，用 `execCommand`
- 话题/标签是 `input[placeholder*="标签"]`，用 `simulateTyping` + Enter 确认
- 声明是 `input.bcc-select-input-inner[placeholder*="创作声明"]`，点击后搜索选项
- 分类有独立 API 接口获取分类列表

**超时**：240 秒（最长，B站视频处理较慢）

**需要激活标签页**：否

---

### 快手 (kuaishou)

**技术栈**：React + CSS Modules

**页面结构**：标准 React SPA。class 名带 hash 后缀（如 `._dragger-content_1j3uy_39`）。

**突破点**：
- **没有标题字段**，只有简介
- 简介是 `div[class*="edit-desc-container"][contenteditable]`
- 定时发布用 radio 触发，时间输入是 `input[placeholder="选择日期时间"]`
- 同框/下载开关用 checkbox 控制

**需要激活标签页**：是

---

### 微博 (weibo)

**技术栈**：自定义组件（wbpro 组件库）

**页面结构**：标准页面，无 Shadow DOM。

**突破点**：
- **没有标题字段**，简介是整个 `.wbpro-form` 区域
- 声明区有三种状态（初始态/展开态/确认态），需要先点击 `compactTrigger` 展开面板再选中选项
- **不支持单独上传封面**：如果同时上传视频和图片，微博会将其视为多图发布，变成图文混排的多图排列布局，而非视频加自定义封面。因此插件只上传视频，封面由视频前几帧自动截取
- 可见性（公开/好友圈/仅自己可见等）通过 `woo-pop-ctrl` 下拉菜单选择，触发元素是 `div[class*="_es_1oo0f_"]`
- 功能最少的平台之一

**需要激活标签页**：否

---

### 知乎 (zhihu) — React 组件陷阱

**技术栈**：React + 自定义组件

**页面结构**：标准 React SPA，但**所有自定义组件不响应 `element.click()`**。

#### 核心问题：React 事件系统

知乎的 React 组件使用合成事件系统（SyntheticEvent）。普通的 DOM 事件（包括 `dispatchEvent(new MouseEvent(...))`）无法触发 React 的事件处理器。

```javascript
// 这些都不行：
element.click();                              // ❌
element.dispatchEvent(new MouseEvent('click')); // ❌
element.dispatchEvent(new PointerEvent('click')); // ❌

// 直接调用 React onClick handler 也不行：
const reactProps = Object.keys(el).find(k => k.startsWith('__reactProps$'));
el[reactProps].onClick(syntheticEvent); // ❌
```

**唯一有效方案**：通过 CDP 发送浏览器级 `Input.dispatchMouseEvent`。

#### 视频标记弹窗

弹窗结构：
```html
<div class="Modal-wrapper">
  <div class="Modal VideoUploadForm-videoTypeModal">
    <div class="VideoUploadForm-videoTypeModalContent">
      <div class="VideoUploadForm-videoTypeModalTitle">添加视频标记</div>
      <div class="VideoUploadForm-videoTypeModalOptions">
        <!-- 选项是 div[role="button"]，不是 <button> 也不是 [role="option"] -->
        <div class="VideoUploadForm-videoTypeModalOption" role="button" tabindex="0">
          <span>内容无需标注</span>
          <div class="VideoUploadForm-videoTypeModalIcon">
            <svg class="ZDI--CheckFill24"><!-- 勾选图标 --></svg>
          </div>
        </div>
        <div class="VideoUploadForm-videoTypeModalOption" role="button" tabindex="0">
          <span>含 AI 生成内容</span>
        </div>
        ...
      </div>
    </div>
    <div class="ModalButtonGroup">
      <button>取消</button>
      <button>确认</button>
    </div>
  </div>
</div>
```

**陷阱**：
1. 选项是 `div[role="button"]`，不是 `button` 也不是 `[role="option"]` — 选择器必须用 `.VideoUploadForm-videoTypeModalOption`
2. "内容无需标注" 是默认已选中（有勾选 SVG 图标），不需要点击
3. 弹窗的 "取消"/"确认" 是标准 `<button>`，可以被 `cdpClickElement` 触发

#### 定时发布

定时发布开关是隐藏的 checkbox（宽高为 0），包裹在 `<label>` 里：
```html
<div class="VideoUploadForm-item VideoUploadForm-scheduledPublish">
  <span class="VideoUploadForm-itemTitle">定时发布</span>
  <label class="VideoUploadForm-scheduledPublish--switch">
    <input type="checkbox" class="css-1i5t6yb" value="">
  </label>
</div>
```

**陷阱**：
- checkbox 宽高为 0，`input.click()` 无效
- 需要点击 `<label>` 容器（通过 CDP）
- 勾选后出现日期按钮 `button "2026/05/20"` 和时间 combobox
- 日期选择器是 `td.Calendar-day`，禁用的有 `is-disabled` class
- 时间 combobox 的选项是标准 `[role="option"]`
- **时间 combobox 的大坑**：CDP 点击选项后 React 状态更新（combobox value 变化），但下拉菜单不会自动关闭。如果连续选择小时和分钟，旧下拉菜单的 `[role="option"]` 会残留在 DOM 中，干扰后续选择。解决方案：每次选择前通过 `document.body.click()` 关闭残落下拉菜单（`dispatchEvent(mousedown)` 无效，必须用 `.click()` 触发完整的 mousedown→mouseup→click 序列），并将选项搜索限定在最新打开的 `[role="listbox"]` 内

#### 所属领域

所属领域 combobox 的选项也是标准 `[role="option"]`，但触发器是 `button[role="combobox"]`（第二个，value="选择领域"）。

---

### 西瓜视频 (xigua)

**技术栈**：Vue + 自定义组件

**当前状态**：**已禁用**（`enabled: false`），配置最简陋。

**突破点**：
- 标题是 `input[placeholder*="标题"]`，标准 input
- 简介是 `textarea[placeholder*="简介"]`，标准 textarea
- 没有声明、定时发布等特殊控件

---

## 技术对比总结

| 平台 | 框架 | 难点 | 突破方案 |
|------|------|------|----------|
| 抖音 | React/Semi | hash class 名 | 多选择器 fallback |
| 小红书 | React/Tiptap | ProseMirror 编辑器 | `execCommand` |
| **视频号** | **Vue/Wujie** | **Shadow DOM 隔离** | **MAIN world 注入** |
| B站 | Vue/BCC | 分类 API | 独立 API 调用 |
| 快手 | React/CSS Modules | 无标题字段 | 只填简介 |
| 微博 | wbpro | 功能最少 | 最简流程 |
| **知乎** | **React** | **不响应 click + 后台延迟渲染** | **CDP 可信点击 + 激活标签页** |
| 西瓜 | Vue | 已禁用 | - |

### 需要特殊处理的平台

1. **视频号**：wujie Shadow DOM → `chrome.scripting.executeScript({ world: 'MAIN' })`
2. **知乎**：React 合成事件 → `chrome.debugger` + `Input.dispatchMouseEvent`
3. **抖音/小红书/快手/知乎/西瓜/视频号**：需要激活标签页（检测 `document.visibilityState` 或后台标签页延迟渲染）

### 标签页激活策略

部分平台要求标签页处于前台才能正常工作。在 `selectors.ts` 中通过 `需要激活标签页: true` 标记：

| 平台 | 需要激活 | 原因 |
|------|:---:|------|
| 抖音 | 是 | 检测 `document.visibilityState`，后台不渲染上传组件 |
| 小红书 | 是 | 同上 |
| 快手 | 是 | 同上 |
| 视频号 | 是 | Shadow DOM 需要活跃上下文 |
| 西瓜 | 是 | 同上 |
| 知乎 | 是 | 后台标签页延迟渲染，上传区域不加载 |
| B站 | 否 | 不受影响 |
| 微博 | 否 | 不受影响 |

标记后，`background.ts` 打开平台标签页时会设置 `active: true`，自动切到前台。
