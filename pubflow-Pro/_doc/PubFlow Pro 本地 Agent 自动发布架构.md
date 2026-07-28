# PubFlow Pro 本地 Agent 自动发布架构

> 状态：第一条纵向链路已实现
> 日期：2026-07-26
> 涉及项目：`pubflow-Pro`、`pubflow-Pro-Native`、`pubflow-Pro-server-axum-starter`
> 实现栈：Rust/Axum Native + TypeScript/WXT 插件 + Python 手机模拟脚本

## 1. 最终方案

```text
Python send_job.py / 本地网页 / 未来手机端
                    │
                    │ HTTP POST（完整页面配置 + 素材本机路径）
                    ▼
pubflow-Pro-Native（单个 Rust/Axum 常驻进程）
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
  SQLite 队列   v2 Project    WebSocket Hub
                 + 素材复制          │
                                    ▼
                         Chrome 插件 Service Worker
                                    │
                                    ▼
                         ProjectTaskAssembler
                                    │
                                    ▼
                         DistributionCoordinator
                                    │
                                    ▼
                      现有授权/permit/多平台发布流程
```

结论只有三个重点：

1. `pubflow-Pro-Native` 是一个 Rust 二进制，不再拆 Agent 与 Native Bridge。
2. Python 不是 Native，只是模拟尚未开发的手机端，负责发起 HTTP 请求。
3. WebSocket 是 Native 与插件的主通道；`chrome.alarms` 只负责每分钟检查和恢复连接。

第一版不使用 SSE 和 Native Messaging。媒体文件只复制到本地 Project，不经过 WebSocket。

## 2. 为什么是 WebSocket + alarms

### WebSocket

Native 需要即时通知插件有新任务，插件也需要持续回传领取、执行、平台进度和错误。WebSocket 正好提供一条双向通道，并允许 Rust Native 始终保持单进程。

插件每 20 秒发送一次 `PING`；Chrome 最低版本设为 116。断线按 1、2、5、10、30 秒退避重连。

### chrome.alarms

alarms 不是消息通道，不能携带任务，也不能由 Rust 主动调用。它的作用只有：

- 每分钟唤醒 Service Worker 检查 WebSocket；
- 发现断线时重新连接；
- 重连后通过 `STATE_SNAPSHOT` 领取遗漏任务。

### 为什么不用 SSE

SSE 只有 Native → 插件单向推送。任务 ACK、状态和错误仍要额外走 HTTP，而且 MV3 对 SSE 没有与 WebSocket 相同的生命周期支持。

### 为什么不用 Native Messaging

Native Messaging 会由 Chrome 根据 Host manifest 启动 stdin/stdout 子进程。若同时还需要一个在 Chrome 关闭时接单的常驻 Agent，运行时通常会变成两个进程。当前 WebSocket 方案不需要第二个 Bridge，也不需要 `nativeMessaging` 权限和系统注册表/Host 清单安装。

## 3. Rust Native 的来源和边界

`pubflow-Pro-Native` 参考并精简自仓库内的 `pubflow-Pro-server-axum-starter`：

- 保留 Rust 2024、Tokio、Axum、Tracing 的服务组织方式；
- 删除云服务才需要的 PostgreSQL、Redis、支付、License 管理、管理后台和数据库迁移；
- 本地任务库改用 SQLite；
- 保持为一个可直接打包的二进制 crate。

`pubflow-Pro-server-axum-starter` 本身不需要改动。现有服务端仍负责：

- License 验证；
- Device proof；
- distribution permit；
- 授权冻结、过期和版本策略。

Native 不持有插件 lease token 或设备私钥，也不直接操作发布网页。

## 4. 当前代码结构

### 4.1 Rust Native

