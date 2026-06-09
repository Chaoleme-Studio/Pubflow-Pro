# 工作区存储结构

## 当前结论

项目业务数据放在各自项目目录中，`pubflow-data.json` 只做全局配置、当前草稿和项目索引。

这样设计的目标是：把 `projects/<project>/` 拷到另一台电脑或另一个工作区后，后续可以通过扫描项目目录恢复项目本身，而不是依赖浏览器内部缓存或一个越来越大的根 JSON。

## 文件职责

### `pubflow-data.json`

根目录轻量文件，只保存：

- `draft`：当前编辑草稿。
- `settings`：平台设置、全局设置、服务配置、AI 设置。
- `projectIndex`：项目索引，用于快速展示和定位项目目录。

它不再保存完整视频库和发布记录。

### `projects/<project>/project.json`

项目业务主文件，保存：

- `video`：标题、描述、话题、素材文件名、平台状态等。
- `records`：该项目对应的发布记录。

项目素材继续放在：

- `projects/<project>/assets/video/`
- `projects/<project>/assets/cover/`
- `projects/<project>/assets/music/`
- `projects/<project>/assets/images/`

## 浏览器本地缓存

`chrome.storage.local` / `browser.storage.local` 只作为兜底和快速恢复缓存：

- 没有选择工作区时，可以继续使用浏览器缓存。
- 选择了工作区后，项目业务数据以 `project.json` 为准。
- 清空浏览器缓存不删除工作区文件。

## 读写原则

- 读取素材库时，优先扫描 `projects/*/project.json`。
- 写入视频状态时，写回对应项目的 `project.json`。
- 写入发布记录时，按 `videoId` 合并回对应项目的 `project.json`。
- 根 `projectIndex` 只负责索引，不作为业务事实来源。

## 迁移和兼容

当前重构不保留旧版 `pubflow-data.json` 的视频库兼容逻辑。已有浏览器缓存中的视频和记录，在选择空工作区初始化时会写入各项目目录。

## 删除功能

当前删除采用软删除优先：

- 项目级删除：优先把 `projects/<project>/` 复制到工作区根目录 `Trash/`，再删除原项目目录。
- 索引标记：在 `projectIndex` 中记录 `deletedAt`。
- 浏览器缓存同步移除对应项目。
- 如果浏览器文件 API 不允许删除原目录，则在原项目 `project.json` 写入 `deletedAt`，后续扫描项目时跳过它。

这样比直接删除 JSON 和素材更稳，误删后还能从 `Trash/` 恢复。
