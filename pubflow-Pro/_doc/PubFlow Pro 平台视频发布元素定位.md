# 多平台视频发布元素定位

> 本文档只记录“视频发布”相关的页面元素、选择器、字段和平台个性化设置。图文和文章流程分别见 `platform-image-图文发布调研.md`、`platform-article-文章发布调研.md`。

> 采集时间：2026-05-19
> 采集方式：Chrome DevTools MCP 逐平台快照 + evaluate_script + network requests

---

## 一、抖音 (douyin)

**页面 URL**: `https://creator.douyin.com/creator-micro/content/post/video`

### 基础信息

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 标题 | `input` | `input.semi-input.semi-input-default` | placeholder="填写作品标题，为作品获得更多流量"，最大30字符 |
| 作品描述 | contenteditable `div` | `div.zone-container.editor-kit-container.editor` | 支持 #话题 @好友，最大1000字符 |
| #话题 | 内联触发 | 描述区内输入 # | 有推荐话题列表 |
| @好友 | 内联触发 | 描述区内输入 @ | - |

### 媒体设置

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 封面设置 | 区域 | `div` (文本"设置封面"附近) | 横封面4:3、竖封面3:4、AI智能推荐封面 |
| 添加合集 | 下拉选择 | `div` (文本"请选择合集") | API: `GET /web/api/mix/list/?status=0,2&count=15` |
| 自主声明 | 下拉选择 | `div.selectText-XSrMFZ` | API: `GET /aweme/v3/user_declaration/suggestion/` |
| 视频章节 | 功能 | `span.title-content-oaqcSp` (文本"视频章节") | 支持手动添加 + 智能章节 |
| 添加标签 | 功能 | `span.title-content-oaqcSp` (文本"添加标签") | 支持自定义标签 |

### 位置与热点

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 位置 | 输入(动态) | 点击"位置"区域后出现 input | API: `GET /aweme/v1/life/video_api/search/poi/?keywords=&search_type=0` |
| 关联热点 | 输入(动态) | 点击"关联热点"区域后出现 input | API: `GET /aweme/v1/hotspot/recommend/` |

### 官方活动

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 官方活动 | 推荐列表 | 活动卡片区域 | API: `GET /web/api/media/activity/get/?page=1&size=9999&need_challenge=1` |

### 发布设置

| 选项 | 类型 | CSS 选择器 | 选项值 |
|------|------|-----------|--------|
| 同时发布 | checkbox group | `input.radio-native-p6VBGt` | 不同时发布(默认) / 同时发布到 |
| 谁可以看 | checkbox group | `input.radio-native-p6VBGt` | 公开(默认) / 好友可见 / 仅自己可见 |
| 保存权限 | checkbox group | `input.radio-native-p6VBGt` | 允许(默认) / 不允许 |
| 发布时间 | checkbox group | `input.radio-native-p6VBGt` | 立即发布(默认) / 定时发布 |
| 快速填写 | 功能 | 区域文本"快速填写" | 一键填充 |

### 操作按钮

| 按钮 | CSS 选择器 | 文本 |
|------|-----------|------|
| 发布 | `button.button-dhlUZE.primary-cECiOJ.fixed-J9O8Yw` | "发布" |
| 暂存离开 | `button.button-dhlUZE.cancel-btn-zy_rHA.cancel-fwlVJc.fixed-J9O8Yw` | "暂存离开" |

### API 端点汇总

| 功能 | 方法 | 端点 |
|------|------|------|
| 热点推荐 | GET | `/aweme/v1/hotspot/recommend/` |
| 位置搜索 | GET | `/aweme/v1/life/video_api/search/poi/?keywords={kw}&search_type=0` |
| 活动列表 | GET | `/web/api/media/activity/get/?page=1&size=9999&need_challenge=1` |
| 合集列表 | GET | `/web/api/mix/list/?status=0,2&count=15` |
| 自主声明 | GET | `/aweme/v3/user_declaration/suggestion/` |
| 封面生成 | GET | `/aweme/v1/cover/gen/ref/` |

---

## 二、小红书 (xiaohongshu)

**页面 URL**: `https://creator.xiaohongshu.com/publish/publish`