```text
pubflow-Pro-Native/
├── Cargo.toml
├── Cargo.lock
├── README.md
├── send_job.py                 # Python 手机模拟器，仅发 HTTP
├── examples/
│   └── video-job.json          # 完整发布配置示例
└── src/
    ├── main.rs                 # Tokio/Axum 启动和优雅关闭
    ├── config.rs               # 端口、工作区、Token、扩展白名单
    ├── models.rs               # 请求、平台和 WebSocket 协议模型
    ├── database.rs             # SQLite 队列、领取和单调状态序列
    ├── project.rs              # v2 Project 原子生成与素材复制
    ├── routes.rs               # HTTP、内嵌网页、LAN 边界、WebSocket Hub
    ├── local_api.rs            # 局域网短会话、素材暂存和任务接口
    ├── state.rs                # AppState、广播和创建任务锁
    └── error.rs                # HTTP 错误映射
```

### 4.2 插件新增模块

```text
pubflow-Pro/src/
├── agent/
│   ├── protocol.ts             # Native/插件消息协议
│   └── agentClient.ts          # WS、心跳、退避重连、alarm watchdog
└── features/distribution/
    ├── distributionCoordinator.ts  # Dashboard/Agent 共用启动入口
    └── projectTaskAssembler.ts     # 无 UI Project/素材装配
```

`entrypoints/background.ts` 负责把这些模块接入原发布状态机，但不复制任何平台发布处理器。

## 5. HTTP 接单模型

Python、网页端和未来手机适配层提交的是“页面完整配置”，不是一个预先存在的 `projectId`：

```http
POST http://127.0.0.1:5190/v1/jobs
Authorization: Bearer <~/.pubflow-pro-native/api-token>
Content-Type: application/json
```

```json
{
  "requestId": "phone-task-001",
  "contentType": "video",
  "title": "标题",
  "description": "描述",
  "articleContent": null,
  "topics": ["话题1", "话题2"],
  "campaignIds": [],
  "platforms": ["douyin", "xiaohongshu", "weixinChannels"],
  "scheduledAt": null,
  "visibility": "public",
  "originalDeclare": false,
  "platformSettings": {},
  "fillOptions": {
    "topicIntervalMs": 800
  },
  "assets": {
    "videoPath": "/本机绝对路径/video.mp4",
    "coverPath": "/本机绝对路径/cover.jpg",
    "imagePaths": [],
    "musicPath": null
  }
}
```

`platforms` 由每次请求决定，不固定必须七个平台。Rust 使用枚举白名单校验当前插件支持的十个平台；插件再按 `contentType` 过滤平台能力。

当前素材输入是 Native 电脑能访问的本机路径。未来手机上传文件或 URL 下载时继续使用同一个任务模型，只需要在 HTTP 层新增上传/下载适配，不改插件协议。

`requestId` 是调用方幂等键；重复提交会返回已有任务，不会重复创建 Project。
生产调用方应为一次业务发布生成全局唯一值；需要重试同一请求时复用该值。仓库示例不填写 `requestId`，避免本地多次演示一直命中旧任务。

## 6. Native 生成的工作区

Native 工作区必须与插件 Dashboard 选择并授权的目录完全相同：

首次直接启动时，Native 弹出系统目录选择器，校验目录存在后将绝对路径保存到 `~/.pubflow-pro-native/config.json`；后续可直接启动。无人值守环境可使用 `--workspace`。切换目录可使用本机发布页的工作区按钮或 `--select-workspace`，并在重启后生效。Native 不会静默创建一个可能与插件授权不一致的默认目录。

Native 在工作区根目录维护 `.pubflow-workspace.json` 身份文件。插件读取已授权目录中的 `workspaceId` 并通过 WebSocket `HELLO` 回传；Native 比较后在 `HELLO_ACK` 和 `/health.workspaceMatched` 中返回结果。插件只有在匹配成功后才领取任务；Python 在插件在线但不匹配时拒绝提交。

```text
Workspace/
├── .pubflow-workspace.json
├── pubflow-data.json
└── projects/
    └── <projectId前8位>-<标题>-<类型>/
        ├── project.json
        └── assets/
            ├── video/
            ├── cover/
            ├── music/
            └── images/
```

处理步骤：

