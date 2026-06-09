# 视频号封面定位

## 当前结论

视频号封面通过页面主世界脚本 + Vue 组件内部状态写入。最终稳定方案不是直接 file input，也不是上传组件的 `handleUpload(file)`，而是打开对应封面编辑弹窗后，把本地封面转成 `HTMLCanvasElement`，直接调用外层 `edit-cover-dialog-container.handleCustomCoverChange(canvas)`。

### 已验证的 Bug 修复 (2026-05-20)

1. **`waitForCroppieResult` 缓存的 croppieRef 过时**: `uploader` 和 `croppieRef` 在循环外获取后不再更新。`handleCropping(file)` 触发 Vue 组件重渲染会导致 `__vue__.$refs.croppieRef` 指向新的 Croppie 实例。修复：将 `findCoverUploader(dialog)` 和 `croppieRef` 获取移入 while 循环内部。

2. **`waitForUploaderPreview` 缓存的 uploader 过时**: 裁剪确认后 Vue 可能重新渲染 `.single-cover-uploader-wrap`。修复：将 `findCoverUploader` 移入 while 循环内部。

3. **`triggerCoverUploader` 双重触发**: `assignInputFile` 设置 input.files + 派发 change 事件后，Vue 的 `@change` handler 被触发（可能内部调用 `handleCropping`），然后代码又直接调用 `vueUploader.handleCropping(targetFile)`。导致 `handleCropping` 被调用两次。修复：常规上传链只作为回退，不作为主路径。

4. **`handleUpload(file)` 不是本地预览入口**: 实测 `handleUpload(file)` 会进入真实上传链路，等待时间很长，并且只更新上传组件自身状态，不稳定同步外层编辑弹窗的 `customCover`。主路径改为直接写外层 `handleCustomCoverChange(canvas)`。

## 页面结构

视频号发布页运行在腾讯自研的 wujie 容器里。真实表单不在普通 document 里，而是在：

```css
wujie-app.shadowRoot
```

普通 `document.querySelector()` 找不到真实发布表单。项目里通过 `runWeixinChannelsPageWorldAction` 在页面主世界执行，并使用 `queryDeep/queryDeepAll` 穿透 open shadowRoot。

## 封面入口

视频号有两个封面预览：

```css
.vertical-cover-wrap
.horizon-cover-wrap
```

含义：

- `.vertical-cover-wrap`：个人主页卡片，比例 `3:4`
- `.horizon-cover-wrap`：分享卡片，比例 `4:3`

两个入口都需要上传同一张封面，并分别确认。

## 上传流程

每个入口点击后会打开外层编辑弹窗：

```css
.finder-common-dialog.edit-cover-dialog .weui-desktop-dialog__wrp
```

弹窗标题：

- `编辑个人主页卡片`
- `编辑分享卡片`

弹窗内本地上传 input：

```css
.single-cover-uploader-wrap input[type="file"]
```

实测 accept：

```text
image/jpeg,image/jpg,image/png
```

这里有一个视频号特有的坑：给 input 直接赋 `files` 并派发 `input/change`，input 自己会显示 `files.length === 1`，但 Vue 上传组件不会进入有效封面替换流程。因此不能只做普通 file input 注入。

当前实现会先打开外层编辑弹窗，找到上传组件：

```css
.single-cover-uploader-wrap
```

然后沿 Vue2 父链找到外层编辑组件：

```js
uploader.__vue__.$parent... // .edit-cover-dialog-container
```

外层组件有 `handleCustomCoverChange(canvas)`，并且内部期望参数是 `HTMLCanvasElement`，因为它会调用 `canvas.toDataURL()` 并更新：

- `customCover`
- `customCoverPreviewUrl`
- `previewImageUrl`
- `currentCoverImageUrl`

所以主路径是：

```js
const canvas = await fileToCanvas(file)
editCoverDialogVm.handleCustomCoverChange(canvas)
```

实测这样会直接替换外层编辑弹窗右侧预览，不需要额外打开“裁剪封面图”弹窗，也不需要点裁剪弹窗里的 `确定`。

注意：不要只把 `.vertical-cover-wrap` / `.horizon-cover-wrap` 当成最终点击目标。视频号的封面预览同时绑定了素材浮层，点击封面图片区域时可能只出现：

```text
使用此素材作为封面？
直接编辑
使用素材
```

稳定流程是优先找：

```css
.vertical-cover-wrap .edit-btn
.horizon-cover-wrap .edit-btn
```

如果没有直接打开编辑弹窗，则等待素材浮层并点击 `直接编辑`，再进入外层编辑弹窗。这个仍然是 CSS/文本定位，不依赖固定坐标。

回退路径才会出现内层裁剪弹窗：

```text
裁剪封面图
```

这里不要直接点击内层 `确定`。如果不得不走 Croppie 回退，需要先确认 Croppie 能返回有效图片：

```js
uploader.__vue__.$refs.croppieRef.result({
  type: 'base64',
  format: 'png',
  size: 'viewport'
})
```

返回值必须是 `data:image/png;base64,...` 且长度足够。若结果是 `data:,`，表示裁剪结果为空，后续预览会闪一下然后回到旧封面或显示空图。

拿到有效 base64 后，把它转成 Canvas，再调用外层 `handleCustomCoverChange(canvas)`，最后点外层 `确认`。

点击按钮时不要重复触发 click。视频号的 Vue 组件对裁剪 `确定` 这类按钮比较敏感，如果同时派发 `MouseEvent('click')` 又调用 `el.click()`，等于点了两次。第一次可能生成有效封面，第二次在裁剪弹窗关闭或隐藏后再次执行，可能把结果覆盖成 `data:,`，表现为封面闪一下、弹窗预览变白、后续按钮像不可用。