### 基础信息

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 标题 | `input` | `input.d-text` | placeholder="填写标题会有更多赞哦" |
| 正文 | contenteditable `div` | `div.tiptap.ProseMirror` | 支持 #话题 @用户 表情，最大1000字符 |
| 话题 | 按钮触发 | `button.contentBtn.topic-btn` | 输入 # 触发推荐 |
| @用户 | 按钮触发 | `button.contentBtn` (文本"用户") | - |
| 表情 | 按钮触发 | `button.contentBtn.emoticons` | - |
| 智能标题 | 功能 | `div.recommand-title-btn` | AI 推荐标题 |

### 活动话题

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 活动话题 | 推荐列表 | 活动区域 (文本"活动话题"下方) | 显示活动名，可"添加话题" |

### 媒体设置

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 封面设置 | 区域 | `div.cover-plugin-title` | 智能推荐封面 |
| 添加章节 | 功能 | `div.add-chapter-btn` (文本"去添加") | - |
| 加入合集 | 功能 | 文本"创建合集" | - |
| 原创声明 | toggle/switch | `.custom-switch-card` 内 `.d-switch-simulator` | 小红书同类开关 CSS 重复，按"原创声明"文本定位卡片，兜底取第一张开关卡 |

### 添加组件

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 添加地点 | 输入 | `input` (文本"添加地点"附近) | - |
| 选择群聊 | 输入 | `input` (文本"选择群聊"附近) | - |
| 关联直播预告 | 功能 | 文本"关联直播预告" | - |
| 标记地点或标记朋友 | 功能 | 文本"标记地点或标记朋友" | - |
| 添加路线 | 功能 | 文本"添加路线" | - |

### 发布设置

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 公开可见 | 下拉 | `div.d-text.d-text-nowrap.d-select-description` | 公开可见(默认) |
| 定时发布 | switch | `.custom-switch-card` 内 `.d-switch-simulator` | 小红书同类开关 CSS 重复，按"定时发布"文本定位卡片，兜底取最后一张开关卡 |

### 定时发布交互细节（小红书 d-datepicker）

小红书使用自定义的 d-datepicker 组件：
- 开关：`.custom-switch-card` 内的 `.d-switch-simulator`，点击包含"定时发布"文本的卡片
- 日期时间输入框：`.d-datepicker-input-filter input` 或 `.date-picker-container input`
- 输入框可能为 readonly，需通过 UI 操作选择日期时间
- 日期格式：`YYYY-MM-DD HH:mm`

### 重复 CSS 多实例定位（小红书原创/定时）

小红书视频页和图文页的原创声明、定时发布都使用同一套自定义 switch 组件，多个操作点的外层都是 `.custom-switch-card`，真正可点击点都是卡片内部的 `.d-switch-simulator`。如果直接全局取第一个 `.d-switch-simulator`，就会只点到原创或只点到定时。

这类定位在项目里统一叫 **重复 CSS 多实例定位**，具体落点叫 **文本优先 + 首尾兜底 + 作用域内点击**：

1. 先收集可见的 `.custom-switch-card, [class*="switch-card"]`，按页面从上到下、从左到右排序。
2. 优先用卡片文本过滤：包含"原创声明"的卡片是原创，包含"定时发布"的卡片是定时。
3. 文本结构变化时用稳定位置兜底：原创声明取第一张 switch 卡，定时发布取最后一张 switch 卡。
4. 找到卡片后，只在这张卡片内部查询 `.d-switch-simulator` 并调用 `.click()`，不要全局点击 `.custom-switch-icon`，也不要用坐标。
5. 判断开关状态时优先读卡片内部的 `input[type="checkbox"].checked`；没有 input 时再读 simulator class，并且只能匹配独立 token，例如 `checked` / `is-checked`，不要把 `unchecked` 误判为已开启。

视频页当前顺序通常是：第一张 `原创声明`，最后一张 `定时发布`。图文页当前顺序通常是：`原创声明`、`允许合拍`、`允许正文复制`、`定时发布`。

### 操作按钮

| 按钮 | CSS 选择器 | 文本 |
|------|-----------|------|
| 发布 | `button` (snapshot uid=4_77) | "发布" |
| 暂存离开 | `button` (snapshot uid=4_76) | "暂存离开" |

---

## 三、微信视频号 (weixinChannels)

**页面 URL**: `https://channels.weixin.qq.com/platform/post/create`
**注意**: 使用 wujie 微前端，表单元素在 `wujie-app` 的 open shadow DOM 内。所有选择器需通过 `wujieApp.shadowRoot.querySelector()` 访问。

### 基础信息