1. 校验内容类型、标题、平台、必需素材和文件扩展名/大小；
2. 生成 `jobId` 与 `projectId`；
3. 在同一文件系统的临时目录复制素材；
4. 写入标准 v2 `project.json`；
5. 原子重命名为最终 Project 目录；
6. 原子更新根 `pubflow-data.json.projectIndex`；
7. 写入 SQLite `queued` 队列；
8. 广播 `JOB_AVAILABLE`。

视频、图片和封面字节不会出现在 HTTP 响应或 WebSocket 消息中。

## 7. WebSocket 协议与执行流程

连接地址：

```text
ws://127.0.0.1:5190/v1/extension/ws
```

核心消息：

| 方向 | 消息 | 用途 |
|---|---|---|
| 插件 → Native | `HELLO` | 上报扩展 ID 和版本 |
| Native → 插件 | `STATE_SNAPSHOT` | 连接时给出下一条 queued 任务 |
| Native → 插件 | `JOB_AVAILABLE` | 实时通知新任务 |
| 插件 → Native | `CLAIM_JOB` | 原子领取，只允许一个 active job |
| Native → 插件 | `JOB_DETAIL` | 返回 projectId、平台和任务元数据 |
| 插件 → Native | `JOB_ACCEPTED` | Project 已装配并进入发布入口 |
| 插件 → Native | `JOB_STATUS` | 回传任务/平台状态和错误 |
| 双向 | `PING` / `PONG` | 20 秒心跳 |

完整执行顺序：

```text
JOB_AVAILABLE
  → CLAIM_JOB
  → SQLite queued → claimed
  → JOB_DETAIL
  → 检查工作区权限
  → 读取 project.json 和 assets
  → 视频/封面/图片写入现有 transfer cache
  → JOB_ACCEPTED
  → DistributionCoordinator
  → 现有 License verify + permit
  → 顺序打开并填充目标平台
  → JOB_STATUS（sequence 单调递增）
```

Dashboard 的 `START_DISTRIBUTION` 和 Agent 的 `JOB_DETAIL` 最终都调用同一个 `startDistribution()`。因此授权、permit、当前任务持久化、页面打开和平台发布逻辑只有一份。

## 8. 队列、幂等和恢复

SQLite 任务状态：

```text
queued → claimed → running → completed / failed / cancelled
```

当前规则：

- 同一时刻只允许一个 `claimed` 或 `running` 任务；
- Agent 只领取 `queued`；
- `statusSequence` 必须递增，旧回执会被忽略；
- Dashboard 正在发布时，插件暂不领取 Agent 任务；
- 任务完成后插件尝试领取已收到的下一条任务；
- Rust Native 重启时把 `claimed/running` 恢复为 `queued`；
- 插件重连时 Native 通过 `STATE_SNAPSHOT` 补发下一条任务。

第一阶段仍有一个明确边界：若 Chrome 在平台操作中途崩溃，需要依赖插件现有 `currentTask` 恢复；Native 与插件对“崩溃前已打开的平台页面”的精确对账属于下一阶段恢复测试，不能承诺完全无人值守重放。

## 9. 安全边界

当前实现：

- Native 默认监听 `0.0.0.0:5190`，但只允许回环、RFC1918、链路本地和 IPv6 ULA 来源；
- HTTP 创建和查询任务必须携带随机 API Token；
- Token 首次启动生成在 `~/.pubflow-pro-native/api-token`，Unix 权限设为 `0600`；
- WebSocket 必须来自 `chrome-extension://` 或 `moz-extension://` Origin；
- 可通过 `PUBFLOW_ALLOWED_EXTENSION_IDS` 绑定正式扩展 ID；
- 可通过 `PUBFLOW_EXTENSION_TOKEN` 增加插件 Token；
- 平台 ID 使用 Rust/TypeScript 双端白名单；
- 素材路径只作为复制来源，目标目录由 Native 自己生成，请求不能指定任意写入位置；
- `basic` 插件不建立 Native WebSocket；Native 登录、建单和领单还会要求当前有效的 `plus/pro` 插件能力；
- 局域网页面使用一次性 P-256 ECDH + HKDF-SHA256 + AES-256-GCM 保护本地访问密码；
- 素材上传逐文件校验声明大小和 SHA-256，完成前只写入 Native staging；
- 激活码、lease token、permit、设备私钥和媒体字节均不经过 Native WebSocket；WebSocket 只携带套餐、能力列表和到期时间用于前置拦截；
- 每次真正开始 Native 任务时，插件仍向服务端申请 `source=native` permit，服务端按数据库中的 License 终审，Basic 无法绕过。

