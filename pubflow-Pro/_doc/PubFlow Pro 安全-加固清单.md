# PubFlow Pro Security Hardening Checklist

> 目标：订阅版不引入 Native Helper，通过短 lease、浏览器实例密钥、服务端控制点和风控提高倒卖/一码多机成本；买断版再上 Native Helper。每完成一项就把 `[ ]` 改成 `[x]`。

## 0. 当前判断

- [x] 订阅版不把浏览器指纹当强设备 ID。
- [x] 订阅版不强制 Native Helper，避免增加安装成本。
- [x] 浏览器设备密钥算法以 `ECDSA P-256 + SHA-256` 为首选，不优先 Ed25519。
- [x] 买断版单独规划 Native Helper，不混进当前扩展主流程。
- [x] 核心商业控制优先级：短 lease > 设备签名证明 > 发布 permit > 风控画像 > 混淆增强。

## 1. 已确认需要调整的补充项

| 项 | 结论 | 项目内处理 |
| --- | --- | --- |
| Ed25519 改成 P-256 | 对 | 2026 年新版浏览器已逐步支持 Ed25519，但解压扩展面向存量 Chrome/Edge/Firefox，扩展端仍以 P-256 为主 |
| 设备密钥丢失恢复 | 对，但不能无条件放行 | 已补清理浏览器数据、重装、换机、自助解绑和后台调整；旧 lease 已绑定设备私钥后，丢失私钥必须消耗迁移额度、自助解绑或进入审核，不能按同 install id 永远放行 |
| challenge/activate 限流 | 对 | 已补按 IP、激活码、lease、device 的业务限流 |
| 离线宽限 UX | 对 | 已补到期前提示、受限模式和服务端时间校准 |
| 密钥轮换 | 对 | P2 做信任链，新协议 key 由构建内置 P-256 信任根验签 |
| 隐私合规 | 对 | 服务端验签需要保存 SPKI 公钥材料；它不是硬件指纹，但隐私说明要写清楚收集范围和保留期限 |
| Admin 审计日志 | 对 | 已补 operator/IP/reason/target id，并覆盖后台冻结/解冻/单设备解绑 |
| 错误信息收敛 | 对 | 客户端友好模糊，服务端日志详细 |
| release 验证脚本 | 对 | 合并成一个脚本，不拆散 |
| 复制完整浏览器 profile | 对，必须写成已知上限 | IndexedDB 里的非导出私钥会随 profile 迁移；订阅版用短 lease、permit、IP/ASN/频率画像兜底，买断版再交给 Native Helper |
| 测试策略 | 对 | 分单元、集成、真实 Chrome profile smoke、手工安全证据门禁四层 |

## 1.1 二次评估修正

- [x] Ed25519 的判断要按 2026 年现实修正：新版 Chrome/Edge/Firefox/Safari 已逐步支持，但存量浏览器、企业环境和解压扩展用户不可控，所以本项目订阅版仍首选 `ECDSA P-256 + SHA-256`。
- [x] “设备公钥只存 hash”不适合本项目当前 challenge/proof：服务端必须保存 SPKI 公钥或等价验签材料，否则无法校验后续签名；隐私口径应改为“不收集硬件指纹，公钥仅用于授权验签，同时保存 hash 作为 device key id”。
- [x] 当前 PFAP v1 `activate-protocol` 不携带 `device_proof`；扩展会在激活后紧接 `/v1/lease/verify` 生成 P-256 设备证明并绑定，发布前 `/permit` 也会再次强制证明。因此它不是离线授权漏洞，但文档不能写成“PFAP 激活包内已经发公钥”。
- [x] 设备密钥丢失恢复不能只按 `clientInstallId` 放行；本项目已按迁移额度、自助解绑、后台 reason 和风控事件处理，避免复制 storage 后无限重绑。
- [x] 复制完整浏览器 profile 仍会带走 IndexedDB 里的非导出私钥，这是浏览器方案的天花板；订阅版用短 lease、permit、IP/ASN/频率画像兜底，买断版再用 Native Helper。

## 1.2 当前验证记录

