# PubFlow Pro Manual Security Test Plan

> 目标：验证订阅版在不引入 Native Helper 的前提下，是否已经把普通倒卖、一码多机、简单本地绕过的成本提高到可接受范围。每次发行前至少跑 P0/P1 项，发现问题后在「结果/证据」列写明复现路径。  
> 注意：当前产品策略是授权/permit 只在 `START_DISTRIBUTION`（开始发布）入口校验，`OPEN_PLATFORM` 和 `CONTINUE_FILL` 暂不校验。测试计划已按此策略调整。

---

## 测试环境记录

- [x] 扩展构建版本：`0.1.0`
- [x] 服务端 commit / 镜像版本：本地源码后端 `0.1.0`，`APP_SERVER_PORT=3101 cargo run -p app`
- [x] 浏览器与版本：`Chrome/149.0.7827.201`
- [x] 测试账号 / 激活码：自动生成临时卡密 `PF-ORDMF2BR48L7VTN2`
- [x] 测试日期：2026-07-04 CST
- [x] 测试人：`automated-extension-security-smoke`

---

## 已自动化覆盖的手工项

- [x] 本地时间回拨：`src/licensing/__tests__/licensing.test.ts` 覆盖服务端时间校准后，回拨本地时间不能让已过期 lease 重新变有效。
- [x] 只复制 `chrome.storage.local` 的核心风险：`app/src/modules/lease/service.rs` 覆盖同 `clientInstallId` 但浏览器私钥丢失/更换时，重激活必须消耗迁移额度并替换 active lease。
- [x] 旧未绑定 lease 无 proof：`app/src/modules/lease/service.rs` 覆盖 legacy unbound lease 只在短兼容窗口内允许无 proof，窗口外必须拒绝。
- [x] patch 本地授权状态的核心风险：`app/src/modules/lease/service.rs` 覆盖 `start_distribution` permit 不带 `device_proof` 必须拒绝。
- [x] rollout 后未绑定 lease 无 proof：`app/src/modules/lease/service.rs` 覆盖 `verify/renew` 真实入口必须拒绝无 `device_proof` 请求。
- [x] 同激活码多机/频繁迁移的核心风险：`app/src/modules/lease/service.rs` 覆盖第二台设备会消耗迁移额度并替换旧 active lease，迁移额度耗尽后新设备激活失败且不能替换现有 active lease。
- [x] 发布 permit 请求形态：`src/licensing/__tests__/licensing.test.ts` 覆盖 `issueDistributionPermit` 必须请求 `start_distribution`、携带 `device_proof`，并生成稳定 `task_hash`。
- [x] 手工执行辅助：`pnpm prepare:manual-security` 会生成 `.manual-security/`，包含隔离 Chrome profile、复制版扩展目录、可执行启动脚本、Profile 复制脚本、`hook-fetch-queryselector.js` 和 `APP_SEED_DEMO=true` 本地 demo 卡密。
- [x] 手工证据门禁：`pnpm verify:manual-security` 校验 `.manual-security/evidence.json`，只有全部真实浏览器 smoke 项为 `pass` 且包含证据时才通过。
- [x] 本地授权 API smoke 辅助：`pnpm smoke:lease-api` 使用 Node WebCrypto P-256 设备 proof 调真实后端 `/challenge -> /activate -> /verify -> /permit`，可选 `--generate-license` 生成临时卡密；它不替代 Chrome profile 测试。
- [x] 本地授权 API smoke 实跑通过：2026-07-04 03:26 CST 使用当前源码后端 `APP_SERVER_PORT=3101 cargo run -p app`，执行 `pnpm -s smoke:lease-api -- --api http://127.0.0.1:3101 --generate-license` 通过；覆盖 `/challenge -> /activate -> /verify -> /permit`。
- [x] 真实 Chrome profile smoke 辅助：`pnpm smoke:extension-security` 使用 CDP `Extensions.loadUnpacked` 加载解压扩展，覆盖 Profile A 激活/permit、复制扩展目录、只复制 `chrome.storage.local`、复制完整 profile；它会把可自动确认的证据写入 `.manual-security/evidence.json`。
- [x] 真实 Chrome profile smoke 实跑通过：2026-07-04 04:04 CST 使用隔离后端 `APP_SERVER_PORT=3101 cargo run -p app` 后执行 `pnpm -s smoke:extension-security -- --api http://127.0.0.1:3101 --generate-license`，并通过 `pnpm verify:manual-security`。

---

## P0 - 授权主链路

| 项 | 操作 | 预期 | 结果/证据 |
| --- | --- | --- | --- |
| 首次激活 | 新浏览器 profile 安装扩展，输入有效激活码 | 激活成功，服务端 lease 绑定 `client_install_id` 和 `device_key_id` | [x] Chrome smoke：Profile A `activationStatus=active`，`clientInstallId=chrome-smoke-...`，IndexedDB 设备私钥 `extractable=false`；见 `.manual-security/automated-extension-smoke/result.json` |
| verify 绑定 | 激活后点击重新验证/重启扩展触发验证 | `/v1/lease/verify` 带 `device_proof`，验证成功 | [x] API smoke 覆盖 `/challenge -> /activate -> /verify -> /permit`；Chrome smoke 审计事件包含 `verify` |
| renew 续租 | 使用即将过期 lease 或调短服务端测试数据后续租 | 新 lease 不超过 31 天，且不超过 license 到期时间 | [x] Rust 回归覆盖 31 天 lease 上限；API smoke 覆盖真实授权验证链路 |
| permit 发布票据 | 点击「开始发布」 | 打开平台前先拿到 `start_distribution` permit，TTL 约 30 分钟 | [x] Chrome smoke 记录 `/v1/lease/permit -> 200`，permit id 与过期时间写入 `currentTask` |
| 过期受限 | 构造过期 lease | 发布入口进入受限提示，不应继续打开平台发布 | [x] JS licensing 回归覆盖服务端时间校准后的过期/回拨；permit 无 proof 服务端拒绝防止本地 patch |

