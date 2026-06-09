# 小红书封面定位

## 最终方案

小红书视频发布页的封面上传必须走封面编辑弹窗：

1. 在主发布页定位封面区域。
2. 通过 CDP 可信点击打开“设置封面”弹窗。
3. 用 `.d-modal.cover-modal` 内的“上传图片”文本确认弹窗进入了本地图片上传流程。
4. 在同一个弹窗作用域内找到隐藏的图片 `input[type=file]`。
5. 直接注入图片文件并触发 `input/change`，不触发系统文件选择器。
6. 点击弹窗底部“确定”，等待弹窗关闭和主页面封面预览变化。

## 主页面入口

稳定入口：

```css
.publish-page-content-cover .default.row
.publish-page-content-cover .cover-plugin-preview
.publish-page-content-cover
```

不要使用全局 `.cover-container`。小红书页面里视频上传区也有 `.cover-container`，并且里面有视频 `input[type=file]`：

```css
.cover-container input.upload-input[type=file]
```

这个 input 的 accept 是视频格式，不能用于封面。

## 入口点击技巧

### 为什么需要 CDP 而不是普通 click

最开始定位封面入口时，CSS 选择器能匹配到 `.publish-page-content-cover .default.row .operator`（即”修改封面”的触发元素），但发现它的 `getBoundingClientRect().height` 是 **0**。这个节点平时处于折叠/隐藏状态，只有鼠标放上去（hover）之后才会渲染展开，露出”修改封面”可点区域。

这就解释了为什么普通 JS `click()` 和手工鼠标事件都不生效——目标区域还没渲染出来，没有可接受点击的像素。

因此必须用 CDP（Chrome DevTools Protocol）的 `Input.dispatchMouseEvent` 先发送 `mouseMoved` 到该位置，模拟鼠标悬浮把这个区域”hover 出来”，然后再发 `mousePressed` / `mouseReleased` 完成点击。

页面上能看到”设置封面”和”修改封面”，但”修改封面”实际在：

```css
.publish-page-content-cover .default.row .operator
.publish-page-content-cover .default.row .text
```

这些节点在某些状态下可能是 `display:none` 或零尺寸。普通 JS `click()` 和手工分发鼠标事件不一定能打开弹窗。

当前实现使用公共 `cdpClickElement`：

1. 先用 CSS 找到 `.default.row` 或其内部候选元素。
2. 如果内部候选元素不可见，回退到可见的 `.default.row`。
3. 用元素实时 `getBoundingClientRect()` 计算中心点。
4. 通过 CDP 先发送 `mouseMoved` 触发 hover，再发送 `mousePressed/mouseReleased`。

这不是硬编码坐标，窗口缩放或分辨率变化时仍然跟随 DOM 元素位置。

小红书这里不能只发按下/抬起。有些状态下“修改封面”的 `.operator` 是 hover 后才出现或接管点击，公共 `cdpClickElement` 必须包含 `mouseMoved`。

## 弹窗结构

弹窗可用以下条件确认：

```css
.d-modal.cover-modal
.cover-modal
.d-modal-mask
```

文本二次确认：

- `设置封面`
- `上传图片`
- `确定`

右下角上传按钮：

```css
.cover-modal .upload-btn
```

按钮文本：

```text
上传图片
```

弹窗内图片 input：

```css
.cover-modal input[type="file"][accept*="image"]
```

实测 accept：

```text
image/png, image/jpeg, image/*
```

确认按钮：

```css
.cover-modal button.d-button
```

按钮文本：

```text
确定
```

## 失败方案记录

### 点击 a11y 文本“设置封面”

DevTools snapshot 里能看到 `StaticText "设置封面"`，但点击文本节点不会打开弹窗。真实点击入口不在标题文本上。

### 点击 `.cover-plugin-title`

`.cover-plugin-title` 是标题展示节点，cursor 为 `auto`，没有触发弹窗。

### 全局找 `input[type=file]`

页面已有视频上传 input，且 accept 是：

```text
.mp4,.mov,.flv,.f4v,.mkv,.rm,.rmvb,.m4v,.mpg,.mpeg,.ts
```

全局第一个 file input 很容易误中视频上传控件。封面 input 只有弹窗打开后才出现，必须限定在 `.cover-modal` 作用域内。

### 点击智能推荐封面

`.publish-page-content-cover .cover-image.row` 可以被点击，但它只是选择系统推荐帧，不是本地上传图片流程。

## 代码位置

平台专用实现：

- `src/platforms/xiaohongshu/content.ts`

选择器配置：

- `src/platforms/xiaohongshu/selectors.ts`

公共点击能力：

- `src/content/cdp.ts`
