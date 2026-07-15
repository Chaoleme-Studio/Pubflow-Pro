# 知乎封面定位

## 最终方案

知乎视频封面必须走封面弹窗：

1. 主页面点击封面右下角“选择视频封面”。
2. 在 `.VideoCoverEditor-Modal` 内点击“本地上传”。
3. 在弹窗作用域内找到图片 `input[type=file]`。
4. 注入封面文件并触发 `input/change`。
5. 如果出现竖屏 `ReactCrop`，把可移动裁剪框调整到画布纵向中部。
6. 点击“确认选择”，等待弹窗关闭和主页面封面预览变化。

## 主页面入口

稳定入口：

```css
.VideoUploadForm-imageEditButton
[class*="VideoUploadForm-imageEditButton"]
```

实测 DOM：

```text
class="VideoUploadForm-imageEditButton css-nc5y3n"
text="选择视频封面"
cursor: pointer
onclick: true
```

不要只点 a11y 里的 `StaticText "选择视频封面"`。快照里它看起来是文本，但真实点击处理在 `.VideoUploadForm-imageEditButton` 上。

## 弹窗结构

弹窗：

```css
.VideoCoverEditor-Modal
```

弹窗文本确认：

- `选择封面`
- `本地上传`

tab：

```text
选择封面
本地上传
```

点击“本地上传”后出现图片 input：

```css
.VideoCoverEditor-Modal input[type="file"][accept*="image"]
```

实测 accept：

```text
image/png,image/jpeg,image/jpg
```

确认按钮：

```text
确认选择
```

## 竖屏 ReactCrop 居中

本地封面上传完成后，竖屏模式会出现：

```css
.ReactCrop
.ReactCrop__crop-selection
```

2026-07-12 实测画布约为 `202.5×360`，裁剪框约为 `203×271`，裁剪框可以在画布内纵向移动。居中位置必须根据当前 DOM 实时计算：

```text
targetTop = cropRect.top + (cropRect.height - selectionRect.height) / 2
deltaY = targetTop - selectionRect.top
```

处理条件：

1. `ReactCrop` 和裁剪框都存在且可见。
2. 画布明显为竖屏：`height > width × 1.15`。
3. `cropRect.height - selectionRect.height > 2`，确实存在纵向移动空间。
4. 当前位置距离中点超过 2px 才执行拖拽；已经居中时不重复操作。

拖拽通过 `CDP_DRAG` 发送可信的按下、分步移动和抬起事件。完成后重新读取裁剪框位置，确认误差不超过 4px，再继续原有“确认选择”兜底。

横屏画布不会满足上述条件，因此完全保留原流程。这里同样不根据上传前读取到的视频或封面宽高直接决定分支；视频比例只作辅助信息，知乎弹窗实际渲染出的 `ReactCrop` 几何结构才是最终依据。

## 注意事项

知乎是 React 页面，自定义按钮和 tab 不要依赖 `element.click()`。统一使用 `cdpClickElement`，也就是先用 CSS/文本定位 DOM 元素，再通过 CDP 对元素实时中心点发送可信点击。

页面上同时存在视频上传 input：

```text
.3gp,.asf,.avi,.dat,.f4v,.flv,.m4v,.mkv,.mov,.mp4,...
```

封面 input 必须限定在 `.VideoCoverEditor-Modal` 内查找，并排除 accept 含 video 的 input。

## 代码位置

平台专用实现：

- `src/platforms/zhihu/content.ts`

选择器配置：

- `src/platforms/zhihu/selectors.ts`

公共点击能力：

- `src/content/cdp.ts`

其中 `cdpClickElement` 用于可信点击，`cdpDragElement` 用于竖屏裁剪框居中。