| 选项 | 类型 | CSS 选择器 (shadow DOM 内) | 详情 |
|------|------|---------------------------|------|
| 视频描述 | contenteditable `div` | `div.input-editor` | 支持 #话题 @视频号 |
| 短标题 | `input` | `input.weui-desktop-form__input` | placeholder="概括视频主要内容，字数建议6-16个字符" |
| #话题 | 内联触发 | 描述区内输入 # | - |
| @视频号 | 内联触发 | 描述区内输入 @ | - |

### 媒体设置

| 选项 | 类型 | CSS 选择器 (shadow DOM 内) | 详情 |
|------|------|---------------------------|------|
| 封面预览 | 编辑 | 文本"编辑" (个人主页卡片 3:4 / 分享卡片 4:3) | - |

### 扩展信息

| 选项 | 类型 | CSS 选择器 (shadow DOM 内) | 详情 |
|------|------|---------------------------|------|
| 位置 | 选择 | 文本"位置" → 已选城市 | - |
| 添加到合集 | 下拉 | 文本"选择合集" | - |
| 链接 | 下拉 | 文本"选择链接" | 可添加外部 URL |
| 活动 | 下拉 | 文本"不参与活动" | - |
| 声明原创 | checkbox | checkbox (文本"声明原创"附近) | "声明后，作品将展示原创标记，有机会获得广告收入。" |

### 发布设置

| 选项 | 类型 | CSS 选择器 (shadow DOM 内) | 选项值 |
|------|------|---------------------------|--------|
| 定时发表 | radio group | `input[type="radio"]` | 不定时(value=0, 默认) / 定时(value=1) |

### 操作按钮

| 按钮 | CSS 选择器 (shadow DOM 内) | 文本 |
|------|---------------------------|------|
| 发表 | `button.weui-desktop-btn_primary` | "保存" / "发表" |
| 保存草稿 | `button.weui-desktop-btn.weui-desktop-btn_default` | "保存草稿" |
| 手机预览 | `button` (文本"手机预览") | "手机预览" |

---

## 四、快手 (kuaishou)

**页面 URL**: `https://cp.kuaishou.com/article/publish/video`

### 基础信息

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 作品描述 | contenteditable | `#work-description-edit` | 支持 #话题 @好友 |
| 智能文案 | 功能 | 文本"智能文案" | AI 生成文案 |
| 智能话题 | 功能 | 文本"智能话题" | AI 推荐话题 |
| @好友 | 功能 | 文本"好友" | - |
| 推荐话题 | 列表 | 文本"推荐:" 下方 | 有"全部"展开 |

### 活动推荐

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 活动推荐 | 列表 | 文本"活动推荐" 下方 | 显示活动名 + "去领取"，有"全部"展开 |

### 媒体设置

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 封面设置 | 区域 | 文本"封面设置" | 智能推荐封面、PK封面 |
| 添加章节 | 功能 | 文本"添加章节" | "在视频进度条上标记节点" |

### 作者服务

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 作者服务 | combobox | `combobox` (文本"选择服务类型") | "关联成功可获得更多收益" |
| 关联热点 | combobox | `combobox` (placeholder="输入你想关联的热点") | 动态搜索 |
| 作者声明 | combobox | `combobox` (文本"为作品添加补充说明") | - |

### 位置

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 所在地区 | combobox | `combobox` (placeholder="请选择所在地区") | 省市级联 |
| 详细地址 | input | `input` (placeholder="请输入视频详细地址，让同城老铁看见你") | - |

### 发布设置 - 互动设置

| 选项 | 类型 | CSS 选择器 | 默认值 |
|------|------|-----------|--------|
| 允许别人跟我拍同框 | checkbox | checkbox (文本"允许别人跟我拍同框") | ✅ 默认勾选 |
| 允许下载此作品 | checkbox | checkbox (文本"允许下载此作品") | ✅ 默认勾选 |
| 作品展示在同城页 | checkbox | checkbox (文本"作品展示在同城页") | ✅ 默认勾选 |

### 发布设置 - 查看权限

| 选项 | 类型 | CSS 选择器 | 选项值 |
|------|------|-----------|--------|
| 查看权限 | radio group | radio (文本"所有人可见"/"好友可见"/"仅自己可见") | 所有人可见(默认) / 好友可见 / 仅自己可见 |

### 发布设置 - 发布时间

| 选项 | 类型 | CSS 选择器 | 选项值 |
|------|------|-----------|--------|
| 发布时间 | radio group | radio (文本"立即发布"/"定时发布") | 立即发布(默认) / 定时发布 |
| 流量建议 | 功能 | 文本"你的粉丝在20:00到21:00点活跃" | "一键设置" |

