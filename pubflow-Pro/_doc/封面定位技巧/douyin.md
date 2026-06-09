# 抖音封面定位

## 当前结论

抖音封面不能按普通封面上传处理。它的封面弹窗是分步式流程：

```text
打开封面弹窗
→ 上传横封面 4:3
→ 点击“设置竖封面”
→ 等 active step 变为“设置竖封面”
→ 上传竖封面 3:4
→ 点击“完成”
→ 等弹窗关闭
```

当前实现位置：

- 抖音内容流程：[src/platforms/douyin/content.ts](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/platforms/douyin/content.ts:21)
- 抖音页面主世界注入：[src/platforms/douyin/pageWorld.ts](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/platforms/douyin/pageWorld.ts:6)
- background 消息处理：[entrypoints/background.ts](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/entrypoints/background.ts:185)

## 页面模型

| 项 | 结论 |
| --- | --- |
| 平台 | 抖音创作者中心 |
| 发布页 | `https://creator.douyin.com/creator-micro/content/post/video` |
| 封面入口 | 主页面“设置封面”区域内的“选择封面” |
| 弹窗 | 自定义 modal，class 包含 `dy-creator-content-modal` |
| 封面数量 | 横封面 4:3、竖封面 3:4 |
| 上传组件 | Semi Design Upload，React 18 |
| 注入方式 | `chrome.scripting.executeScript({ world: 'MAIN' })` + React fiber + `foundation.handleChange([file])` |
| 点击方式 | 优先 CDP 可信点击 |

## DOM 特征

### 封面入口

平台配置：

```ts
封面: '.coverControl-CjlzqC, [class*="coverControl"], .filter-k_CjvJ, [class*="filter-k"]'
```

实际点击时需要注意：父容器不一定触发弹窗，抖音当前需要优先点子元素 `.cover-Jg3T4p`。

当前代码：

```ts
const coverElement = findVisibleElement(config.fields.cover.selectors);
const clickTarget = coverElement.querySelector<HTMLElement>('.cover-Jg3T4p') || coverElement;
clickTarget.click();
```

定位顺序建议：

1. 先用平台配置命中封面区域：

   ```css
   .coverControl-CjlzqC
   [class*="coverControl"]
   .filter-k_CjvJ
   [class*="filter-k"]
   ```

2. 在封面区域内部优先找真实预览/按钮子节点：

   ```css
   .cover-Jg3T4p
   [class*="cover-"]
   ```

3. 点击后必须验证弹窗出现，不能只认为点击成功。验证条件是弹窗文本同时包含：

   ```text
   设置横封面
   设置竖封面
   ```

抖音这里不要直接全局按文本点“选择封面”。页面有多个“选择/设置/封面”相关文案，全局文本命中容易点到非上传入口。

### 弹窗识别

弹窗候选：

```ts
'.dy-creator-content-modal-content'
'.dy-creator-content-modal'
'[role="dialog"]'
```

需要再用文本确认：

```ts
text.includes('设置横封面') && text.includes('设置竖封面')
```

原因：页面同时存在 mask、wrap、modal body 等多个容器，单纯 `[class*=modal]` 容易拿到外层节点。

### 上传组件

抖音弹窗里有多个 `.semi-upload`，不能取第一个。

| 位置 | 特征 | 作用 |
| --- | --- | --- |
| 左侧小组件 | `.semi-upload`，文本为空，可能已有 `fileList=1` | 当前预览/编辑区关联组件 |
| 右侧上传区 | `.semi-upload upload-*`，文本含“点击上传文件或拖拽文件到这里”，`fileList=0` | 真正上传入口 |

当前实现对 Upload 候选打分：

- 可见元素加分
- 文本包含“点击上传文件”或“拖拽文件”加分
- 文本包含“上传封面”加分
- class 包含 `upload-` 加分
- `fileList` 为空加分
- 尺寸合理加分

实现位置：

- [src/platforms/douyin/pageWorld.ts](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/platforms/douyin/pageWorld.ts:65)

更精确的判断方式：

1. 作用域必须限定在真实封面弹窗内，不在全页面找 `.semi-upload`。
2. 对每个 `.semi-upload` 找 React fiber，向上找 Semi Upload 组件实例。
3. 候选必须能拿到：

   ```js
   instance.foundation
   instance.foundation.handleChange
   ```

4. 优先选右侧上传区，而不是左侧预览区。右侧上传区通常满足：

   ```text
   文本包含“点击上传文件”
   文本包含“拖拽文件到这里”
   class 包含 upload-
   state.fileList 为空
   ```

5. 调用后验证：

   ```js
   instance.state.fileList.length > 0
   ```

如果只命中左侧预览区，可能表现为方法调用没有报错，但弹窗里的待保存封面没有变化。

### 按钮

当前按钮真实 DOM：

| 按钮 | 特征 |
| --- | --- |
| 完成 | `button.semi-button...`，文本为“完成” |
| 设置竖封面 | `button.semi-button...`，文本为“设置竖封面” |

MCP 检查结果：

- `elementFromPoint` 落在按钮内部 `span.semi-button-content`
- 没有遮挡层挡住按钮
- 按钮不是 disabled

问题不是定位错，而是 JS 构造点击不一定被页面接受，所以当前使用 `cdpClickElement(button)`。

按钮定位不要用固定坐标。当前正确做法是：

1. 在真实弹窗作用域内找 `button`。
2. 文本精确匹配：

   ```text
   设置竖封面
   完成
   ```

3. 排除 disabled/loading。
4. 用 `getBoundingClientRect()` 获取实时位置。
5. 通过 CDP 发送可信点击。

使用 CDP 的原因不是“坐标方便”，而是 MCP 实测已经证明：

