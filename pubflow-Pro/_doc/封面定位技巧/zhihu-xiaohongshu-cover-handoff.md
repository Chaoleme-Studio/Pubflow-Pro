# 知乎/小红书封面上传交接文档

更新时间：2026-07-06

## 这份文档要解决什么

当前主要问题是知乎视频封面上传链路：

- 封面弹窗能打开。
- 图片文件能注入成功。
- 弹窗内已经能看到上传后的封面状态。
- 但自动流程没有稳定点击 `确认选择`，导致后续文本填充/发布流程被阻塞。

之前侧边栏出现过的失败信息：

```text
ZH
知乎
失败
已发送填充指令
视频已尝试自动上传，继续填写文本。封面已注入，但没有等到知乎封面预览，未点击确认。文本已填充，请检查后发布。
```

本文只整理平台封面上传问题。授权迁移次数、有效期、31 天/月卡等授权逻辑与本文无直接关系，重开会话排查知乎封面时可以先忽略。

## 关键文件

- 小红书实现：`pubflow-Pro/src/platforms/xiaohongshu/content.ts`
- 知乎实现：`pubflow-Pro/src/platforms/zhihu/content.ts`
- CDP 可信点击：`pubflow-Pro/src/content/cdp.ts`
- 小红书定位文档：`pubflow-Pro/_doc/封面定位技巧/xiaohongshu.md`
- 知乎定位文档：`pubflow-Pro/_doc/封面定位技巧/zhihu.md`

## 小红书之前是怎么改的

小红书之前的问题是老逻辑有固定等待：

```ts
input.files = dataTransfer.files;
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
await waitForIdle(1800);
```

这个写法在低性能机器或平台上传慢时容易不稳定：1800ms 到了不代表封面已经进入裁剪/预览状态。

现在小红书 staged change 的核心改法是状态检测：

1. 注入文件时兼容 `input.files` 只读异常，失败时用 `Object.defineProperty` 兜底。
2. 触发 `input/change` 时加 `composed: true`，让事件更容易穿透组件边界。
3. 注入后调用 `waitForXiaohongshuInjectedCoverReady(...)`，不再只睡固定 1800ms。
4. ready 条件是：
   - `input.files.length` 仍能看到文件；
   - 弹窗里有 `确定/完成/保存` 按钮；
   - 弹窗预览签名变化，或出现上传后状态。
5. 上传后状态由 `hasXiaohongshuUploadedCoverState(...)` 判断：
   - 文案包含 `重新上传`、`更换图片`、`裁剪`、`缩放`、`旋转`；
   - 同时存在可见 `img/canvas/crop/preview`，尺寸至少约 48x48。

小红书的思路不是“等够多少秒”，而是等页面从上传占位切换到可确认的封面编辑状态。超时时间只是失败上限。

## 小红书为什么比较稳

小红书弹窗上传后 DOM 状态比较稳定：

- 有明确的 `设置封面` 弹窗。
- 上传后会出现 `重新上传/裁剪/缩放/旋转` 这类编辑状态文案。
- crop/preview DOM 能稳定被 content script 看见。
- `确定` 按钮状态也比较直接。

因此小红书可以把“封面已被接收”判断为：

```text
文件已注入 + 确认按钮存在 + (预览签名变化 或 上传后编辑状态出现)
```

## 知乎旧版是什么样子

知乎 HEAD 旧版大致是：

```ts
input.files = dataTransfer.files;
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
await waitForZhihuInjectedCoverReady(input, 2200);

const confirmButton = await waitForZhihuDialogButton(['确认选择', '确认', '完成'], 15000);
if (!confirmButton) return '封面已注入，但没有找到知乎封面弹窗的确认按钮。';

await clickZhihuElement(confirmButton);
const closed = await waitForZhihuCoverDialogClosed(10000);
```

旧版的特点：

- 会在注入后等约 2200ms。
- `waitForZhihuInjectedCoverReady` 会看 `input.files.length`、`img/canvas/preview/crop`、确认按钮。
- 不管预览判断是否足够可靠，后面仍会找按钮并点击。

旧版的问题：

- 存在固定等待，低性能机器或知乎上传慢时可能不够。
- `input.files.length` 在知乎上传完成后可能消失/清空，不能长期作为可靠信号。
- 预览 DOM 在知乎里不如小红书稳定。

旧版为什么“能点”：

- 它没有把“没等到预览”作为硬失败。
- 只要后续找到了 `确认选择`，就会直接点击。

## 知乎中间错误版本的问题

中间版本把逻辑改成了：

```text
必须先等到知乎封面预览/签名变化 -> 再找确认按钮 -> 再点击
```

实际页面上，文件已经注入成功、弹窗也已经出现上传后状态，但 content script 没有稳定检测到“知乎封面预览”，于是返回：

```text
封面已注入，但没有等到知乎封面预览，未点击确认。
```

这就是用户看到的问题：业务上图片已经进去了，但自动流程不点 `确认选择`。

## 9222 页面实测证据

通过 Chrome 9222 调试端口检查知乎页面，看到过以下事实：