- [x] 2026-07-04 03:18 CST：`pubflow-Pro` 执行 `pnpm -s typecheck && pnpm -s test:licensing && pnpm -s prepare:manual-security`，8 个 licensing 测试通过，手工 smoke 资产生成成功。
- [x] 2026-07-04 03:18 CST：`pubflow-Pro-server-axum-starter` 执行 `cargo fmt --all && cargo check -p app && cargo test -p app --quiet`，21 个 app 测试通过。
- [x] 2026-07-04 03:18 CST：`pubflow-Pro-Web` 执行 `pnpm -s build`，构建通过；仍有 Vite 单 chunk 超 500 kB 的体积警告。
- [x] 2026-07-04 02:58 CST：使用生产授权服务 `/v1/selector/version` 返回的协议公钥临时注入 `PUBFLOW_PROTOCOL_PUBLIC_KEY`，执行 `OBFUSCATE=1 pnpm -s build && OBFUSCATE=1 pnpm -s verify:release`，protected build 与严格 release verifier 通过。
- [x] 2026-07-04 03:18 CST：复跑 `PUBFLOW_PROTOCOL_PUBLIC_KEY=... OBFUSCATE=1 pnpm -s verify:release`，严格 release verifier 通过。
- [x] 2026-07-04 03:26 CST：补齐 `APP_SERVER_PORT` 显式覆盖后，在隔离端口启动当前源码后端，执行 `pnpm -s smoke:lease-api -- --api http://127.0.0.1:3101 --generate-license` 通过；覆盖 `/challenge -> /activate -> /verify -> /permit`，临时卡密 `PF-0J9A55191K6CLO6V`，permit id `c0d73058-5b30-4d78-bfb7-a4240ba30838`。
- [x] 2026-07-04 03:27 CST：端口覆盖修复后复跑 `cargo test -p app --quiet`，21 个 app 测试通过；复跑 `pnpm -s typecheck && pnpm -s test:licensing`，8 个 licensing 测试通过。
- [x] 2026-07-04 04:04 CST：使用当前源码后端 `http://127.0.0.1:3101` 和本地协议公钥重建扩展，执行 `pnpm -s smoke:extension-security -- --api http://127.0.0.1:3101 --generate-license` 通过；覆盖真实 Chrome profile 激活/permit、复制扩展目录、只复制 `chrome.storage.local`、复制完整 profile、fetch/permit trace、querySelector hook、post-rollout unbound lease 无 proof 拒绝、admin event 查询。
- [x] 2026-07-04 04:05 CST：复跑 `cargo test -p app --quiet`，21 个 app 测试通过；复跑 `pnpm -s typecheck && pnpm -s test:licensing && pnpm -s verify:manual-security`，8 个 licensing 测试和手工安全证据门禁通过。

## 2. P0 - 必须先闭环

- [x] 将订阅 lease 上限改为 31 天，不能再签接近离线授权的 365 天 lease。
- [x] 扩展构建时注入 `PUBFLOW_PROTOCOL_PUBLIC_KEY`，远程保护构建缺失该 key 直接失败。
- [x] 激活时如果服务端返回协议公钥与内置公钥不一致，直接拒绝。
- [x] 修复当前服务端 permit 半实现导致的编译断点。
- [x] 保持订阅版不依赖 Native Helper。

## 3. P1 - 订阅版商业保护主链路

- [x] 扩展首次需要授权验证或发布 permit 时生成浏览器 profile 级设备密钥。
  - [x] 算法：`ECDSA P-256 + SHA-256`。
  - [x] 私钥：`extractable=false`。
  - [x] 存储：IndexedDB `CryptoKey`。
  - [x] 公钥：导出 SPKI，服务端保存 hash 和 SPKI。
  - [x] 现状：PFAP v1 激活响应落地后由紧接的 `/verify` 绑定设备 key；直接调用 PFAP 激活只能拿到未绑定 lease，后续 `/verify`、`/renew`、`/permit` 仍会要求 device proof。
  - Deferred：PFAP v2 可把 `device_key_id/public_key_spki/challenge proof` 纳入激活协议，让激活和设备绑定在同一次加密请求里完成；当前 PFAP v1 后续 `/verify`、`/permit` 已强制 device proof，不作为订阅版发布阻断项。

- [x] 服务端支持设备 challenge/proof。
  - [x] `POST /v1/lease/challenge` 签发一次性 challenge。
  - [x] Redis `GETDEL` 消费 challenge，内存 fallback。
  - [x] 服务端验证 P-256 签名。
  - [x] legacy lease 首次 proof 时绑定设备公钥。
  - [x] 已绑定 lease 后必须使用同一设备公钥。

- [x] 补齐设备密钥丢失/迁移恢复流程。
  - [x] 清理浏览器数据或重装扩展后，允许用 activation code 重新激活。
  - [x] 未绑定旧设备公钥的同 `clientInstallId` 重激活可兼容恢复。
  - [x] 授权中心提供自助解绑旧设备入口，按旧设备占用消耗迁移额度。
  - [x] 授权中心展示剩余迁移/解绑次数。
  - [x] 频繁迁移进入风控标记。
  - [x] 客服/后台可以带 reason 调整迁移额度。
  - [x] 收紧同 `clientInstallId` 重绑：如果旧 lease 已绑定 `device_public_key_spki`，新激活又不能用旧私钥证明，应改为消耗迁移额度、自助解绑或进入风控审核，不能永远免额度。
  - [x] 为“未绑定 device key 的 legacy lease”设置兼容窗口；窗口结束后 `verify/renew` 不再允许无 `device_proof` 放行，避免激活后长期保持未绑定状态。

