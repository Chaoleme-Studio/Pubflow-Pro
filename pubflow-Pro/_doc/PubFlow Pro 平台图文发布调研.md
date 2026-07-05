# 多平台图文发布调研报告

> 调研时间：2026-05-22
> 调研方式：Chrome DevTools MCP 逐平台快照分析
> 范围：只覆盖“多图/图文动态”发布流程，不覆盖 B 站专栏、知乎专栏这类长文章编辑器。

---

## 一、各平台图文发布页面URL

| 平台 | 图文发布URL | 备注 |
|------|------------|------|
| B站 | `https://member.bilibili.com/platform/upload/text/new-edit` | 专栏投稿 |
| 抖音 | `https://creator.douyin.com/creator-micro/content/upload?default-tab=3` | 或 `/content/post/image` |
| 小红书 | `https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=image` | target=image |
| 快手 | `https://cp.kuaishou.com/article/publish/video?tabType=2` | tabType=2 |
| 知乎 | `https://zhuanlan.zhihu.com/write` | 知乎专栏 |
| 微博 | `https://weibo.com/` | 首页发布框，图文视频共用 |
| 视频号 | `https://channels.weixin.qq.com/platform/post/finderNewLifeCreate` | 发表动态 |

---

## 二、图文发布模式分类

### 模式A：先上传图片再编辑（与视频类似）

**适用平台**：抖音、小红书、快手、视频号

**流程**：
1. 上传图片（拖拽或点击）
2. 填写标题/描述
3. 设置封面、标签等
4. 发布

**特点**：
- 图片是独立上传的
- 上传后才能编辑内容
- 与视频发布流程类似

### 模式B：富文本编辑器内添加图片

**适用平台**：B站、知乎

**流程**：
1. 进入编辑器
2. 填写标题
3. 在正文中通过工具栏插入图片
4. 设置封面、标签等
5. 发布

**特点**：
- 图片是编辑器内容的一部分
- 可以在文章任意位置插入图片
- 更接近传统文章编辑

### 模式C：统一发布框

**适用平台**：微博

**流程**：
1. 在首页发布框输入内容
2. 通过工具栏添加图片/视频
3. 发送

**特点**：
- 图文和视频使用同一个发布框
- 功能最简化
- **不需要改动，现有代码已支持**

---

## 三、各平台图文上传详细参数

### 3.1 抖音 (douyin)

**上传区域**：
- 按钮：`button "上传图文"` 或 `button "选择文件"`
- 拖拽支持：是

**图片限制**：
- 格式：jpg、jpeg、png、webp（不支持gif）
- 大小：单张不超过50MB
- 数量：最多35张
- 比例：不建议宽高比超过1:2，推荐3:4、4:3

**编辑界面元素**：
| 元素 | 类型 | 详情 |
|------|------|------|
| 标题 | `textbox "添加作品标题"` | 最大20字符 |
| 描述 | contenteditable | 支持 #话题 @好友，最大1000字符 |
| 封面设置 | 选择 | 从已上传图片中选择 |
| 编辑图片 | 功能 | 可对图片进行编辑 |
| 继续添加 | button | 添加更多图片 |
| 添加合集 | 选择 | 选择合集 |
| 自主声明 | 选择 | 选择声明类型 |
| 选择音乐 | 功能 | 添加背景音乐 |
| 添加标签 | 功能 | 添加标签 |
| 位置 | 搜索 | 输入位置搜索 |
| 关联热点 | 搜索 | 输入热点词 |
| 同时发布 | checkbox | 同时发布到其他平台 |
| 谁可以看 | radio | 公开/好友可见/仅自己可见 |
| 保存权限 | radio | 允许/不允许 |
| 发布时间 | radio + datetime | 立即发布/定时发布 |

**操作按钮**：
- `button "发布"`
- `button "暂存离开"`

**技术栈**：React + Semi Design
**需要激活标签页**：是

---

### 3.2 小红书 (xiaohongshu)

