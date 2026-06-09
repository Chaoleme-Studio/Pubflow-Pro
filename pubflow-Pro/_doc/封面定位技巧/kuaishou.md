# 快手封面定位

## 当前结论

快手封面不能只注入页面根部的隐藏图片 `input[type=file]`。正确链路是：

1. 点击“封面设置”里的当前封面卡片。
2. 打开封面编辑弹窗。
3. 切到“上传封面”tab。
4. 在弹窗内的上传区域找图片 `input[type=file]`。
5. `DataTransfer + input/change` 注入图片。
6. 点击弹窗底部“确认”保存。

当前实现位置：

- 快手内容流程：[src/platforms/kuaishou/content.ts](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/platforms/kuaishou/content.ts:14)
- 快手选择器：[src/platforms/kuaishou/selectors.ts](/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/src/platforms/kuaishou/selectors.ts:26)

## 页面模型

| 项 | 结论 |
| --- | --- |
| 平台 | 快手创作者服务平台 |
| 发布页 | `https://cp.kuaishou.com/article/publish/video?tabType=1` |
| 封面入口 | “封面设置”区域内当前封面卡片 |
| 弹窗 | Ant Modal，文本包含“封面截取 / 上传封面” |
| 上传 tab | “上传封面” |
| 封面比例 | 弹窗侧栏提供原始比例、4:3、3:4、1:1、9:16 |
| 上传方式 | 弹窗内图片 file input |
| 保存方式 | 点击弹窗底部“确认” |
| 验证信号 | 弹窗关闭，主页面封面预览图片签名变化 |

## DOM 特征

### 封面入口

平台配置：

```ts
封面: '._high-cover-editor_ps02t_1, [class*="cover-editor"], ._default-cover_ps02t_86, [class*="default-cover"]'
```

实际可点击节点：

```text
._cover-full-editor_ps02t_40
```

这个节点有 React `onClick`，点击后打开封面弹窗。通用选择器先定位封面区域，再向内找 `[class*="cover-full-editor"]`，比直接点击外层区域更稳。

### 弹窗

弹窗结构特征：

```text
[role="dialog"].ant-modal-wrap
文本包含：封面截取、上传封面
```

弹窗打开后默认可能在“封面截取”tab。切到“上传封面”后，上传区域特征是：

```text
._cropper-upload_*
文本：拖拽图片到此或点击上传、上传图片
input[type=file][accept*="image"]
```

图片 input accept：

```text
image/apng,image/bmp,image/ico,image/cur,image/jpg,image/jpeg,image/jfif,image/pjpeg,image/pjp,image/png,image/webp
```

底部确认按钮：

```text
button.ant-btn.ant-btn-default
文本：确认
```

## 当前实现

`uploadKuaishouCover` 的流程：

1. 读取 `coverCacheId` 对应 File。
2. 定位 `fields.cover.selectors`。
3. 优先点击封面区域内 `[class*="cover-full-editor"]`。
4. 等待文本包含“封面截取 / 上传封面”的弹窗出现。
5. 找到并点击文本精确等于“上传封面”的 tab。
6. 只在弹窗作用域内找图片 input，避免误用页面根部隐藏 input。
7. 注入 File 并派发 `input/change`。
8. 等待“确认”按钮可点击，点击保存。
9. 等弹窗关闭，并检查主页面封面图片签名是否变化。

点击使用 `clickKuaishouElement`：

- 先根据 DOM 定位元素。
- 用 `cdpClickElement` 发送可信点击。
- CDP 不可用时 fallback 到 pointer/mouse/click 事件链。

这里的 CDP 不是固定坐标。坐标由目标元素当前 `getBoundingClientRect()` 实时计算，所以不受窗口缩放、分辨率变化影响。

## 历史方案

### 方案一：直接注入页面根部隐藏图片 input

失败原因：页面根部确实存在 accept 为 image 的隐藏 input，但它不是当前封面上传 tab 的可靠入口。注入后主页面封面状态不更新，用户看到封面仍未上传。

结论：快手必须先打开封面弹窗，再使用弹窗内的上传 tab。

### 方案二：点击外层“封面设置”文本或区域

失败原因：a11y 树只暴露了“封面设置”文本，外层区域没有绑定实际点击逻辑。真正的点击 handler 在 `_cover-full-editor_*` 子节点上。

结论：先定位封面区域，再找内部 `[class*="cover-full-editor"]`。

### 方案三：只打开弹窗但不切 tab

失败原因：默认“封面截取”tab 展示的是视频帧裁剪和比例选项。虽然弹窗中也有“确认”，但还没有上传用户自定义图片。

结论：必须切到“上传封面”tab 后再找 input。

## 后续风险

1. hash class 变化：保留 `[class*="cover-full-editor"]`、`[class*="default-cover"]`、文本确认作为组合定位。
2. 弹窗文案变化：如果“上传封面”改名，需要更新平台文档和 `selectKuaishouUploadTab` 的文本列表。
3. 上传后预览图签名不变化：可能是平台延迟刷新，可补充网络请求或弹窗内上传成功状态作为验证信号。
4. PK封面如果成为必填，需要单独处理开关和额外封面图。

排障时优先用 DevTools/MCP 确认：

```js
document.querySelectorAll('input[type=file]')
document.querySelectorAll('[role=dialog], .ant-modal-wrap')
document.querySelectorAll('[class*=cover-full-editor]')
```
