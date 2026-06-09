# 知乎封面定位

## 最终方案

知乎视频封面必须走封面弹窗：

1. 主页面点击封面右下角“选择视频封面”。
2. 在 `.VideoCoverEditor-Modal` 内点击“本地上传”。
3. 在弹窗作用域内找到图片 `input[type=file]`。
4. 注入封面文件并触发 `input/change`。
5. 点击“确认选择”，等待弹窗关闭和主页面封面预览变化。

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