**上传区域**：
- 按钮：`button "上传图片"` 或 `button "文字配图"`
- 拖拽支持：是（提示"上传图片，或写文字生成图片"）

**图片限制**：
- 格式：png、jpg、jpeg、webp（不支持gif、live及其转化后的图片）
- 大小：单张不超过32MB
- 分辨率：推荐3:4至2:1之间，不低于720*960

**编辑界面**：需上传图片后才能看到完整界面

**技术栈**：React + 自定义组件
**需要激活标签页**：是

---

### 3.3 快手 (kuaishou)

**上传区域**：
- 按钮：`button "上传图片"`
- 拖拽支持：是（提示"拖拽图片到此或点击上传"）

**图片限制**：
- 格式：png、jpg、jpeg、webp（不支持gif、livp）
- 大小：单张不超过15MB
- 数量：最多31张
- 比例：推荐宽高比3:4竖版图片

**技术栈**：React + CSS Modules
**需要激活标签页**：是

---

### 3.4 视频号 (weixinChannels)

**上传区域**：
- 按钮：`button "发布图片动态，可上传最多18张图片，单张不超过20MB，支持常见图片格式。"`

**图片限制**：
- 格式：常见图片格式
- 大小：单张不超过20MB
- 数量：最多18张

**编辑界面元素**：
| 元素 | 类型 | 详情 |
|------|------|------|
| 图文标题 | `textbox "填写标题, 22个字符内"` | 最大22字符 |
| 图文描述 | contenteditable | 支持 #话题 @视频号 |
| 位置 | 选择 | 已选城市 |
| 添加到合集 | 选择 | 选择合集 |
| 链接 | 选择 | 添加外部URL |
| 音乐 | 选择 | 选择背景音乐 |
| 活动 | 选择 | 选择参与活动 |
| 定时发表 | radio | 不定时/定时 |

**操作按钮**：
- `button "保存草稿"`
- `button "手机预览"`
- `button "发表"`

**技术栈**：Vue + Wujie微前端（Shadow DOM）
**需要激活标签页**：是

---

### 3.5 B站 (bilibili)

**上传方式**：通过编辑器工具栏添加图片

**编辑器结构**（iframe内）：
| 元素 | 类型 | 详情 |
|------|------|------|
| 标题 | `textbox "请输入标题（建议30字以内）"` | multiline |
| 正文 | `textbox multiline` | 富文本编辑器 |
| 目录 | 功能 | 自动根据标题生成 |
| 可见范围 | radio | 所有人可见/仅自己可见 |
| 自定义封面 | checkbox | 未设置则自动抓取正文开头文字 |
| 评论开关 | checkbox | 开启/关闭 |
| 精选评论 | checkbox | 开启/关闭 |
| 定时发布 | checkbox | 当前+2小时~7天内 |
| 创作声明 | checkbox | 原创声明/AI辅助创作声明 |
| 话题 | button | 添加话题 |
| 文集 | button | 选择文集 |

**操作按钮**：
- `button "发布设置"`
- `button "保存为草稿"`
- `button "发布"`

**技术栈**：Vue + BCC组件库
**需要激活标签页**：否

---

### 3.6 知乎 (zhihu)

**上传方式**：通过编辑器工具栏添加图片

**编辑器结构**：
| 元素 | 类型 | 详情 |
|------|------|------|
| 标题 | `textbox multiline` | 在编辑器顶部 |
| 正文 | `textbox "请输入正文"` | 富文本编辑器，支持Markdown |
| 工具栏 | buttons | 标题、加粗、斜体、列表、目录、引用、分割线、代码块、注释、图片、视频、链接、公式、表格、导入、草稿备份、更多 |
| 添加封面 | 功能 | 图片上传格式支持JPEG、JPG、PNG |

**操作按钮**：
- `button "预览"`
- `button "发布"`

**技术栈**：React + 自定义组件
**需要激活标签页**：是

**注意**：知乎React组件需要CDP可信点击

---

