# 附录：视频号 DOM 元素要点

> 本文档是视频号专项 DOM 附录，用来解释 wujie 微前端、上传区域和弹窗结构，不作为所有平台的通用选择器文档。

## 问题现象

PubFlow 扩展在视频号发布页（`https://channels.weixin.qq.com/platform/post/create`）执行自动填充时：

- **文本填充失败**：报错 `没有找到字段：div.input-editor`
- **视频上传失败**：报错 `没有找到视频上传 input`
- 其他平台（抖音、小红书、B站等）均正常

---

## 根因分析

### 1. 视频号使用了 wujie 微前端框架

视频号的发布页并非传统的单体 HTML 页面，而是使用了 [wujie（无界）](https://wujie-micro.github.io/doc/) 微前端框架。

wujie 的核心机制：

```
顶层文档 (document)
├── <wujie-app class="wujie_iframe">       ← 自定义元素
│   └── #shadow-root (open)                 ← open shadow DOM
│       ├── <html>
│       │   └── <body class="__finder-page">
│       │       ├── <div class="ant-upload ant-upload-drag">   ← 上传区域
│       │       ├── <input type="file" accept="video/*">       ← 文件上传 input
│       │       ├── <div class="input-editor">                 ← 文本编辑器
│       │       ├── <button class="weui-desktop-btn_primary">  ← 发表按钮
│       │       └── ...（共 2449 个元素）
│       └── ...
└── <iframe name="content" src="empty.html">  ← wujie 的 JS 隔离 iframe
    └── ...（shadow root 内容的镜像）
```

**关键事实**：
- `div.input-editor`（文本编辑器）和 `input[type="file"]`（视频上传）都在 `WUJIE-APP` 的 **open shadow root** 内部
- 顶层文档里**没有**这些元素
- shadow root 内包含 2449 个 DOM 元素，是一个完整的 SPA 应用

### 2. Content Script 的 Isolated World 限制

Chrome 扩展的 content script 运行在 **isolated world** 中：

| 特性 | Isolated World (Content Script) | Main World (页面脚本) |
|------|------|------|
| JavaScript 上下文 | 独立的全局对象 | 页面的全局对象 |
| DOM 访问 | 共享同一份 DOM | 共享同一份 DOM |
| `document.querySelectorAll('*')` | 返回顶层文档元素 | 返回顶层文档元素 |
| `element.shadowRoot` | **理论上可访问 open shadow root** | 可访问 |

**理论上**，content script 可以通过 `element.shadowRoot` 访问 open shadow root。MCP 测试也证实，在页面主世界里执行 `querySelectorAllDeep` 逻辑**能找到** shadow DOM 里的元素。

**但实际上**，content script 中的 `querySelectorAllDeep` 函数**无法找到** wujie shadow DOM 里的元素。原因推测是 wujie 的特殊初始化机制导致 isolated world 和 main world 对 shadow root 的访问存在差异。

### 3. 验证过程（通过 Chrome DevTools MCP）

#### 测试 1：页面主世界直接查找
```javascript
// 在 MAIN world 执行
document.querySelectorAll('div.input-editor')
// 结果: 0 个（顶层文档没有）

document.querySelector('wujie-app').shadowRoot.querySelector('div.input-editor')
// 结果: 找到了！(rect: 322x44, contentEditable: true)
```

#### 测试 2：模拟 querySelectorAllDeep 逻辑
```javascript
// 在 MAIN world 执行完整的深度遍历
function collect(root) {
  root.querySelectorAll('div.input-editor')  // 在 shadow root 里找到了
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) collect(el.shadowRoot)  // 递归进入 shadow root
  }
}
collect(document)
// 结果: 找到 2 个（shadow root 1个 + iframe 1个）
```

#### 测试 3：Content Script 中执行相同逻辑
```javascript
// 在 isolated world 执行
querySelectorAllDeep('div.input-editor')
// 结果: 0 个 ❌
```

**结论**：相同的遍历逻辑，在 main world 能找到，isolated world 找不到。

---

## 解决方案

### 核心思路

既然 content script (isolated world) 无法遍历 wujie 的 shadow DOM，就通过 **Chrome 扩展 API** 将代码注入到页面的 **main world** 中执行。

### 技术选型

| 方案 | 是否可行 | 原因 |
|------|---------|------|
| `document.createElement('script').textContent = ...` | ❌ | 被 CSP 拦截（`script-src` 不含 `'unsafe-inline'`），导致 229K+ 次 CSP 违规，页面卡死 |
| `new Function('return ...')()` | ❌ | 被 CSP 拦截（不含 `'unsafe-eval'`） |
| `chrome.scripting.executeScript({world:'MAIN', func})` | ✅ | **Chrome 扩展特权 API，绕过页面 CSP** |

### 最终架构

```
┌─────────────────────────────────────────────────────────────────┐
│ Content Script (Isolated World)                                  │
│                                                                  │
│  1. 检测到 weixinChannels 平台                                    │
│  2. 发送消息给 background:                                        │
│     browser.runtime.sendMessage({                                 │
│       type: 'EXECUTE_IN_PAGE_WORLD',                             │
│       payload: { title, topics, description }                    │
│     })                                                           │
│     或                                                            │
│     browser.runtime.sendMessage({                                 │
│       type: 'UPLOAD_FILE_IN_PAGE_WORLD',                         │
│       payload: { fileName, fileType, fileDataBase64, ... }       │
│     })                                                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Background Script (Service Worker)                               │
│                                                                  │
│  收到消息后调用 Chrome 扩展 API:                                   │
│  chrome.scripting.executeScript({                                │
│    target: { tabId },                                            │
│    world: 'MAIN',            ← 注入到页面主世界                    │
│    func: fillWeixinEditorInPageWorld,  ← 静态函数，不走 new Function│
│    args: [title, topics, description]                            │
│  })                                                              │
│  或                                                              │
│  chrome.scripting.executeScript({                                │
│    target: { tabId },                                            │
│    world: 'MAIN',                                                │
│    func: uploadFileInPageWorld,                                  │
│    args: [fileName, fileType, base64, ...]                       │
│  })                                                              │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Page Main World (注入的函数执行)                                   │
│                                                                  │
│  能访问 wujie 的 shadow DOM:                                      │
│                                                                  │
│  // 文本填充                                                      │
│  const editor = document.querySelector('wujie-app')              │
│    ?.shadowRoot?.querySelector('div.input-editor');              │
│  editor.focus();                                                 │
│  document.execCommand('insertText', false, '标题');              │
│                                                                  │
│  // 视频上传                                                      │
│  const input = document.querySelector('wujie-app')               │
│    ?.shadowRoot?.querySelector('input[type="file"]');            │
│  const dt = new DataTransfer();                                  │
│  dt.items.add(new File([base64_to_bytes(data), name, {type}));  │
│  input.files = dt.files;                                         │
│  input.dispatchEvent(new Event('change', {bubbles: true}));     │
│                                                                  │
│  return { ok: true };                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 关键实现细节

#### 1. 文本填充：`fillWeixinEditorInPageWorld`

```typescript
// background.ts — 静态函数，由 chrome.scripting.executeScript 序列化注入
function fillWeixinEditorInPageWorld(
  title: string,
  topics: string[],
  description: string,
): { ok: boolean; error?: string } {
  function findEditor(): HTMLElement | null {
    // 优先在 wujie shadow root 里查找
    const wujieApp = document.querySelector('wujie-app');
    if (wujieApp?.shadowRoot) {
      const editor = wujieApp.shadowRoot.querySelector('div.input-editor');
      if (editor) return editor as HTMLElement;
    }
    // fallback: 遍历所有 shadow root + 同源 iframe
    // ...
  }

  const editor = findEditor();
  editor.focus();
  document.execCommand('insertText', false, title);  // 已验证有效
  // ... 话题、描述填充
  return { ok: true };
}
```

#### 2. 视频上传：`uploadFileInPageWorld`

文件对象（`File`）无法跨 world 序列化传递，因此采用 **base64 中转**：

```
Content Script:  File → ArrayBuffer → Uint8Array → base64 字符串
Background:      base64 字符串作为 args 传给 chrome.scripting.executeScript
Main World:      base64 → atob → Uint8Array → new File() → DataTransfer → input.files
```

```typescript
// background.ts — MAIN world 中执行（async，因为需要等待上传完成）
async function uploadFileInPageWorld(
  fileName: string,
  fileType: string,
  fileDataBase64: string,
  acceptSelector: string,
  uploadDoneSelector: string,
  editorReadySelector: string,
  timeoutMs: number,
): { ok: boolean; error?: string } {
  // base64 → File
  const byteChars = atob(fileDataBase64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i);
  }
  const file = new File([byteArray], fileName, { type: fileType });

  // 在 shadow DOM 里找 file input
  const input = document.querySelector('wujie-app')
    ?.shadowRoot?.querySelector<HTMLInputElement>('input[type="file"]');

  // 赋值并触发事件
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // 在 MAIN world 中等待上传完成信号（能访问 shadow DOM）
  const deadline = Date.now() + timeoutMs;
  const checkSelectors = [uploadDoneSelector, editorReadySelector].filter(Boolean);
  if (checkSelectors.length > 0) {
    await new Promise<void>((resolve) => {
      const poll = () => {
        if (Date.now() > deadline) { resolve(); return; }
        for (const sel of checkSelectors) {
          if (queryDeep(sel)) { resolve(); return; }
        }
        setTimeout(poll, 500);
      };
      poll();
    });
  }

  return { ok: true };
}
```

#### 3. 就绪检测：`checkWujieReadyInPageWorld`

视频号页面的就绪信号（上传区域、编辑器）也在 shadow DOM 里，content script 无法直接检测。同样通过 MAIN world 注入检查：

```typescript
// background.ts
function checkWujieReadyInPageWorld(
  readySelector: string,
  editorSelector: string,
  fileInputSelectors: string[],
  uploadContainerSelector: string,
): boolean {
  function queryDeep(selector: string): Element | null {
    // document → shadow roots → iframes
    // ...
  }
  return !!queryDeep(readySelector) || !!queryDeep(editorSelector) || ...;
}
```

### CSP（内容安全策略）踩坑记录

视频号页面的 CSP 配置：
```
script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules'
           http://localhost:* http://127.0.0.1:*
           chrome-extension://<extension-id>/