### 定时发布交互细节（快手 ant-picker）

快手使用 Ant Design 的日期时间选择器，结构如下：
- `input[readonly]` — 显示当前日期时间的只读输入框，点击打开面板
- `.ant-picker-cell` — 日历日期格子，含 `.ant-picker-cell-disabled` 标记不可选日期
- `.ant-picker-time-panel-column` — 时间列（时/分/秒），每列包含多个 `.ant-picker-time-panel-cell`
- 确定按钮 — 设置完时间后需点击"确定"按钮关闭面板

**自动化步骤**：
1. `focus()` + `dispatchEvent(mousedown)` 打开面板
2. 点击 `.ant-picker-cell` 选择日期
3. 遍历 `.ant-picker-time-panel-column` 的 cell 选择时/分/秒
4. 点击"确定"按钮关闭

### 操作按钮

| 按钮 | CSS 选择器 | 文本 |
|------|-----------|------|
| 发布 | snapshot中为 StaticText "发布" | "发布" |
| 取消 | snapshot中为 StaticText "取消" | "取消" |

---

## 五、B站 (bilibili)

**页面 URL**: `https://member.bilibili.com/platform/upload/video/frame`

### 基本设置

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 封面 | 区域 | 文本"封面设置" | 系统默认第一帧 + 智能推荐封面 |
| 标题 | `input` | `input.input-val` (placeholder="请输入稿件标题") | 最大80字符 |
| 创作声明 | 下拉(readonly) | `input.bcc-select-input-inner` (placeholder="请选择符合您视频内容的创作声明") | 点击展开选项 |
| 分区 | 下拉 | 文本"动画" (已选) | 点击展开分区树 |
| 标签 | 输入 | `input.input-val` (placeholder="按回车键Enter创建标签") | 最多10个，有推荐标签 |
| 参与话题 | 推荐列表 | 文本"参与话题:" 下方 | 可"搜索更多话题" |
| 简介 | contenteditable `div` | `div.ql-editor` | 最大2000字符 |

### 基本设置 - 定时发布

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 定时发布 | 日期选择器 | heading "定时发布" 附近 | 最早≥5分钟，最晚≤15天 |

### 定时发布交互细节（B站自定义日期时间选择器）

B站使用自定义的日期+时间选择器，结构如下：

**日期选择器**：
- `.date-picker-date` — 可点击元素，显示当前日期（如 "2026-05-19"），点击打开日历
- `.date-picker-container` — 日历弹出层
- `.date-picker-nav-title` — 显示当前月份（如 "2026年5月"）
- `.date-picker-nav-wrp` — 导航栏，含 `.prev-btn-day`/`.next-btn-day`/`.prev-btn-month`/`.next-btn-month` 翻页按钮
- `.date-picker-body-item` — 日期格子，含 `date-item-disabled`（过去日期不可选）、`date-item-selected`（当前选中）

**时间选择器**：
- `.date-picker-timer` — 可点击元素，显示当前时间（如 "16:25"），点击打开时间面板
- `.time-picker-panel-select-wrp` — 时间面板容器（两个面板：小时 + 分钟）
- `.time-picker-panel-select-item` — 时间选项，含 `time-select-disabled`（不可选）
- 分钟粒度为 5 分钟（00, 05, 10, ..., 55）

**自动化步骤**：
1. 点击 `.date-picker-date` 打开日历
2. 检查 `.date-picker-nav-title` 是否为目标月份，不是则点击翻页按钮
3. 点击 `.date-picker-body-item` 选择日期
4. 点击 `.date-picker-timer` 打开时间面板
5. 在两个 `.time-picker-panel-select-wrp` 面板中分别选择小时和分钟
6. 点击 `document.body` 关闭时间面板

### 基本设置 - 合集与推广

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 加入合集 | 功能 | heading "加入合集" 附近 | 需权益中心等级达Lv2 |
| 商业推广 | 功能 | 文本"增加商业推广信息" | - |

### 更多设置 - 添加水印

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 添加水印 | switch | 文本"添加水印" + "开启" | 仅对此次上传的视频生效 |

### 更多设置 - 可见范围

| 选项 | 类型 | CSS 选择器 | 选项值 |
|------|------|-----------|--------|
| 可见范围 | radio group | `span.check-radio-v2-name` | 公开可见 / 仅自己可见 |

### 更多设置 - 声明与权益

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 声明与权益 | 区域 | 文本"声明与权益" | - |