### 3.7 微博 (weibo)

**上传方式**：通过工具栏添加图片

**发布框结构**：
| 元素 | 类型 | 详情 |
|------|------|------|
| 文本内容 | `textbox "有什么新鲜事想分享给大家？"` | multiline |
| 工具栏 | buttons | 表情、图片、视频、话题、头条文章、更多 |
| 内容声明 | 功能 | 内容无需标注 |
| 定时微博 | 功能 | 需要会员 |
| 可见性 | 选择 | 公开 |

**操作按钮**：
- `button "发送"`

**技术栈**：自定义组件（wbpro组件库）
**需要激活标签页**：否

**注意**：微博图文和视频使用同一个发布框，现有代码已支持，不需要改动

---

## 四、配置文件架构建议

### 方案A：统一配置文件（推荐）

将图文和视频配置放在同一个配置文件中，通过`type`字段区分：

```typescript
// platform-config.ts
export interface PlatformConfig {
  // 通用配置
  name: string;
  url: string;
  needsActivation: boolean;
  
  // 视频配置
  video: {
    uploadUrl: string;
    selectors: VideoSelectors;
    timeout: number;
  };
  
  // 图文配置（新增）
  article?: {
    publishUrl: string;
    mode: 'upload-first' | 'editor' | 'unified';  // 三种模式
    selectors: ArticleSelectors;
    imageLimits: {
      formats: string[];
      maxSize: number;  // MB
      maxCount: number;
      recommendedRatio?: string;
    };
  };
}
```

**优点**：
- 配置集中，易于维护
- 共享通用配置（如needsActivation）
- 便于扩展其他内容类型

**缺点**：
- 配置文件会变大

### 方案B：独立配置文件

图文和视频配置分开存放：

```
src/platforms/
├── douyin/
│   ├── video-config.ts
│   ├── article-config.ts  // 新增
│   └── content.ts
```

**优点**：
- 职责分离，文件更小
- 独立开发，互不影响

**缺点**：
- 配置分散，可能有重复
- 需要额外的整合逻辑

### 建议

**推荐方案A（统一配置文件）**，原因：
1. 图文和视频共享大量通用配置（技术栈、激活策略等）
2. 便于统一管理平台生命周期
3. 现有架构已经按平台组织，增加图文配置是自然扩展

---

## 五、技术实现要点

### 5.1 图片上传方案

**模式A（先上传）**：
- 与视频上传类似，使用DataTransfer注入
- 需要支持多张图片批量上传
- 需要处理图片预览和排序

**模式B（编辑器内）**：
- 通过工具栏按钮触发上传
- 图片作为编辑器内容的一部分
- 需要处理图片插入位置

### 5.2 各平台技术难点

| 平台 | 难点 | 解决方案 |
|------|------|----------|
| 抖音 | React + Semi Design | 与视频相同 |
| 小红书 | React + 自定义组件 | 与视频相同 |
| 快手 | React + CSS Modules | 与视频相同 |
| 视频号 | Wujie Shadow DOM | MAIN world注入 |
| B站 | iframe + 富文本编辑器 | 需要跨iframe操作 |
| 知乎 | React + CDP点击 | CDP可信点击 |
| 微博 | 自定义组件 | 与视频相同 |

### 5.3 需要新增的功能

1. **图片批量上传**：支持多张图片同时上传
2. **图片预览**：上传后显示预览
3. **图片排序**：支持拖拽排序
4. **封面选择**：从已上传图片中选择封面
5. **富文本编辑**：B站、知乎需要操作富文本编辑器

---

## 六、实现优先级

### P0 - 必须实现
1. 图片上传（所有平台）
2. 标题/描述文本填充
3. 发布按钮点击
4. 保存草稿

### P1 - 高优先级
5. 多张图片批量上传
6. 封面选择
7. 定时发布

### P2 - 中优先级
8. 话题/标签
9. 位置
10. 合集
11. 原创声明

