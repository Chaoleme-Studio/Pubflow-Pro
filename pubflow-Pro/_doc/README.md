# PubFlow 文档索引

> 这里按“产品设计、平台调研、技术实现、授权保护”整理文档入口。平台相关文档统一使用 `platform-*` 前缀，避免视频、图文、文章三套发布流程混在一起。

## 产品与实现

- [`product-prd-v2.md`](./product-prd-v2.md)：产品 PRD，描述 PubFlow 的功能范围、页面结构和交互目标。
- [`platform-implementation-技术实现.md`](./platform-implementation-技术实现.md)：平台发布自动化的技术实现说明，包含 WXT、content script、background、DOM 注入等实现边界。
- [`workspace-storage-architecture.md`](./workspace-storage-architecture.md)：工作区、本地草稿、发布记录和设置持久化结构。

## 平台发布调研

- [`platform-overview-功能兼容性矩阵.md`](./platform-overview-功能兼容性矩阵.md)：视频、图文、文章三类内容在各平台的支持情况总表。
- [`platform-video-发布元素定位.md`](./platform-video-发布元素定位.md)：短视频发布页的元素定位、字段、封面、定时、平台个性化设置。
- [`platform-image-图文发布调研.md`](./platform-image-图文发布调研.md)：图文发布流程调研，覆盖抖音、小红书、快手、视频号、微博等平台。
- [`platform-article-文章发布调研.md`](./platform-article-文章发布调研.md)：文章/专栏发布流程调研，覆盖抖音文章、B 站专栏、知乎专栏等。
- [`platform-appendix-视频号DOM元素要点.md`](./platform-appendix-视频号DOM元素要点.md)：视频号 DOM 和 wujie 微前端细节附录，只作为平台专项资料。

## 授权与保护

- [`licensing-protection-design-v3.md`](./licensing-protection-design-v3.md)：代码保护、授权、机器绑定、离线证书和 Native Helper 的综合方案。
- [`archive/code-protection-analysis.md`](./archive/code-protection-analysis.md)：旧代码保护分析，已合并到 v3 总方案。
- [`archive/licensing-design-v2.md`](./archive/licensing-design-v2.md)：旧授权 v2 方案，已被 v3 总方案替代。

## 专项资料

- [`封面定位技巧/README.md`](./封面定位技巧/README.md)：各平台封面定位和注入经验索引。