### 更多设置 - 视频元素

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 卡片配置 | 按钮 | `button.bcc-button.button.bcc-button--blueLine` (文本"个性化卡片") | - |
| 章节管理 | 按钮 | `button.bcc-button.button.bcc-button--blueLine` (文本"编辑章节") | 智能章节 |
| 字幕设置 | 按钮 | `button.bcc-button.button.bcc-button--blueLine` (文本"上传字幕") | - |

### 更多设置 - 高级设置

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 杜比音效 | switch | 文本"杜比音效" | - |
| Hi-Res无损音质 | switch | 文本"Hi-Res无损音质" | - |

### 更多设置 - 互动管理

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 关闭弹幕 | checkbox | `span.bcc-checkbox-label` (文本"关闭弹幕") | - |
| 关闭评论 | checkbox | `span.bcc-checkbox-label` (文本"关闭评论") | - |
| 开启精选评论 | checkbox | 文本"开启精选评论" | - |

### 更多设置 - 粉丝动态

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 粉丝动态 | contenteditable `div` | `div.ql-editor` (粉丝动态区) | placeholder="有趣的动态描述"，最大233字符 |

### 更多设置 - 其他

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 在个人空间-投稿中隐藏 | checkbox | `span.setting-label-title` (文本"在个人空间-投稿中隐藏") | - |

### 操作按钮

| 按钮 | CSS 选择器 | 文本 |
|------|-----------|------|
| 立即投稿 | `span.submit-add` | "立即投稿" |
| 存草稿 | `span.submit-draft` | "存草稿" |
| 批量操作 | `button` (文本"批量操作") | "批量操作" |
| 添加分P | `button` (文本"添加分P") | "添加分P" |

---

## 六、微博 (weibo)

**页面 URL**: `https://weibo.com/`（首页发布框）

### 基础信息

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 文本内容 | `textarea` | `textarea` (placeholder="有什么新鲜事想分享给大家？") | 支持 #话题 @用户，有字数统计 |
| 内容声明 | 按钮式 | 按钮文本匹配目标声明文字 | 必填，点击按钮后需点击"确定" |

### 工具栏

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 表情 | 按钮 | 文本"表情" | - |
| 图片 | 按钮 | 文本"图片" | - |
| 视频 | 按钮 | 文本"视频" | - |
| 话题 | 按钮 | 文本"话题" | - |
| 头条文章 | 按钮 | 文本"头条文章" | - |
| 更多 | 按钮 | 文本"更多" | - |

### 发布设置

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 封面 | - | - | 不支持单独上传封面；同时上传视频和图片会变成多图排列布局，封面取视频前几帧 |
| 定时微博 | 图标 | `img[alt="定时微博"]` | 需要会员 |
| 公开 | 下拉 | 文本"公开" | 可选公开/其他可见范围 |

### 操作按钮

| 按钮 | CSS 选择器 | 文本 |
|------|-----------|------|
| 发送 | `button` (文本"发送") | "发送" |

---

## 七、知乎 (zhihu)

**页面 URL**: `https://www.zhihu.com/upload-video`

### 基础信息

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 封面 | 选择 | 文本"选择视频封面" | 支持逐帧选择 |
| 标题 | `textarea` | `textarea.css-1ta9b1n` (placeholder="标题") | 最大50字符 |
| 介绍 | `textarea` | `textarea` (placeholder="分享你此刻的想法...") | - |

### 设置选项

| 选项 | 类型 | CSS 选择器 | 详情 |
|------|------|-----------|------|
| 评论权限 | 下拉 | 文本"任何人都可以评论" | - |
| 同步到圈子 | 功能 | 文本"同步到圈子" | - |
| 视频标记 | combobox | `button[role="combobox"]` (文本"选择标记") | 必填，模态框式下拉 |
| 原创视频 | checkbox | checkbox (文本"原创视频"附近) | 默认勾选 |
| 所属领域 | combobox | `button[role="combobox"]` (文本"选择领域") | - |
| 定时发布 | checkbox + date + time | checkbox (文本"定时发布"附近) + 日期按钮 + 小时/分钟 combobox | 见下方详细说明 |
| 内容来源 | 功能 | button (文本"添加来源") | 新闻类需标注 |

### 视频标记交互细节（知乎 React 模态框式下拉）

**⚠️ 技术难点：React 组件不响应 JavaScript `.click()`**