最新实测更稳定的路径是不点裁剪弹窗的 `确定`，而是：

1. 用 `croppieRef.result({ type: 'base64', format: 'png', size: 'viewport' })` 拿到有效 base64
2. 把 base64 加载成 `Image`
3. 画到 `HTMLCanvasElement`
4. 沿 Vue 父链找到 `edit-cover-dialog-container`
5. 调用父组件 `handleCustomCoverChange(canvas)`

父组件的 `handleCustomCoverChange` 期望的是 Canvas，因为内部会调用 `e.toDataURL()`。传 base64、Blob 或 `{ url }` 都不对，会导致 `e.toDataURL is not a function` 或预览继续停在 `data:,`。

最终顺序：

1. 等待封面预览区域不再显示 `生成中`
2. 点击 `.vertical-cover-wrap .edit-btn`，或通过素材浮层点 `直接编辑`
3. 把本地封面文件转成 Canvas
4. 调用外层 `edit-cover-dialog-container.handleCustomCoverChange(canvas)`
5. 点击“编辑个人主页卡片”的 `确认`
6. 点击 `.horizon-cover-wrap .edit-btn`，或通过素材浮层点 `直接编辑`
7. 把本地封面文件转成 Canvas
8. 调用外层 `edit-cover-dialog-container.handleCustomCoverChange(canvas)`
9. 点击“编辑分享卡片”的 `确认`

## 自动封面生成等待

视频上传完成后，视频号会自动生成个人主页卡片和分享卡片两个封面。生成期间页面可能显示：

```text
生成中
```

如果这时立即上传自定义封面，容易和平台自动生成流程冲突。当前实现把等待放在 `uploadCover()` 内部：进入封面流程前先确认 `.vertical-cover-wrap` 和 `.horizon-cover-wrap` 可见，并且封面预览区域不再包含 `生成中`。

## 短标题

视频号有独立“短标题”字段，它对应其他平台的视频标题。

输入框：

```css
input[placeholder*="概括视频主要内容"]
```

当前实现用 `content.title` 填入短标题，并裁剪到 16 个字符，符合页面提示“字数建议6-16个字符”。

视频号短标题对符号限制很严格。实测错误：

```text
标题包含特殊字符，符号仅支持书名号、引号、冒号、加号、问号、百分号、摄氏度，逗号可用空格代替
```

因此填充前会把逗号、顿号、句号、感叹号、分号、括号、斜杠等常见不支持标点替换为空格，再折叠连续空格。例如：

```text
大爱仙尊,大爱无疆 -> 大爱仙尊 大爱无疆
```

## 失败方案记录

### 只上传一个封面

只处理第一个图片 input 会漏掉另一个比例。视频号需要同时设置个人主页卡片 `3:4` 和分享卡片 `4:3`。

### 全局找图片 input

页面里有很多隐藏弹窗和多个历史组件。必须先打开对应外层编辑弹窗，再在这个弹窗作用域内找 `.single-cover-uploader-wrap input[type=file]`。

### 只派发 input/change

实测 input 能被赋上 File，但视频号的 Vue 上传组件不会响应普通 DOM 事件，表现为页面仍停留在视频帧封面，裁剪弹窗不出现。需要走 `.single-cover-uploader-wrap.__vue__.handleCropping(file)`。

### 调用上传组件 `onInputChange(event)`

实测直接构造 `change` 事件并调用 `uploader.__vue__.onInputChange(event)`，同样不会稳定改变外层 `edit-cover-dialog-container` 的 `customCover/previewImageUrl`。它不能等价于用户在系统文件选择器里选文件。

### 调用上传组件 `handleUpload(file)`

实测 `handleUpload(file)` 会进入真实上传链路，可能等待很久，上传组件自身的 `uploadPercent/imgSrc` 会变化，但外层弹窗 `customCover` 仍可能不变。因此不能把它作为本地封面替换入口。

### 只点外层确认

注入图片后先出现“裁剪封面图”内层弹窗。如果不点内层 `确定`，外层确认不会真正保存新封面。

### 过早点裁剪确定

如果裁剪弹窗刚出现就立刻点 `确定`，可能出现本地封面闪一下、图片很大、随后恢复旧封面的现象。实测这时组件状态会变成 `imgSrc: "data:,"`、`customCoverPreviewUrl: "data:,"`。必须等待 Croppie `result()` 返回有效 base64，并等待上传组件预览回写完成。

### 重复点击裁剪确定

如果点击函数既派发 `MouseEvent('click')`，又调用 `el.click()`，裁剪 `确定` 会被执行两次。第二次可能发生在裁剪弹窗已经关闭或 Croppie 容器隐藏后，导致组件把有效结果覆盖为 `data:,`。按钮点击应保持单次触发。

### 给父组件传错类型

上传组件的父链里 `edit-cover-dialog-container.handleCustomCoverChange` 会把参数当 Canvas 用，内部调用 `toDataURL()`。传字符串、Blob、对象都会失败或不同步右侧预览；必须传 `HTMLCanvasElement`。

### 只点封面容器

点 `.vertical-cover-wrap` 或 `.horizon-cover-wrap` 的中心区域，可能只打开素材浮层，不会打开“编辑个人主页卡片/编辑分享卡片”弹窗。后续找 input 和点确认都会落空。

### 不等待自动生成封面

视频刚上传完成时，视频号还会生成两个默认封面。页面出现 `生成中` 时就开始自定义上传，可能被后续自动生成覆盖，或者入口状态还没稳定。

## 代码位置

页面主世界实现：

- `src/platforms/weixinChannels/pageWorld.ts`

平台流程：

- `src/platforms/weixinChannels/content.ts`

选择器配置：

- `src/platforms/weixinChannels/selectors.ts`