- [x] 补业务维度限流。
  - [x] 已有路由级 IP 限流。
  - [x] `/v1/lease/activate`：同 IP、同激活码维度限流。
  - [x] `/v1/lease/challenge`：同 IP、同 device 维度限流。
  - [x] `/v1/lease/verify`：同 lease 维度限流。
  - [x] `/v1/lease/renew`：同 device 维度限流。
  - [x] `/v1/lease/permit`：同 device 维度限流。
  - [x] 限流命中写 `license_events` 或风控日志。

- [x] 发布前短期 permit 闭环。
  - [x] 服务端已有 `/v1/lease/permit` 后端入口和 30 分钟 TTL，兼顾一次发布任务中的平台切换和人工检查时间。
  - [x] 扩展新增 `permitManager.ts`，发布前申请 `start_distribution` permit。
  - [x] `START_DISTRIBUTION` 在打开平台前必须拿到 permit。
  - [x] permit 请求必须带 device proof。
  - [x] permit claims 包含 `permit_id / lease_id / license_id / client_install_id / device_key_id / operation / task_hash / key_version`。
  - [x] permit 失败时给用户明确提示：授权需联网验证后才能开始发布。
  - [x] 当前 UX 策略：只在 `START_DISTRIBUTION` 做一次 permit 校验，`OPEN_PLATFORM` / `CONTINUE_FILL` 暂不校验；如后续风险升高，再恢复低频缓存校验。
  - Deferred：device proof 当前只签服务端 challenge，后续可把 `lease_id / purpose / client_install_id` 纳入签名上下文，提高抗重放和上下文绑定强度。

- [x] 离线宽限 UX。
  - [x] 设置页已有授权到期时间展示。
  - [x] 到期前 7 天提示需要联网续租。
  - [x] 到期后进入受限/只读模式，不让发布流程突然崩溃。
  - [x] 文案说明订阅版需要定期联网验证。
  - [x] 使用服务端时间更新本地 `serverTime`，减少只靠 `Date.now()` 的误判。

- [x] 错误信息收敛。
  - [x] 客户端把 `DEVICE_PROOF_INVALID` 等内部码映射成“授权设备验证失败，请重新验证”。
  - [x] 服务端日志保留详细 code、lease、device、IP。
  - [x] 对外响应不要暴露公钥不匹配、签名格式等实现细节。

## 4. P2 - 长期运营能力

- [x] 远程签名配置（暂时废弃 / 未来预留）。
  - [x] 扩展保留 `remoteSelectorManager.ts` 和 PFSP 信任链代码，作为后续恢复云端策略的过渡点。
  - [x] 当前发布主链路不再刷新、应用或依赖远程 selector policy。
  - [x] selector 以插件本地 `src/platforms/*/selectors.ts` 为准，避免云端配置带来的延迟、失败点和用户感知卡顿。
  - [x] `background`、`content` 和 `src/platforms/index.ts` 中的远程 selector 入口已注释/降级为 no-op，并标注 TODO。
  - Deferred：后续如恢复远程 selector，只能作为后台异步更新或灾备策略，必须保证本地 selector 可无感兜底，不能阻塞开始发布、打开平台或继续填充。

- [x] 密钥轮换。
  - [x] 服务端 JWT 支持 active key + previous keys，同时验证旧 lease/permit/admin token。
  - [x] Selector/PFAP/PFSP 协议公钥支持 pin 精确匹配 + P-256 签名远程新 key 验证。
  - [x] 新签发 lease/permit/admin token 使用新 key version（JWT header `kid`，lease/permit claims `key_version`）。
  - [x] 旧 JWT key 支持 grace period：通过 `JWT_PREVIOUS_SECRETS` 保留旧 key，窗口结束后移除。
  - [x] 新协议公钥必须由构建内置的 P-256 信任根验签后才可接受，形成信任链。
  - [x] 扩展构建内置根公钥，而不是每次盲信 `/version`。

- [x] 隐私与合规。
  - [x] 隐私政策写明收集 IP、设备公钥 hash、平台、版本、验证频率。
  - [x] 公钥只作为设备证明材料，避免收集可逆硬件指纹。
  - [x] 日志保留期限，例如 90 天。
  - [x] 海外用户评估 GDPR/CCPA。

- [x] Admin 审计日志。
  - [x] 当前已有 `license_events` 记录部分授权/后台动作。
  - [x] 审计事件增加 operator/admin id、来源 IP、reason、target id。
  - [x] 覆盖管理员解绑/吊销/冻结/解冻/批量生成/selector 发布。
  - [x] 后台列表可检索审计记录。