知乎使用 React 构建，其自定义 Select 组件（视频标记、所属领域）的下拉选项**不响应** JavaScript 的 `element.click()`。程序matic 点击能关闭下拉框（`aria-expanded` 变为 `false`），但 React 的状态不会更新（combobox 的 `value` 不变）。

**原因**：React 18 使用事件委托在根元素监听事件。JavaScript 的 `.click()` 虽然触发了 DOM click 事件，但 `event.isTrusted` 为 `false`，React 的合成事件系统可能不处理非可信事件。

**解决方案**：使用 `chrome.debugger` API 发送 CDP `Input.dispatchMouseEvent`，生成浏览器级别的可信点击事件。

**下拉框结构**：
- 触发器：`button[role="combobox"]` (如文本"选择标记")
- 弹出层：`.VideoUploadForm-selectContainer--modalTrigger` 内的 `Popover`
- 选项：`button[role="option"].Select-option` (如"内容无需标注")
- 确认按钮：`button` (文本"确认")
- 取消按钮：`button` (文本"取消")

**自动化步骤**：
1. CDP 点击 combobox 触发器打开下拉
2. CDP 点击目标 `button[role="option"]`
3. CDP 点击"确认"按钮完成选择

### 定时发布交互细节（知乎）

知乎的定时发布包含三个部分：

**日期选择器**：
- 按钮：`button[aria-haspopup="menu"]`，显示当前日期（如 "2026/05/19"）
- 点击打开日历下拉，需要 CDP 点击
- 日历结构待确认（可能是 React 组件，需要 CDP 点击选择日期）

**时间选择器**：
- 小时 combobox：`button[role="combobox"]`，显示当前小时（如 "16"）
- 分钟 combobox：`button[role="combobox"]`，显示当前分钟（如 "51"）
- 定位方法：先找到定时发布区域（含"定时发布"文本的容器），再在该区域内查找 combobox
- 选项：`button[role="option"]` 或 `[role="option"]`
- 需要 CDP 点击

### 操作按钮

| 按钮 | CSS 选择器 | 文本 |
|------|-----------|------|
| 发布视频 | `button.Button.VideoUploadForm-submitButton.css-1j0yk24` | "发布视频" |
| 取消发布 | `button.Button.css-nzl6ed.FEfUrdfMIKpQDJDqkjte` | "取消发布" |

---

## 八、共性功能对比表

### 8.1 基础字段

| 功能 | 抖音 | 小红书 | 视频号 | 快手 | B站 | 微博 | 知乎 |
|------|:----:|:------:|:------:|:----:|:---:|:----:|:----:|
| 标题(独立) | ✅ 30字 | ✅ | ❌(合入描述) | ❌(合入描述) | ✅ 80字 | ❌(合入描述) | ✅ 50字 |
| 描述/正文 | ✅ 1000字 | ✅ 1000字 | ✅ | ✅ | ✅ 2000字 | ✅ | ✅ |
| #话题 | ✅ | ✅ | ✅ | ✅ | ✅(标签) | ✅ | ❌ |
| @用户 | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |

### 8.2 媒体设置

| 功能 | 抖音 | 小红书 | 视频号 | 快手 | B站 | 微博 | 知乎 |
|------|:----:|:------:|:------:|:----:|:---:|:----:|:----:|
| 封面设置 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| 章节 | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| 合集 | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| 分P | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |

### 8.3 发布设置

| 功能 | 抖音 | 小红书 | 视频号 | 快手 | B站 | 微博 | 知乎 |
|------|:----:|:------:|:------:|:----:|:---:|:----:|:----:|
| 定时发布 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅(会员) | ✅ |
| 谁可以看 | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌(评论权限) |
| 保存权限 | ✅ | ❌ | ❌ | ✅(允许下载) | ❌ | ❌ | ❌ |
| 同时发布 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 原创声明 | ❌ | ✅ | ✅ | ❌ | ✅(创作声明) | ❌ | ✅ |

### 8.4 位置与热点

| 功能 | 抖音 | 小红书 | 视频号 | 快手 | B站 | 微博 | 知乎 |
|------|:----:|:------:|:------:|:----:|:---:|:----:|:----:|
| 位置/地点 | ✅ API | ✅ | ✅ | ✅ API | ❌ | ❌ | ❌ |
| 关联热点 | ✅ API | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| 活动 | ✅ API | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

### 8.5 平台特有

