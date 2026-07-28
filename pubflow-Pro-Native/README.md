# PubFlow Pro Native

基于项目内 `pubflow-Pro-server-axum-starter` 的 Rust 2024、Tokio、Axum 结构精简而成。
它是一个本地常驻进程，同时承担：

- 接收 Python CLI、网页端或未来手机端提交的完整发布配置；
- 将本机素材复制并组装为 PubFlow v2 Project；
- 使用 SQLite 保存可靠任务队列；
- 通过 WebSocket 唤醒 Chrome 插件，并接收发布状态。

Native 不使用 Chrome Native Messaging，也没有第二个 Bridge 进程。

授权能力严格分为三层：`basic` 仅支持插件手动发布，`plus` 增加 Native/脚本/局域网发布，`pro` 再增加云端网页和云端 WebSocket。Basic 插件不会建立 Native WebSocket；Native 登录、建单和领单还会检查插件当前验证过的 Plus/Pro 能力；真正开始发布时，服务端会按数据库中的 License 再校验一次 `source=native` permit。

## 启动

这里的工作区必须与 Chrome 插件 Dashboard 已选择并授权的目录完全相同。
从仓库中直接运行时，Native 会与其他子项目一样读取根目录 `.env.development`；设置 `ENV=production` 则读取 `.env.production`。已安装到用户电脑的 Native 继续使用 `~/.pubflow-pro-native/config.json`，不依赖源码仓库。
首次启动直接运行，Native 会弹出系统目录选择器：

```bash
cargo run
```

Native 会把选择结果保存到 `~/.pubflow-pro-native/config.json`。后续直接运行即可。无人值守部署仍可显式传入：

```bash
cargo run -- --workspace "/绝对路径/PubFlowWorkspace"
```

需要切换工作区时，可在本机发布页点击文件夹按钮，或执行 `cargo run -- --select-workspace`；选择结果在下次启动生效。也可再次传入新的 `--workspace`。Native 不会静默创建默认工作区，避免插件和 Native 各自使用不同目录。
Native 还会在工作区写入 `.pubflow-workspace.json`。插件在 WebSocket `HELLO` 中回传其中的身份 ID；`/health` 的 `workspaceMatched` 只有在两端确实访问同一目录时才为 `true`。

服务默认监听 `0.0.0.0:5190`，从而允许同一局域网的手机打开本地发布页。Native 在应用层只接受回环、RFC1918 私网、IPv4/IPv6 链路本地和 IPv6 ULA 地址，不接受公网来源。监听地址和端口优先级为 `--host/--port`、已导出环境变量或根 `.env.*` 中的 `PUBFLOW_AGENT_HOST/PUBFLOW_AGENT_PORT`、`config.json`、默认值 `0.0.0.0:5190`。

同一份根配置会把端口注入插件构建、网页开发代理和 `send_job.py`；修改端口后需重新构建/加载插件。首次启动会生成：

```text
~/.pubflow-pro-native/config.json
~/.pubflow-pro-native/api-token
~/.pubflow-pro-native/jobs.sqlite3
```

然后用 Python 脚本模拟手机端：

```bash
python3 send_job.py examples/video-job.json
```

修改 `examples/video-job.json` 中的素材绝对路径和目标平台即可。`platforms` 可从插件支持的平台中任意选择，不限定必须是七个。
示例没有设置 `requestId`，因此每次运行都会创建新任务。真实调用方可以传入全局唯一的 `requestId` 实现幂等；重复值只会返回历史任务，不会重新发布。

脚本提交前会显示 Native 当前工作区和插件连接状态。插件不在线、工作区身份不匹配或当前授权不含 Native 能力时，脚本都会拒绝提交。HTTP `201` 表示新建任务，HTTP `200` 表示命中了已有 `requestId`。

## 局域网页面

Native 二进制内嵌官网的发布页面，手机与电脑连接同一局域网后打开：

```text
http://电脑局域网IP:5190/publish?transport=local
```

本地页面使用访问密码登录，默认值为 `123456`，可通过 `PUBFLOW_LOCAL_PASSWORD`、`--local-password` 或 `config.json` 修改。页面先获取一次性 P-256 公钥挑战，通过 ECDH + HKDF-SHA256 派生临时密钥，再用 AES-256-GCM 加密密码。密码正确且在线插件具有有效 Plus/Pro 能力时，Native 只向页面写入最长 15 分钟的随机 `HttpOnly + SameSite=Strict` Cookie。

本地密码只防止局域网中的随意访问，不授予套餐能力。应用层加密可以阻止被动抓包直接看到密码，但纯 HTTP 无法抵御主动中间人篡改页面。需要抵御主动中间人时，应在 Native 前配置可信局域网 HTTPS；不要把 `5190` 暴露到公网。

本地页面的素材不会经过公网，也不计云端每天 3 次 / 100 MiB 的额度。它先把素材流式写入 `~/.pubflow-pro-native/staging`，校验声明大小和 SHA-256，完成后复用原有 Project 装配、SQLite 队列和 WebSocket 定向通知。页面支持 `fill_only` 和 `auto_submit`；脚本未传 `publishMode` 时默认 `fill_only`。

## 工作区排查

插件 Dashboard 只显示目录名，Native 启动日志显示绝对路径；两者必须指向同一个实际目录。`scripts/build-extension.sh` 只重建并复制扩展文件，不会删除 Chrome Profile、IndexedDB 或已保存的目录句柄。手工移除扩展再重新安装则可能清除插件授权，需要在 Dashboard 重新选择工作区。

## 可选插件鉴权

开发阶段 WebSocket 默认校验 `chrome-extension://` Origin。生产使用时建议同时设置：

```bash
export PUBFLOW_ALLOWED_EXTENSION_IDS="你的扩展ID"
export PUBFLOW_EXTENSION_TOKEN="至少24位的随机字符串"
```

插件端将同一个 Token 写入 `chrome.storage.local` 的 `pubflow:agent-settings.extensionToken` 后连接。

## 构建发布包

Native 使用 `rust-embed` 编译进 `pubflow-Pro-Web/dist`。仓库根目录提供统一脚本，先构建网页再构建 Rust 二进制：

```bash
ENV=production ./scripts/build-native.sh
```

脚本按当前 Rust host 命名产物，运行时不需要单独携带网页文件。例如 Apple Silicon Mac 会生成：

```text
dist/native/pubflow-pro-native-mac-arm64
dist/native/pubflow-pro-native-mac-arm64.zip
```

Release CI 使用原生 runner 同时构建 `mac-arm64`、`mac-x64`、`win-x64` 和 `linux-x64`。需要显式构建某个已安装的 Rust target 时可传入 `--target`；直接在 `pubflow-Pro-Native` 中执行 `cargo build` 前，需要先保证 `pubflow-Pro-Web/dist` 已存在且为最新版本。

正式发布工作站为 macOS。安装 `cargo-zigbuild`、`cargo-xwin` 和对应 Rust targets 后，可一次生成四个平台：

```bash
ENV=production ./scripts/build-native-all.sh
```

该脚本在 Mac 上使用原生 Cargo 构建两个 macOS target、使用 `cargo-zigbuild` 构建 Linux x64、使用 `cargo-xwin` 构建 Windows x64。目标 Linux 服务器只接收并运行已编译产物，不参与编译。
