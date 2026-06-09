# B站封面定位

## 当前结论

B站封面上传需要先点击主页面的“封面设置”，打开“封面制作”面板。面板底部有一个较小的“上传封面”区域，真实图片 input 藏在这个区域下面。

正确链路：

1. 点击主页面封面卡片。
2. 打开“封面制作”面板。
3. 在面板内定位 `.bcc-upload.cover-upload`。
4. 找到 `input[type=file][accept="image/png, image/jpeg"]`。
5. `DataTransfer + input/change` 注入图片。
6. 点击面板右下角“完成”。

当前实现位置：

- B站内容流程：[src/platforms/bilibili/content.ts](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/platforms/bilibili/content.ts:12)
- B站选择器：[src/platforms/bilibili/selectors.ts](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/platforms/bilibili/selectors.ts:29)

## 页面模型

| 项 | 结论 |
| --- | --- |
| 平台 | B站创作中心 |
| 发布页 | `https://member.bilibili.com/platform/upload/video/frame?page_from=creative_home_top_upload` |
| 封面入口 | 主页面“封面设置”卡片 |
| 面板 | 页面内覆盖层 `.cover-editor.bcc-dialog__wrap` |
| 封面比例 | 首页推荐封面 4:3、个人空间封面 16:9 |
| 上传方式 | 面板底部 `.bcc-upload.cover-upload` 内图片 file input |
| 保存方式 | 面板右下角“完成” |
| 横竖封面提示 | 默认点击“确认同步”，可在平台个性化设置关闭 |
| 验证信号 | 面板关闭，主页面封面预览图片或背景签名变化 |

## DOM 特征

### 主页面入口

平台配置：

```ts
封面: '.cover-img, .edit-text, .cover, .cover-content, .cover-settings, .bcc-cover-settings, [class*="cover-setting"], [class*="coverSetting"], .cover-crop'
```

当前页面实际稳定特征：

```text
.cover
.cover-content
.cover-main
.cover-img
.edit-text
文本：封面设置
```

点击 `.cover-img` 或 `.edit-text` 可以打开封面制作面板。

### 封面制作面板

面板特征：

```text
.cover-editor.bcc-dialog__wrap.bcc-dialog__wrap-mask
文本包含：封面制作、上传封面、完成
```

面板内有两个画布：

```text
#editor_4_3
#editor_16_9
```

底部上传区域：

```text
.cover-editor-panel-select
.bcc-upload.cover-upload
.upload-area
文本：上传封面、拖拽图片或点击上传
input[type=file][accept="image/png, image/jpeg"]
```

完成按钮：

```text
.cover-editor-button .button.submit
文本：完成
```

点击后按钮会进入异步状态：

```text
制作中...
```

此时不能立刻判断失败，需要等待面板关闭或横竖封面同步确认弹窗出现。

如果只改了 4:3 封面，B站可能在点击“完成”后弹出二次确认：

```text
.videoup-confirm-modal.bcc-dialog__wrap
标题：检测到个人空间封面（16:9）未修改
按钮：不同步，手动编辑 / 确认同步
```

## 当前实现

`uploadBilibiliCover` 的流程：

1. 读取 `coverCacheId` 对应 File。
2. 定位平台配置中的封面入口。
3. 优先点击入口内 `.cover-img` 或 `.edit-text`。
4. 等待 `.cover-editor` 出现，并用文本确认“封面制作 / 上传封面 / 完成”。
5. 只在面板内查找 `.cover-upload input[type=file][accept*="image"]`。
6. 注入 File 并派发 `input/change`。
7. 优先定位 `.cover-editor-button .button.submit`，等待“完成”可点击并点击。
8. 等待按钮从“制作中...”异步状态结束。
9. 如果出现“检测到个人空间封面（16:9）未修改”，默认点击“确认同步”。
10. 等面板关闭，并检查主页面封面预览签名是否变化。

发布页 B站个性化设置新增：

| 设置 | 默认 | 作用 |
| --- | --- | --- |
| 自动同步 16:9 封面 | 开启 | 出现横竖封面提示时自动点击“确认同步” |

点击使用 `clickBilibiliElement`：

- 先根据 DOM 定位元素。
- 用 `cdpClickElement` 发送可信点击。
- CDP 不可用时 fallback 到 pointer/mouse/click 事件链。

CDP 不是固定坐标。坐标由目标元素当前 `getBoundingClientRect()` 实时计算，不依赖屏幕分辨率。

## 历史方案

### 方案一：通用 `uploadCoverIfAvailable`

风险：B站页面里有多个 file input，包括视频、字幕 `.txt`、压缩包 `.zip`。通用函数全页面扫描时容易误选非封面 input，或者找不到隐藏在面板底部的封面 input。

结论：B站必须使用平台专用流程，作用域限定到 `.cover-editor`。

### 方案二：旧封面选择器未命中当前 DOM

失败现象：自动流程连“封面制作”面板都没有打开，后续 input 注入和“完成”自然全部失效。

原因：旧配置只包含 `.cover-settings`、`.bcc-cover-settings`、`[class*="cover-setting"]`、`.cover-crop`，但当前 B站页面真实入口是：

```text
.cover-img
.edit-text
```

结论：平台配置必须包含真实入口；代码里也保留 `findBilibiliCoverEntry` fallback，防止配置漂移导致第一步空跑。

### 方案三：只点击封面区域后等待全局图片 input

风险：封面 input 是在封面制作面板底部的 `.cover-upload` 内，不应该全局找第一个图片 input。后续页面如果增加其他图片上传入口，会产生误选。

结论：打开面板后必须在 `.cover-editor` 内找 `.cover-upload input[type=file]`。

## 后续风险

1. 面板 class 变化：保留“封面制作 / 上传封面 / 完成”文本确认。
2. 上传区域移动到底部外的其他容器：优先用 `.cover-upload` 和 accept 组合定位。
3. B站调整为分别上传 4:3 和 16:9：需要增加两个画布状态验证。
4. 上传后主页面预览不立即刷新：可补充监听上传网络请求或面板内画布变化作为验证信号。

排障时优先用 DevTools/MCP 确认：

```js
document.querySelectorAll('.cover-editor')
document.querySelectorAll('.cover-editor input[type=file]')
document.querySelectorAll('.cover-editor .cover-upload')
```