| 功能 | 平台 |
|------|------|
| 同时发布到其他平台 | 抖音 |
| 保存权限(允许/不允许) | 抖音 |
| 允许拍同框 | 快手 |
| 允许下载 | 快手 |
| 同城展示 | 快手 |
| PK封面 | 快手 |
| 短标题 | 视频号 |
| 链接(外部URL) | 视频号 |
| 分区 | B站 |
| 分P | B站 |
| 商业推广 | B站 |
| 杜比音效/Hi-Res | B站 |
| 弹幕/评论管理 | B站 |
| 字幕上传 | B站 |
| 水印 | B站 |
| 内容来源标注 | 知乎 |
| 视频标记 | 知乎 |
| 所属领域 | 知乎 |
| 同步到圈子 | 知乎 |
| 评论权限 | 知乎 |
| 内容声明(必填) | 微博 |
| 智能文案/智能话题 | 快手 |
| 智能标题 | 小红书 |
| 关联直播预告 | 小红书 |
| 添加路线 | 小红书 |
| 粉丝动态 | B站 |
| 流量提升建议 | 快手 |

---

## 九、自动化交互模式与技术难点

### 9.1 元素交互类型分类

| 类型 | 代表平台 | 元素特征 | 交互方式 |
|------|---------|---------|---------|
| 标准 input | 抖音标题、B站标题 | `input[type="text"]` | `nativeInputValueSetter` + `dispatchEvent(input/change)` |
| contenteditable | 小红书正文、B站简介 | `div[contenteditable]` | `element.focus()` + `document.execCommand('insertText')` |
| 标准下拉框 | B站创作声明、抖音声明 | `input[readonly]` + 选项列表 | 点击触发器 → 点击选项 |
| 模态框式下拉 | 知乎视频标记、所属领域 | `button[role="combobox"]` + modal | ⚠️ CDP 点击触发器 → CDP 点击选项 → CDP 点击确认 |
| 按钮式声明 | 微博内容声明 | `button` (文本匹配) | 点击按钮 → 点击确定 |
| 自定义 switch | 小红书定时/原创 | `.custom-switch-card` + `.d-switch-simulator` | 点击 switch 模拟器 |
| 自定义日期选择器 | B站定时发布 | `.date-picker-date` + `.date-picker-timer` | 点击打开 → 选择日期 → 选择时间 |
| ant-picker | 快手定时发布 | `input[readonly]` (ant-picker) | `focus` + `mousedown` → 选择日期 cell → 选择时间 cell → 点击确定 |
| React combobox | 知乎定时时间 | `button[role="combobox"]` | ⚠️ CDP 点击 → CDP 点击选项 |
| checkbox/switch | B站商业推广 | `input[type="checkbox"]` | `.click()` (Vue 组件) |
| radio | 视频号定时发布 | `input[type="radio"]` | `.click()` (需在 MAIN world) |

### 9.2 技术难点详解

#### 难点 1：React 组件不响应 JavaScript `.click()`

**受影响平台**：知乎（所有 React 组件）

**现象**：
- `element.click()` 能关闭下拉框（`aria-expanded` 变为 `false`）
- 但 React 状态不更新（combobox 的 `value` 不变）
- 选项获得 `focusable focused` 状态，但未被"选中"

**原因**：
- React 18 使用事件委托在根元素监听事件
- `element.click()` 生成的事件 `isTrusted: false`
- React 的合成事件系统可能不处理非可信事件

**解决方案**：
```typescript
// content.ts
async function cdpClickElement(el: HTMLElement): Promise<boolean> {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  await browser.runtime.sendMessage({
    type: 'CDP_CLICK',
    payload: { x, y },
  });
  return true;
}

// background.ts
async function cdpClick(tabId: number, x: number, y: number): Promise<void> {
  const debuggee = { tabId };
  await chrome.debugger.attach(debuggee, '1.3');
  try {
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    });
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });
  } finally {
    await chrome.debugger.detach(debuggee);
  }
}
```

**注意**：`chrome.debugger` 需要 `'debugger'` 权限，attach 时会在页面顶部显示"正在由扩展调试此浏览器"横幅。

#### 难点 2：wujie 微前端 Shadow DOM 隔离

**受影响平台**：视频号

**现象**：
- content script 的 `querySelectorAll('*')` 无法遍历 wujie 的 shadow DOM
- 相同的遍历逻辑在 MAIN world 能找到元素，isolated world 找不到

**解决方案**：通过 `chrome.scripting.executeScript({world:'MAIN'})` 将代码注入页面主世界

**已处理的 wujie 功能**：
- 文本填充（标题、话题、描述）
- 视频上传
- 声明原创（checkbox + 协议勾选 + 确认按钮）
- 定时发布（radio 按钮 + 日期时间设置）