### P3 - 低优先级
12. 音乐选择（抖音、视频号）
13. 链接添加（视频号）
14. 活动参与

---

## 七、微博特殊说明

微博的图文和视频使用**同一个发布框**，不需要额外开发：

- 发布框URL：`https://weibo.com/`
- 图片上传：通过工具栏"图片"按钮
- 视频上传：通过工具栏"视频"按钮
- 现有代码已支持微博发布，只需确认图文场景是否正常工作

---

## 八、总结

### 技术可行性

**完全可行**。各平台图文发布的技术实现与视频发布高度相似：
- 图片上传使用相同的DataTransfer注入方案
- 文本填充使用相同的策略
- 特殊平台（视频号、知乎）已有解决方案

### 工作量估算

| 平台 | 工作量 | 说明 |
|------|--------|------|
| 抖音 | 中 | 与视频类似，需适配图片上传 |
| 小红书 | 中 | 与视频类似 |
| 快手 | 中 | 与视频类似 |
| 视频号 | 高 | Shadow DOM + 新页面结构 |
| B站 | 高 | iframe + 富文本编辑器 |
| 知乎 | 高 | React + CDP + 编辑器 |
| 微博 | 低 | 已支持，验证即可 |

### 建议实施顺序

1. 微博（验证现有代码）
2. 抖音、小红书、快手（模式A，与视频类似）
3. 视频号（已有Shadow DOM经验）
4. B站、知乎（需要新的编辑器操作方案）

---

## 九、二次调研确认（2026-05-22 补充）

### 9.1 各平台图文与视频相似度对比

通过实际上传图片后再次确认各平台图文发布界面：

| 平台 | 图文与视频相似度 | 说明 |
|------|----------------|------|
| 视频号 | 95% | 几乎相同，只是上传图片代替视频 |
| 抖音 | 95% | 几乎相同，多了"继续添加"多张图片功能 |
| 小红书 | 95% | 几乎相同，界面结构一致 |
| 快手 | 95% | 几乎相同，界面结构一致 |
| 微博 | 100% | 完全相同，同一个发布框 |
| B站 | 0% | 没有图文板块，只有专栏文章（富文本编辑器） |
| 知乎 | 0% | 没有图文板块，只有专栏文章（富文本编辑器） |

**关键发现**：
- 抖音、小红书、快手、视频号的图文和视频发布流程**几乎完全相同**
- 主要区别仅在于：上传的是图片（多张）而非视频（单个）
- 填充标题、描述、话题、定时发布等逻辑**完全一致**
- B站和知乎**没有图文功能**，只有专栏文章（富文本编辑器模式）

---

## 十、代码架构方案分析

### 方案A：单独做一个图文的Content

```
src/platforms/
├── douyin/
│   ├── video-content.ts      // 视频发布
│   ├── article-content.ts    // 图文发布（新增）
│   └── selectors.ts
├── xiaohongshu/
│   ├── video-content.ts
│   ├── article-content.ts    // 新增
│   └── selectors.ts
...
```

**优点**：
- 职责分离，代码清晰
- 独立开发，互不影响

**缺点**：
- 大量重复代码（填充标题、描述、话题、定时发布、声明等逻辑重复80%以上）
- 维护成本高（改一个功能要改两个文件）
- 文件数量翻倍

---

### 方案B：在原有基础上扩展（推荐）

```
src/platforms/
├── douyin/
│   ├── content.ts            // 统一入口，根据type分发
│   ├── uploadVideo.ts        // 视频上传
│   ├── uploadArticle.ts      // 图文上传（新增）
│   └── selectors.ts          // 统一选择器（新增article相关）
├── xiaohongshu/
│   ├── content.ts
│   ├── uploadVideo.ts
│   ├── uploadArticle.ts      // 新增
│   └── selectors.ts
...
```

**优点**：
- 复用现有代码（80%以上的逻辑相同）
- 维护成本低
- 扩展性好
- 文件数量少

**缺点**：
- 需要重构现有代码，增加type判断

---