开发阶段允许扩展 ID 白名单和 WebSocket Token 留空，仍会校验扩展 Origin。正式安装包必须配置固定扩展 ID。

Native 不开放任意来源 CORS，本地页面由 Rust 二进制同源托管。本地密码默认 `123456`，只用于防止随意访问，不替代套餐授权。应用层加密能防止被动抓包读取密码，但纯 HTTP 无法抵御主动中间人篡改页面；需要该威胁级别时应配置可信局域网 HTTPS。`5190` 不应映射到公网。

## 10. 启动和验证

### 10.1 首次准备

1. 在插件 Dashboard 选择一个 PubFlow 工作区并授权。
2. 首次直接启动 Rust Native，并在系统目录选择器中选择同一个工作区：

```bash
cd pubflow-Pro-Native
cargo run
```

首次成功后，后续启动可简化为：

```bash
cargo run
```

3. 保持 Chrome 插件已加载并完成 License 激活。
4. 手机和电脑在同一局域网时，也可打开 `http://电脑IP:5190/publish?transport=local`。
5. 脚本用户修改 `examples/video-job.json` 的素材路径和平台后发起：

```bash
python3 send_job.py examples/video-job.json
```

脚本会自动读取 `~/.pubflow-pro-native/api-token`，并在提交前输出 `/health` 返回的工作区绝对路径和插件连接状态。`201 Created` 表示新建任务，`200 OK` 表示 `requestId` 命中历史任务。

`scripts/build-extension.sh` 只生成和复制扩展产物，不会清除 Chrome 的 IndexedDB 或工作区目录授权。手工删除扩展再安装可能清除这些浏览器数据，此时需要在 Dashboard 重新选择目录。

### 10.2 当前验证结果

已通过：

- Rust `cargo test`；
- Rust `cargo clippy --all-targets -- -D warnings`；
- 插件 `vue-tsc --noEmit`；
- 插件 57 个 Vitest 测试；
- 插件 Chrome MV3 生产构建；
- Python → Rust HTTP → SQLite → v2 Project → 素材复制真实冒烟测试。

仍需人工浏览器验收：使用真实工作区、有效 License 和已登录平台账号，从 Python 请求触发至少一个平台的上传与填充。验证码、登录过期、滑块和平台风控仍可能进入人工处理状态。

## 11. 项目改动清单

### `pubflow-Pro-Native`

新建 Rust/Axum 单二进制项目；Python 仅保留 `send_job.py`。

### `pubflow-Pro`

- Manifest 增加 `alarms` 与 Chrome 116 最低版本；
- 新增 Agent WebSocket 客户端和协议；
- 新增无 UI `ProjectTaskAssembler`；
- 新增 Dashboard/Agent 共用 `DistributionCoordinator`；
- `DistributionTask` 增加 `source`、`externalJobId`、`projectId`、`statusSequence`；
- 后台每次持久化任务时同步回传 Native 状态。

### `pubflow-Pro-server-axum-starter`

增加 `basic / plus / pro` 严格能力模型；`source=native` permit 只允许 Plus/Pro，作为实际发布前不可绕过的服务端终审。

### `pubflow-Pro-Web`

远程和本地复用同一个发布表单，通过传输适配器切换 `/v1/remote/*` 与 `/v1/local/*`。Native 编译时将网页产物嵌入单个二进制。

## 12. 一句话心智模型

```text
HTTP 把完整发布配置交给 Rust Native；
Rust Native 生成 Project 并排队；
WebSocket 即时叫醒插件并回传状态；
alarms 只在 WebSocket 掉线时把连接救回来。
```