- 当前页：`https://www.zhihu.com/upload-video?entry=navPanel`
- 封面弹窗：`.VideoCoverEditor-Modal`
- 弹窗文本：`选择封面 本地上传 重新上传 确认选择`
- 上传后预览存在：`ReactCrop`，图片为 `blob:https://www.zhihu.com/...`
- `确认选择` 按钮可见且 enabled。
- 按钮中心坐标约在 `{ x: 683, y: 686.5 }`。
- 使用 CDP `Input.dispatchMouseEvent` 对按钮中心真实点击，弹窗成功关闭，主页面封面更新为知乎图片 CDN URL。

重要结论：

- 知乎不是文件没有上传。
- 不是按钮不存在。
- DOM `element.click()` 不可靠。
- CDP 坐标点击是有效的。
- 不能长期依赖 `input.files.length`，因为知乎上传后 input 可能消失或清空。

## 知乎现在改成什么样子

当前工作区里的知乎逻辑已改成更接近小红书的状态驱动：

1. 注入封面文件并触发 `input/change`。
2. 调用 `waitForZhihuCoverConfirmButton(...)` 等待确认按钮可点击。
3. 这个等待不是固定睡眠，而是监听 DOM 变化。
4. ready 条件是：
   - 文件已被注入过；
   - 弹窗不是 `上传中/处理中/正在上传/加载中`；
   - 弹窗里能找到 `确认选择/确认/完成`；
   - 同时满足知乎上传后状态：
     - 文案出现 `重新上传`；或
     - 弹窗预览签名变化；或
     - 出现可见 `img/canvas/preview/crop`。
5. `findZhihuButton(...)` 会去空白匹配按钮文案，避免 DOM 把 `确认选择` 拆成带空白文本。
6. `isClickableZhihuElement(...)` 增加了：
   - 非 disabled；
   - `pointer-events` 不是 `none`；
   - 可见、有尺寸；
   - 元素中心点 `elementFromPoint` 命中自己或自己的子元素，避免按钮被遮挡时误点。
7. `confirmZhihuCoverSelection(...)` 点击后以“弹窗关闭”为成功标准。
8. `waitForZhihuCoverDialogClosed(...)` 改为 `MutationObserver` 等弹窗 DOM 消失，不再只靠轮询 sleep。

当前仍保留的时间值含义：

- `15000ms`：总超时上限，不是固定等待。
- `1000ms/700ms/900ms`：MutationObserver 没有事件时的重试节流/上限。
- 点击后如果弹窗立即关闭，会立即继续，不会硬等满。

## 当前未完全确认的风险

这版知乎改动已经通过：

```bash
pnpm typecheck
```

但当前 9222 页面在最后一次检查时没有打开封面弹窗，所以还没有在 live 弹窗上重新跑完整自动流程。

下一次重开会话后，应优先做现场验证：

1. 重新加载扩展。
2. 刷新知乎 `upload-video` 页面。
3. 重新触发一次发布填充。
4. 如果仍失败，用 9222/CDP 检查：
   - `.VideoCoverEditor-Modal` 是否仍在；
   - 弹窗文本是否包含 `重新上传`；
   - 是否有 `ReactCrop`、`img[src^="blob:"]` 或 canvas；
   - `确认选择` 按钮是否 enabled；
   - 按钮中心 `elementFromPoint` 命中的元素是什么；
   - 扩展后台 `CDP_CLICK` 是否返回 ok。

## 新会话压缩摘要

把下面这段给新会话即可：

```text
当前只需要继续排查知乎视频封面确认点击，不需要带授权迁移/有效期上下文。

小红书封面旧版是注入 input 后固定 waitForIdle(1800)，现在 staged change 改成状态检测：
waitForXiaohongshuInjectedCoverReady 等 input.files、确认按钮、预览签名变化或“重新上传/裁剪/缩放/旋转”等上传后状态，再点“确定”。小红书 DOM 状态稳定，所以这套比较可靠。

知乎旧版注入后等约 2200ms，然后不管预览是否稳定，继续找“确认选择”并点击；能点，但有固定等待。
中间错误版把“等到知乎封面预览”当硬条件，导致图片已注入但没有点击确认，侧边栏报“封面已注入，但没有等到知乎封面预览，未点击确认”。

9222 实测知乎弹窗里图片已成功注入，弹窗有“重新上传”和 ReactCrop/blob 预览，“确认选择”按钮 visible/enabled。手动用 CDP Input.dispatchMouseEvent 点击按钮中心能关闭弹窗并更新主页面封面；DOM click 不可靠。知乎 input.files 上传后可能消失/清空，不能长期依赖。

当前 zhihu/content.ts 已改为状态驱动：
waitForZhihuCoverConfirmButton 等 fileSeen + 非上传中 + 确认按钮可点击 + (“重新上传”或预览签名变化或 img/canvas/preview/crop 可见)；
isClickableZhihuElement 会检查 pointer-events、disabled、可见尺寸和 elementFromPoint 中心命中；
confirmZhihuCoverSelection 用 CDP 点击，并用 MutationObserver 等弹窗关闭作为成功标准。

已跑 pnpm typecheck 通过。还需要重新加载扩展、刷新知乎页面后做 live 验证。
```