```

| 注入方式 | 结果 | 原因 |
|---------|------|------|
| `document.createElement('script').textContent = code` | ❌ 229K 次错误，页面卡死 | CSP 不含 `'unsafe-inline'` |
| `new Function('return (code)')()` | ❌ 被拦截 | CSP 不含 `'unsafe-eval'` |
| `chrome.scripting.executeScript({func})` | ✅ 正常 | 扩展 API 特权，绕过 CSP |

**重要**：`chrome.scripting.executeScript` 的 `func` 参数必须是**静态函数引用**，不能用 `new Function` 动态构建函数体，否则 `new Function` 本身也会被 CSP 拦截。

---

## 修改的文件清单

| 文件 | 改动内容 |
|------|---------|
| `wxt.config.ts` | 添加 `'scripting'` 和 `'debugger'` 权限 |
| `src/types.ts` | 添加 `EXECUTE_IN_PAGE_WORLD`、`UPLOAD_FILE_IN_PAGE_WORLD`、`CHECK_WUJIE_READY`、`HANDLE_WEIXIN_DECLARE_POPUP`、`CDP_CLICK`、`HANDLE_WEIXIN_SCHEDULE` 消息类型 |
| `entrypoints/background.ts` | 添加消息处理器 + 静态函数：`fillWeixinEditorInPageWorld`、`uploadFileInPageWorld`、`checkWujieReadyInPageWorld`、`handleWeixinDeclarePopupInPageWorld`、`handleWeixinScheduleInPageWorld`、`cdpClick` |
| `entrypoints/content.ts` | `fillWeixinChannelsEditor` 改为发消息给 background；`hasReadyDomSignal` 改为异步检查 wujie 就绪状态；添加 `cdpClickElement` 辅助函数用于 React 组件点击 |
| `src/content/videoUploader.ts` | `uploadVideoIfAvailable` 对视频号走 base64 + MAIN world 上传路径 |
| `src/content/dom.ts` | `querySelectorAllDeep` 增加 iframe 遍历（为其他平台兜底） |

---

## 视频号定时发布（wujie Shadow DOM）

### 问题

视频号的定时发布控件在 wujie shadow DOM 中，content script 无法直接访问。

### DOM 结构

```
wujie-app → #shadow-root (open)
  └── .post-time-wrap
      ├── .label "定时发表"
      └── .form-item-body
          └── .weui-desktop-radio-group
              ├── label (含 input[type="radio"] value="0") "不定时"
              └── label (含 input[type="radio"] value="1") "定时"