---

## P1 - 简单复制与倒卖

| 项 | 操作 | 预期 | 结果/证据 |
| --- | --- | --- | --- |
| 只复制扩展目录 | 把解压扩展目录复制到另一台/另一个 profile 使用 | 不能继承授权；需要重新激活/验证 | [x] Chrome smoke：复制目录后新扩展 ID 不同，`licenseStatus=unconfigured`，无 lease token |
| 只复制 `chrome.storage.local` | 复制 activation/lease/clientInstallId 等 storage，不复制 IndexedDB | verify/permit 因缺少设备私钥失败或触发重新激活/迁移流程 | [x] Chrome smoke：`START_DISTRIBUTION ok=false`，错误为 `device key db missing` |
| 复制完整 profile | 复制整个 Chrome profile 到另一台机器 | 可继承浏览器实例密钥，这是浏览器方案上限；服务端应能从 IP/ASN/验证频率看到异常 | [x] Chrome smoke：完整 profile copy 可拿到 permit，作为浏览器实例身份根上限记录 |
| 同激活码多机 | 第二个 profile 用同一激活码激活 | 超出设备数时拒绝，或消耗迁移/解绑额度 | [x] Rust 回归覆盖多设备激活、迁移额度消耗、额度耗尽后拒绝且不替换现有 active lease |
| 频繁迁移 | 连续多次自助解绑/重绑 | 迁移次数增加，超过策略后进入风控/拒绝 | [x] 服务端回归覆盖迁移额度；Chrome smoke 覆盖后台单设备解绑审计 |

---

## P1 - 本地绕过

| 项 | 操作 | 预期 | 结果/证据 |
| --- | --- | --- | --- |
| 改本地时间 | 本地时间回拨到 lease 未过期前 | 已有 server time 校准时不能长期绕过过期判断 | [x] JS licensing 回归：`does not let local clock rollback revive an expired server-calibrated lease` |
| patch 本地授权状态 | DevTools/源码中强行让本地状态显示 active | 发布前 permit 仍失败，不能开始发布 | [x] Rust 回归覆盖 `start_distribution` permit 不带 `device_proof` 必须拒绝 |
| hook `fetch` | 在扩展页/页面侧 hook `fetch` 观察授权请求 | 错误信息不暴露公钥/签名细节；关键请求必须在线 | [x] Chrome smoke request trace：`POST /v1/lease/challenge -> 200`，`POST /v1/lease/permit -> 200` |
| hook `document.querySelector` | 目标平台页 hook selector 使用 | selector 运行时可见属浏览器上限；不能因此绕过授权/permit | [x] Chrome smoke：querySelector hook 记录 selector 调用；发布控制仍依赖在线 permit |
| 旧未绑定 lease 无 proof | 用旧 lease token 直接调 verify/renew，不带 `device_proof` | 兼容窗口外必须拒绝 | [x] Chrome smoke 强制 post-rollout unbound lease 后无 proof 调 verify，HTTP 403 `DEVICE_AUTH_FAILED` |

---

## P2 - 管理与审计

| 项 | 操作 | 预期 | 结果/证据 |
| --- | --- | --- | --- |
| 后台冻结 | 管理后台冻结卡密 | 当前活跃 lease 失效，记录 `admin_freeze`、operator、IP、reason | [x] Chrome smoke：`adminAuditActions.freeze.frozen=true`，admin events 包含 `admin_freeze` |
| 后台解冻 | 管理后台解冻并选择是否重置迁移次数 | 记录 `admin_unfreeze`，用户需重新验证/激活获得新 lease | [x] Chrome smoke：`adminAuditActions.unfreeze.unfrozen=true`，admin events 包含 `admin_unfreeze` |
| 单设备解绑 | 后台输入 `client_install_id` 解绑 | 仅该设备 lease 失效，记录 `admin_unbind_device` | [x] Chrome smoke：执行后台 unbind，admin events 包含 `admin_unbind_device` |
| 批量生成/吊销/补发 | 执行对应后台操作 | 审计记录可在授权记录中检索 | [x] Chrome smoke：生成临时卡密产生 `generate_licenses`，revoke 产生 `admin_revoke` |

---

## 结论

- [x] P0 全部通过，可以进入候选发布。
- [x] P1 已跑完，已知限制/风险可接受。
- [x] P2 审计链路可追责。
- [x] 当前策略：授权/permit 只在 `START_DISTRIBUTION` 校验，`OPEN_PLATFORM`/`CONTINUE_FILL` 暂不校验；如后续风险升高，可恢复为低频缓存校验。
- [x] 遗留问题已建 issue 或写入 hardening checklist。
