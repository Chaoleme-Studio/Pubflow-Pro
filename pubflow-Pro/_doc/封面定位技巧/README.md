# 封面定位技巧

这是一套多平台封面上传定位方法。公共文档只讲通用方案、排障顺序和公共代码能力；每个平台的特殊 DOM、失败方案和最终实现放到独立平台文档里。

平台文档：

- [抖音封面定位](./douyin.md)
- [快手封面定位](./kuaishou.md)
- [B站封面定位](./bilibili.md)
- [小红书封面定位](./xiaohongshu.md)
- [知乎封面定位](./zhihu.md)
- [视频号封面定位](./weixinChannels.md)

## 目标

封面上传通常不是“找到一个按钮点一下”这么简单。不同平台可能有标准 `input[type=file]`、React/Vue 包装组件、弹窗分步流程、裁剪器、预览保存按钮、虚拟列表或可信点击限制。

我们希望每次接入平台时按同一套顺序判断：

1. 封面入口在哪里。
2. 上传入口是什么类型。
3. 文件注入应该走标准 input、拖拽、页面主世界，还是组件内部 API。
4. 保存按钮怎么定位和点击。
5. 每一步如何确认状态真的变化。

## 总原则

1. 不硬编码屏幕坐标。坐标只能由已经定位到的 DOM 元素通过 `getBoundingClientRect()` 实时计算。
2. 先限定作用域，再查找目标。优先在当前弹窗、封面区域、最新打开的下拉内查找，不全页面扫第一个匹配项。
3. 不把 class 当唯一真相。平台构建后的 hash class 会变，class 只能作为信号之一。
4. 同名元素必须二次确认。多个上传组件、多个 input、多个“完成”按钮很常见。
5. 点击后必须验证状态变化。比如 active step 切换、预览出现、弹窗关闭，而不是只 `sleep`。

## 竖横屏判断原则

视频文件的 `videoWidth/videoHeight` 只能作为上传前的辅助信息，不能据此决定平台封面流程。平台展示的是自己的发布布局和卡片规则；同一份素材在不同平台上可能出现单封面、双封面或一张封面同时生成多种比例的情况。

尤其不要把 `3:4 / 4:3` 直接等同于某个平台的“竖屏流程 / 横屏流程”。数学比例和平台产品模式不是同一个概念：平台可能把 `3:4` 作为个人主页卡片，把 `4:3` 作为分享卡片，也可能把两者合并到一个入口处理。

最终判断顺序：

1. 等视频上传完成、平台封面区域稳定。
2. 读取平台实际 DOM 的入口数量、class、文案、弹窗标题和裁剪器尺寸。
3. 以 DOM 状态选择平台内部流程。
4. 视频宽高只用于日志、预览和兜底提示，不作为流程分支的唯一条件。

当前平台判断：

- 小红书：`.default.column` / `.default.row`。
- 视频号：“个人主页和分享卡片”的单入口，或 `.vertical-cover-wrap + .horizon-cover-wrap` 双入口。
- 知乎：是否出现高画布的 `ReactCrop`，以及裁剪框是否有纵向移动空间。

## 定位层级

### 1. CSS 定位

适用于稳定容器、输入框、按钮、弹窗、封面区域。

常用公共工具：

- [findVisibleElement](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/content/dom.ts:1)
- [waitForElement](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/content/dom.ts:128)

推荐策略：

- 入口用平台配置里的 `fields.cover.selectors`。
- 弹窗用 role/class 先定位，再用文本确认。
- 按钮用“作用域 + 文本 + 可点击状态”定位。

不要这样做：

```ts
document.querySelector('button')?.click();
document.querySelector('.semi-upload')?.click();
```

应该这样做：

```ts
const dialog = findDialogByText(['设置封面', '完成']);
const button = findScopedButton(dialog, ['完成']);
```

项目里这两个函数还未公共抽取，目前平台内有局部实现。后续建议抽到 `src/content/dialog.ts`。

### 2. 标准 file input 注入