```

### 解决方案

通过 `HANDLE_WEIXIN_SCHEDULE` 消息，background 使用 `chrome.scripting.executeScript({world:'MAIN'})` 注入 `handleWeixinScheduleInPageWorld` 函数：

1. 在 shadow DOM 中查找 `input[type="radio"]` 元素
2. 找到包含"定时"文本的 radio（排除"不定时"）
3. 点击 radio 按钮启用定时发布
4. 设置日期时间值

### 注意事项

- 视频号页面有弹窗提示"使用定时发表将无法保存草稿"
- 定时发表需要选择日期和时间
- 日期时间输入框的确切结构需在实际页面中验证

---

## 经验总结

1. **wujie 微前端的 shadow DOM 是隔离层**：content script 的 isolated world 可能无法正常遍历，不能假设 `element.shadowRoot` + `querySelectorAll('*')` 一定有效。

2. **CSP 是隐形杀手**：内联脚本注入在大多数网站都能工作，但遇到严格 CSP 的页面（如微信系产品）会完全失效，且错误数量级巨大（229K+），直接导致页面卡死。

3. **`chrome.scripting.executeScript` + `world: 'MAIN'` 是正确的注入方式**：它是 Chrome 扩展特权 API，绕过页面 CSP。但 `func` 参数必须是静态函数，不能用 `new Function` 包装。

4. **File 对象无法跨 world 传递**：需要 base64 中转。对于大文件（视频），base64 会增加约 33% 的体积，但对于自动上传场景可以接受。

5. **调试 MCP 非常有用**：通过 `evaluate_script` 在页面主世界直接测试 DOM 操作，能快速验证方案可行性，避免盲目修改代码反复构建。

6. **上传完成检测也必须在 MAIN world**：不仅文件上传需要在 MAIN world 执行，上传完成的信号检测（如 `uploadDoneSelector`、`editorReadySelector`）也必须在 MAIN world 中轮询。content script 的 isolated world 无法看到 shadow DOM 里的元素变化，`waitForAnySelector` 会静默超时。