#### 难点 3：下拉框交互模式差异

各平台的"下拉框"交互差异很大：

| 平台 | 下拉类型 | 触发方式 | 选择方式 | 确认方式 |
|------|---------|---------|---------|---------|
| B站创作声明 | 标准下拉 | 点击 `input[readonly]` | 点击 `li.bcc-option` | 自动关闭 |
| 抖音声明 | 弹窗式 | 点击触发器 | 点击 `input[type="radio"]` | 点击"确定"按钮 |
| 微博声明 | 按钮式 | 点击按钮 | 直接选中 | 点击"确定"按钮 |
| 知乎视频标记 | 模态框式 | CDP 点击 combobox | CDP 点击 option | CDP 点击"确认" |
| 快手声明 | combobox | 点击触发器 | 点击选项 | 自动关闭 |

#### 难点 4：日期时间选择器差异

| 平台 | 组件 | 日期选择 | 时间选择 | 关闭方式 |
|------|------|---------|---------|---------|
| B站 | 自定义 | `.date-picker-body-item` 格子 | `.time-picker-panel-select-item` | 点击 body |
| 快手 | ant-picker | `.ant-picker-cell` 格子 | `.ant-picker-time-panel-cell` | 点击"确定" |
| 小红书 | d-datepicker | 输入框直接输入 | 输入框直接输入 | - |
| 知乎 | React 按钮 | CDP 点击按钮 → 日历下拉 | CDP 点击 combobox → 选项 | 自动关闭 |
| 视频号 | wujie shadow DOM | MAIN world 注入 | MAIN world 注入 | - |

#### 难点 5：Vue/React 框架的响应式更新

**Vue 组件**（B站、小红书、快手）：
- `input.checked = true` 不触发 Vue 响应式更新
- 必须使用 `element.click()` 触发
- `nativeInputValueSetter` + `dispatchEvent(input/change)` 对 input 有效

**React 组件**（知乎）：
- `element.click()` 不触发 React 状态更新
- 必须使用 CDP 可信点击
- `nativeInputValueSetter` 对 textarea 有效

---

## 十、动态数据（API 驱动的下拉框）

以下选项的内容通过 API 动态获取，不能硬编码：

| 平台 | 选项 | API 端点 | 说明 |
|------|------|---------|------|
| 抖音 | 关联热点 | `GET /aweme/v1/hotspot/recommend/` | 实时热点，每次加载不同 |
| 抖音 | 位置 | `GET /aweme/v1/life/video_api/search/poi/?keywords={keyword}` | 搜索型，需输入关键词 |
| 抖音 | 官方活动 | `GET /web/api/media/activity/get/?page=1&size=9999` | 活动列表，定期更新 |
| 抖音 | 合集 | `GET /web/api/mix/list/?status=0,2&count=15` | 用户自己的合集列表 |
| 抖音 | 自主声明 | `GET /aweme/v3/user_declaration/suggestion/` | 声明建议 |
| 快手 | 关联热点 | combobox 搜索型 | 输入关键词搜索 |
| 快手 | 地区 | combobox 级联选择 | 省→市→区 |
| 小红书 | 活动话题 | 页面加载时获取 | 活动列表 |
| B站 | 分区 | 点击展开分区树 | 固定分类 |
| B站 | 创作声明 | 点击展开下拉 | 固定选项 |
| 知乎 | 视频标记 | combobox 展开 | 固定选项 |
| 知乎 | 所属领域 | combobox 展开 | 固定选项 |

---

## 十一、自动化优先级

### P0 - 必须实现 (所有平台通用)
1. 视频上传
2. 标题/描述文本填充
3. 发布按钮点击
4. 保存草稿/暂存

### P1 - 高优先级 (大多数平台)
5. 定时发布 (6/7 平台)
6. 谁可以看 (4/7 平台)
7. 封面设置 (6/7 平台)

### P2 - 中优先级
8. 位置 (4/7 平台, 需 API)
9. 活动参与 (5/7 平台)
10. 合集 (4/7 平台)
11. 原创声明 (4/7 平台)

### P3 - 低优先级 (平台特有)
12. B站: 分区、标签、创作声明、弹幕管理
13. 快手: 作者服务、作者声明、同城、允许下载
14. 视频号: 短标题、链接
15. 知乎: 视频标记、所属领域、内容来源
16. 微博: 内容声明(必填)