适用于真实存在的 `input[type=file]`，且平台监听 `input/change` 事件。

核心方式：

```ts
const dataTransfer = new DataTransfer();
dataTransfer.items.add(file);
input.files = dataTransfer.files;
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

现有实现：

- [uploadCoverIfAvailable](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/content/videoUploader.ts:213)
- 视频上传的 input 注入逻辑在 [uploadVideoIfAvailable](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/content/videoUploader.ts:23)

适用平台：

- 普通 HTML file input
- 没有复杂组件状态的上传控件
- 接受图片 input 的封面弹窗

### 3. 拖拽上传

适用于页面没有暴露可用 input，但上传区域监听 drag/drop。

核心方式：

```ts
const dataTransfer = new DataTransfer();
dataTransfer.items.add(file);
container.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
container.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
container.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
```

现有视频上传里有 fallback：

- [dispatchDropUpload](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/content/videoUploader.ts:16)

注意：不少现代框架会检查事件来源或内部状态，拖拽并不一定比 input 注入更稳。

### 4. 页面主世界执行

适用于 content script isolated world 无法访问页面框架状态的情况。

典型信号：

- DevTools 控制台里执行有效，但 content script 注入无效。
- DOM input 事件触发了，但组件 state 不更新。
- 需要访问 React fiber、Vue 实例、组件内部方法。

公共方式：

- background 使用 `chrome.scripting.executeScript({ world: 'MAIN' })`
- 注入函数必须自包含，不能引用外部变量或 import

参考实现：

- 视频号页面主世界分发：[runWeixinChannelsPageWorldAction](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/platforms/weixinChannels/pageWorld.ts:15)
- 抖音封面注入：[injectDouyinCover](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/platforms/douyin/pageWorld.ts:6)

### 4.1 Vue2/React 组件状态探测

有些平台真实 `input[type=file]` 能被赋上 `File`，但页面仍然没有变化。这个时候不要继续堆 `input/change` 事件，应该检查框架组件状态。

典型 Vue2 检查方式：

```js
const uploader = document.querySelector('.single-cover-uploader-wrap')
const vm = uploader && uploader.__vue__
Object.keys(vm).filter((key) => typeof vm[key] === 'function')
```

视频号实测 `.single-cover-uploader-wrap` 上有 Vue2 实例，包含：

```text
onInputChange
handleUpload
handleCropping
handleCroppingSuccess
handleSuccess
handleCropVisibleChange
```

关键判断不是 `input.files.length === 1`，而是组件状态有没有变化。例如：

```js
vm.croppingFile
vm.imgSrc
vm.customCoverPreviewUrl
vm.isCropping
```

视频号案例里，普通 DOM `change` 和直接调用 `onInputChange(event)` 后，`input.files` 已经有文件，但 `croppingFile/imgSrc/isCropping` 没变，说明失败点不是无界 iframe，而是 Vue 上传组件没有接受这条普通 DOM 注入链路。继续收窄后发现 `handleUpload(file)` 会触发真实上传，耗时长且不稳定同步外层弹窗；最终稳定入口是沿 Vue 父链找到外层 `edit-cover-dialog-container.handleCustomCoverChange(canvas)`。

React 组件则优先检查 fiber 和组件 state，例如抖音 Semi Upload 的 `foundation.handleChange([file])`。但这类内部 API 脆弱，必须在平台文档里记录方法名、状态验证和失败现象。

### 5. CDP 可信点击

适用于元素已经正确定位，但页面不接受 JS `click()` 或手工构造的鼠标事件。

CDP 点击不是写死坐标。正确流程是：

1. 用 CSS/文本/DOM 作用域找到真实元素。
2. 用 `getBoundingClientRect()` 计算当前元素中心点。
3. 通过 Chrome DevTools Protocol `Input.dispatchMouseEvent` 发送浏览器级点击。

现有实现：

- [cdpClickElement](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/content/cdp.ts:7)
- background handler：[cdpClick](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/entrypoints/background.ts:479)

适用场景：

- React/Semi/Ant 等组件不响应 JS click。
- `elementFromPoint` 确认没有遮挡，按钮 visible 且 enabled，但 `.click()` 无效。
- 需要模拟更接近真人的鼠标点击。
- 元素只有 hover 后才展开或获得可点击区域。此时 CDP 点击必须先发 `mouseMoved` 触发 hover，再发 `mousePressed/mouseReleased`。

不适用场景：

- 元素还没定位准。
- 按钮被遮挡。
- 页面还在 loading 或按钮 disabled。
- 想用固定坐标绕过 DOM 定位。

## 推荐接入流程

### 第一步：记录平台封面模型

在平台文档里先写清楚：

| 项 | 内容 |
| --- | --- |
| 封面入口 | 页面上打开封面编辑的位置 |
| 弹窗/面板 | 是否弹窗、抽屉、内嵌区域 |
| 封面数量 | 单封面、横竖两套、PK 封面等 |
| 上传方式 | file input、拖拽、组件内部 API |
| 保存方式 | 自动保存、完成按钮、确认按钮 |
| 验证信号 | 预览图、弹窗关闭、按钮状态、网络请求 |

### 第二步：最小只读探测

用 DevTools/MCP 先读：

- 弹窗 DOM
- file input 列表和 accept
- 上传组件数量
- 按钮文本、disabled、坐标、遮挡情况
- 点击前后的 active step 或预览状态

关键检查：

```js
document.querySelectorAll('input[type=file]')
document.querySelectorAll('.semi-upload, [class*=upload]')
document.elementFromPoint(x, y)
```

### 第三步：选择上传策略

优先级：

1. 标准 file input 注入。
2. 拖拽 drop。
3. 页面主世界执行标准 input 或组件方法。
4. 框架内部 API，例如 React fiber + Upload foundation。

### 第四步：选择点击策略

优先级：

1. 原生 `.click()`。
2. 完整 DOM 鼠标事件链：`pointerdown/mousedown/pointerup/mouseup/click`。
3. CDP 可信点击。
4. 调用框架内部 handler。这个最脆，除非必须。

### 第五步：状态验证

每个平台必须定义验证信号：

- 上传后：input files、预览图、组件 `fileList`、本地 URL、上传成功标记。
- 下一步后：active tab/step 是否变化。
- 保存后：弹窗是否关闭、主页面封面预览是否更新。

## 建议抽取的公共代码

目前公共能力已经有 `dom.ts`、`cdp.ts`、`videoUploader.ts`。后续可以把平台里重复出现的弹窗定位逻辑抽到公共模块。

建议新增：

| 函数 | 建议位置 | 作用 |
| --- | --- | --- |
| `findDialogByText(texts)` | `src/content/dialog.ts` | 通过文本确认真实弹窗，避开 mask/wrap |
| `findScopedButton(scope, texts)` | `src/content/dialog.ts` | 在指定容器内按文本找按钮 |
| `waitForScopedButton(scopeGetter, texts, timeout)` | `src/content/dialog.ts` | 等待按钮可点击 |
| `isClickableElement(el)` | `src/content/dom.ts` | 统一判断 visible、disabled、loading、尺寸 |
| `clickElementReliable(el)` | `src/content/cdp.ts` | DOM click 失败时 fallback 到 CDP |
| `scoreUploadCandidate(el)` | `src/content/uploadLocator.ts` | 多上传组件时按文本、可见性、accept、state 打分 |

抽取原则：

- 公共代码只做“定位和点击能力”，不写平台业务判断。
- 平台文档和平台代码负责提供文本、选择器、状态验证条件。
- 不把抖音的 `设置横封面/设置竖封面` 写进公共工具。

## 平台文档模板

新增平台时建议复制以下结构：

```md
# 平台名封面定位

## 当前结论

## 页面模型

## DOM 特征

## 当前实现

## 状态验证

## 历史方案

## 后续风险
```