- [x] HKDF 替换简单 KDF。
  - [x] `core/src/crypto.rs` 的 `SHA-256(server_secret + license_code)` 改成 HKDF-SHA256。
  - [x] 兼容旧 selector 加密数据，解密时自动 fallback 到 legacy KDF。
  - [x] 增加 Rust 单元测试覆盖新旧 KDF。

## 5. P3 - 发行与逆向成本

- [x] 合并 release 验证脚本：`scripts/verify-release.mjs`。
  - [x] 检查产物没有 sourcemap。
  - [x] 检查 background/content 已混淆。
  - [x] 检查协议公钥已注入。
  - [x] 检查版本号一致。
  - [x] 检查无测试文件、内部文档、临时脚本。
  - [x] 检查 WASM hash 匹配。

- [x] 混淆策略复核。
  - [x] 当前只混淆 background/content，避免 Vue 页面混淆带来兼容风险。
  - [x] 评估是否对许可相关 dashboard/settings chunk 做轻量混淆：已做成 `OBFUSCATE_LICENSE_UI=1` 可选开关。
  - [x] 不把混淆当核心安全边界，只作为提高逆向成本。

- [x] 测试落地。
  - [x] Rust 单元测试：验签、nonce、lease 上限、permit TTL、HKDF（HKDF 已覆盖）。
  - [x] Rust 集成回归：同 `clientInstallId` 但浏览器私钥丢失/更换时，重激活会消耗迁移额度并只保留新设备 lease。
  - [x] Rust 集成回归：同激活码多设备激活会按 `max_devices` 触发旧设备迁移；迁移额度耗尽后新设备激活失败且不能替换现有 active lease。
  - [x] Rust 集成回归：`start_distribution` permit 不带 `device_proof` 必须拒绝，防本地 patch 授权状态后离线发布。
  - [x] Rust 集成回归：rollout 后仍未绑定 device key 的 lease，`verify/renew` 无 `device_proof` 必须拒绝。
  - [x] JS/Vitest：设备密钥生成、proof payload、错误映射、过期提示。
  - [x] JS/Vitest：本地时间回拨不能复活已由服务端时间判定过期的 lease。
  - [x] JS/Vitest：发布前 `start_distribution` permit 请求必须带 `device_proof`，且 task hash 对对象 key 顺序稳定。
  - [x] 集成测试：激活、verify 绑定、renew、permit。
  - [x] 集成测试：selector 拉取。
  - [x] 手工安全测试记录表：`_doc/PubFlow Pro 安全-测试计划.md`。
  - [x] 手工安全测试辅助脚本：`pnpm prepare:manual-security` 生成隔离 Chrome profile、复制版扩展目录、启动脚本、Profile 复制脚本、hook snippet 和本地 demo seed 卡密提示。
  - [x] 手工安全测试证据门禁：`pnpm verify:manual-security` 校验 `.manual-security/evidence.json`，未填真实浏览器证据时必须失败。
  - [x] 本地授权 API smoke 脚本：`pnpm smoke:lease-api` 使用 Node WebCrypto P-256 设备 proof 打 `/challenge -> /activate -> /verify -> /permit`，可选 `--generate-license` 生成临时测试卡密；2026-07-04 03:26 CST 使用当前源码后端 `http://127.0.0.1:3101` 实跑通过。
  - [x] 真实 Chrome profile smoke 脚本：`pnpm smoke:extension-security` 使用 CDP `Extensions.loadUnpacked` 加载解压扩展，覆盖 Profile A 激活/permit、干净 profile 复制扩展目录、只复制 `chrome.storage.local`、复制完整 profile 的行为记录。
  - [x] 真实 Chrome profile smoke 实跑通过并写入 `.manual-security/evidence.json`；跑之前建议重启隔离后端，避免上一次调试残留的内存限流影响结果。
  - [x] 手工安全测试执行：复制扩展目录、只复制 `chrome.storage.local`、复制完整 profile、改本地时间、hook fetch/querySelector、旧未绑定 lease 无 proof 调用 `verify/renew`。

## 6. 买断版预留，不进订阅主流程

- [x] 订阅版继续走浏览器设备密钥 + 服务端 lease/permit。
- [x] 当前扩展主流程未接入 `chrome.runtime.sendNativeMessage` / Native Messaging，不增加订阅用户安装成本。
- [x] 数据结构已预留买断/企业方向：`lease_type` 支持 `subscription / perpetual`，lease 已有 `device_key_id / device_public_key_spki / device_key_algorithm` 设备公钥材料字段。
- [x] Native Helper 方案仅保留在设计文档和服务端 workspace 预研代码，不作为订阅版授权、验证、发布 permit 的依赖。
- Deferred：买断版/企业版再实现 Native Helper 获取系统稳定 ID、生成系统级设备私钥。
- Deferred：买断离线证书再绑定 Native Helper 公钥。
- Deferred：买断版再让 Native Helper 负责时间回拨状态、设备证明、必要时扩展完整性辅助校验。