### 最终结论：推荐方案B

**理由**：

1. **图文和视频共享80%以上的逻辑**：
   - 标题/描述填充 ✅
   - 话题/标签 ✅
   - 定时发布 ✅
   - 声明/权限 ✅
   - 位置/热点 ✅
   - 发布按钮 ✅

2. **只有上传部分不同**：
   - 视频：单个视频文件
   - 图文：多张图片（需要批量上传）

3. **实现方式**：

```typescript
// content.ts 统一入口
export async function handlePlatform(
  type: 'video' | 'article',  // 新增type参数
  content: ContentData
) {
  // 1. 上传媒体（根据type分发）
  if (type === 'video') {
    await uploadVideo(content.videoFile);
  } else {
    await uploadImages(content.imageFiles);  // 新增
  }
  
  // 2. 以下逻辑完全复用
  await fillTitle(content.title);
  await fillDescription(content.description);
  await fillTopics(content.topics);
  await fillSchedule(content.schedule);
  await fillDeclaration(content.declaration);
  await clickPublish();
}
```

4. **对于B站和知乎**：
   - 因为是完全不同的编辑器模式，需要单独实现
   - 但可以放在同一个平台目录下，作为`article`类型的特殊处理
   - 或者暂时不支持这两个平台的图文发布

---

## 十一、实施建议

### 第一步：在现有content.ts中添加type参数

```typescript
// 修改现有函数签名
export async function handleDouyin(
  type: 'video' | 'article',  // 新增
  content: ContentData
) {
  // ...
}
```

### 第二步：新增uploadImages()函数

```typescript
// 新增图片批量上传函数
async function uploadImages(files: File[]): Promise<void> {
  // 1. 找到file input（可能需要支持multiple）
  // 2. 使用DataTransfer注入多个文件
  // 3. 触发change事件
}
```

### 第三步：为各平台添加图文选择器

```typescript
// selectors.ts
export const douyinSelectors = {
  video: {
    uploadInput: 'input[type="file"][accept="video"]',
    // ...
  },
  article: {
    uploadInput: 'input[type="file"][accept="image"]',
    continueAdd: 'button:has-text("继续添加")',
    // ...
  }
}
```

### 第四步：在配置文件中添加图文相关URL

```typescript
// platform-config.ts
export const douyinConfig = {
  video: {
    publishUrl: 'https://creator.douyin.com/creator-micro/content/upload?default-tab=1',
  },
  article: {
    publishUrl: 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3',
  }
}
```

---

## 十二、图文配乐限制（2026-05-22 补充）

### 12.1 配乐选择限制

**问题**：图文发布时，配乐只能从平台热榜中选择，不支持自定义搜索配乐。

**影响平台**：抖音、快手、视频号

**现状**：
- 配乐列表来自平台热榜
- 无法搜索自定义音乐
- 音乐名称需要统一命名

**解决方案**：
1. 预留 `musicName` 字段，用于后续平台搜索功能
2. 用户可手动在平台页面选择配乐
3. 等待平台开放配乐搜索API

**代码实现**：
- `src/types.ts`：新增 `musicName` 字段
- `entrypoints/dashboard/views/PublishView.vue`：新增配乐名称输入框

---

## 十三、工作量重新评估

基于方案B（在原有基础上扩展）：

| 平台 | 工作量 | 说明 |
|------|--------|------|
| 微博 | 极低 | 已支持，无需改动 |
| 抖音 | 低 | 新增uploadImages()，复用其他逻辑 |
| 小红书 | 低 | 新增uploadImages()，复用其他逻辑 |
| 快手 | 低 | 新增uploadImages()，复用其他逻辑 |
| 视频号 | 低 | 新增uploadImages()，复用其他逻辑（已有Shadow DOM经验） |
| B站 | 中 | 需要单独实现富文本编辑器逻辑 |
| 知乎 | 中 | 需要单独实现富文本编辑器逻辑 |

**总计**：相比方案A，工作量减少约60%