- CSS/文本定位到了正确按钮；
- `elementFromPoint` 命中按钮内部 `span.semi-button-content`；
- 没有遮挡层；
- 按钮不是 disabled；
- 但 `.click()` / 手工派发 DOM mouse event 不稳定。

这类 React/Semi 组件需要浏览器级 `Input.dispatchMouseEvent` 更接近真实用户点击。

## 当前实现

### 1. 打开弹窗

在 content script 中定位封面入口，点击 `.cover-Jg3T4p` 或入口元素本身。

### 2. 上传横封面

content script 读取本地封面 File，转 base64，通过 runtime message 发给 background。

background 使用：

```ts
chrome.scripting.executeScript({
  target: { tabId },
  world: 'MAIN',
  func: injectDouyinCover,
  args: [fileName, fileType, fileDataBase64],
});
```

页面主世界函数：

1. base64 还原 File。
2. 在弹窗内收集 `.semi-upload`。
3. 通过 React fiber 找到 Semi Upload 实例。
4. 对候选组件打分，选中右侧真实上传区。
5. patch `adapter.notifyBeforeUpload`。
6. 调用 `foundation.handleChange([file])`。
7. 检查 `state.fileList` 是否更新。

注意：这一步是在页面主世界执行。content script 的 isolated world 里即使能看到 DOM，也不一定能稳定访问 React fiber 和组件实例。

### 3. 切换竖封面

在真实弹窗内查找“设置竖封面”按钮，优先 CDP 点击，然后等待 active step 变为“设置竖封面”。

active step 不要只靠 sleep。需要重新读取弹窗里的 step 状态，确认“设置竖封面”成为当前步骤后再上传第二次。

### 4. 上传竖封面

复用同一个 `uploadCoverViaBackground(file)`。

### 5. 保存

在真实弹窗内查找“完成”按钮，优先 CDP 点击，然后等待弹窗关闭。

如果弹窗未关闭，返回：

```text
封面已上传，但未确认弹窗保存完成。
```

## 状态验证

当前验证信号：

| 步骤 | 验证 |
| --- | --- |
| 弹窗打开 | 找到包含“设置横封面/设置竖封面”的真实弹窗 |
| 上传 | Semi Upload `state.fileList.length > 0` |
| 切换竖封面 | active step 文本包含“设置竖封面” |
| 保存 | 封面弹窗关闭 |

额外排障信号：

| 现象 | 优先检查 |
| --- | --- |
| 上传后没变化 | 是否命中右侧 Semi Upload，而不是左侧预览组件 |
| 横封面成功、竖封面没成功 | active step 是否真的切到“设置竖封面” |
| “完成”按钮点了没关闭 | 是否用了 CDP 可信点击，按钮是否 disabled/loading |
| `document.querySelector('.semi-upload')` 为 null | 注入世界是否是 MAIN，弹窗是否已打开 |

后续可以增强：

- 保存后检查主页面“横封面4:3 / 竖封面3:4”预览是否更新。
- 监听封面相关网络请求。
- 在 console 中输出横封面/竖封面每一步结果，便于排障。

## 历史方案

### 方案一：通用 `uploadCoverIfAvailable`

做法：

- 找图片 `input[type=file]`
- `DataTransfer` 注入文件
- 派发 `input/change`
- 查找保存按钮

结果：不适合抖音封面。

原因：

- 抖音封面不是简单 file input 流程。
- Semi Upload 内部状态没有稳定更新。
- 横封面和竖封面是分步流程，通用函数无法表达。

### 方案二：Blob URL 脚本注入

做法：

1. content script 读取封面 File 为 data URL。
2. 构造自执行脚本。
3. 通过 Blob URL 创建 `<script src="blob:...">` 注入页面。
4. 脚本里查 `.semi-upload`、走 React fiber、调用 `foundation.handleChange([file])`。
5. 通过 `window.postMessage` 回传结果。

结果：DevTools 控制台手动执行正常，content script 注入后不稳定。

失败表现：

- `document.querySelector('.dy-creator-content-modal-content .semi-upload')` 返回 `null`
- 或 React fiber 遍历找不到 Upload 组件实例

推测原因：

- MV3 isolated world 与页面主世界边界。
- Blob script 受 CSP 或执行时机影响。
- 页面 React 内部状态和注入脚本上下文不一致。

结论：MV3 中需要页面主世界时，优先使用官方 `chrome.scripting.executeScript({ world: 'MAIN' })`。

### 方案三：第一个 `.semi-upload`

做法：

```ts
document.querySelector('.semi-upload')
```

结果：命中错误组件。

失败原因：

- 弹窗里有多个 Semi Upload。
- 第一个通常是左侧预览/编辑组件，不是右侧“点击上传文件或拖拽文件到这里”的上传入口。

结论：多上传组件场景必须打分或用文本/状态确认。

### 方案四：普通 DOM click 保存

做法：

- 找到“完成”按钮
- 调用 `.click()` 或手工派发 pointer/mouse/click 事件

结果：定位正确，但页面不一定响应。

MCP 证明：

- 按钮坐标正确。
- `elementFromPoint` 命中按钮内部 span。
- 没有遮挡。
- 按钮未 disabled。

结论：此类 React/Semi 按钮需要 CDP 可信点击更稳。

## 后续风险

1. 抖音更新 Semi Upload 内部结构，`foundation.handleChange` 或 `_adapter` 变化。
2. 弹窗文本变化，例如“设置竖封面”改名。
3. 上传区文案变化，影响候选打分。
4. 横竖封面流程变化，例如只允许自动裁剪或增加确认步骤。

排障时优先用 MCP/DevTools 重新确认：

- 弹窗文本
- `.semi-upload` 数量
- 每个 Upload 的 `fileList`
- 按钮 DOM、坐标、遮挡
- active step class
