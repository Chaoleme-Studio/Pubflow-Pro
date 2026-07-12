# PubFlow Pro 授权方案

> 版本：当前落地版（订阅版）  
> 日期：2026-07-04  
> 范围：`pubflow-Pro` 插件端、`pubflow-Pro-server-axum-starter` 服务端  
> 目标：说明当前已落地的订阅版授权链路，以及买断制/Native Helper 的预留方向。

---

## 1. 核心结论

当前 PubFlow Pro 采用**订阅制 + 服务端短 lease + 浏览器实例设备密钥**的授权模型。

- 激活码不预写到期时间，首次激活时开始计算有效期。
- 服务端使用 **JWT HS256** 签发 `lease_token`，最长有效期 **31 天**。
- 浏览器内生成 **ECDSA P-256 设备密钥对**，私钥 `extractable=false` 存储在 IndexedDB。
- 激活后紧接 `/v1/lease/verify` 绑定设备公钥；后续 verify/renew/permit 必须带 device proof。
- 点击**开始发布**时申请一次性 `start_distribution` permit（30 分钟 TTL）。
- 平台 selector 全部内置在插件本地 `src/platforms`，**远程 selector 下发暂时废弃**。

买断制/永久授权依赖 Native Helper 做系统级设备绑定，**订阅版当前不引入**，作为 P2 预留方向。

---

## 2. 授权流程

### 2.1 首次激活

```text
插件输入 activation_code
  → POST /v1/lease/activate (PFAP v1 二进制封装)
  → 服务端校验激活码、套餐、设备数
  → 签发 JWT lease_token（31 天）
  → 插件保存 lease_token、client_install_id
  → 紧接 POST /v1/lease/verify + device_proof
  → 服务端首次绑定 P-256 设备公钥
```

### 2.2 日常使用

```text
插件启动
  → 调用 /v1/lease/verify 校验 lease 有效性和设备绑定
  → 到期前 7 天提示联网续租
  → 过期后进入受限模式（只读/不可发布）

用户点击"开始发布"
  → 调用 /v1/lease/challenge 获取一次性 challenge
  → 用 IndexedDB 中的私钥签名 challenge
  → 调用 /v1/lease/permit 申请 start_distribution permit
  → 拿到 permit 后开始打开各平台发布页
```

### 2.3 设备迁移

- 同一激活码最多 1 个 active 安装实例（`max_devices = 1`）。
- 新实例激活时自动吊销旧实例，并消耗迁移额度。
- 迁移额度按订阅时长折算：每 30 天 5 次，月卡 5 次、年卡 60 次。
- 用户可通过授权中心自助解绑旧设备，每日上限 10 次，同样消耗迁移额度。

---

## 3. 模块边界

```text
pubflow-core
  授权签名、设备哈希、PFAP/PFSP 协议编解码、HKDF。

app (Axum + SeaORM)
  激活码生命周期、lease 签发与验证、permit 签发、后台管理。

pubflow-Pro (Chrome MV3 + WXT + Vue 3)
  授权 UI、设备密钥管理、permit 申请、平台发布自动化。

WASM
  PFAP/PFSP 协议编解码，不保存授权私钥，不做最终授权判断。
```

---

## 4. 关键安全控制

| 控制点 | 说明 |
|--------|------|
| 短 lease | 最长 31 天，到期需联网续租，降低离线倒卖价值 |
| 设备密钥 | P-256 私钥不可导出，复制扩展目录无法带走 |
| device proof | 每次 permit/verify 需用私钥签名服务端 challenge |
| 发布 permit | 开始发布前必须拿到一次性 permit；当前只在点击“开始发布”时校验一次，降低发布过程中的打断感 |
| 迁移额度 | 换机/重装次数受限，超出需客服处理 |
| 错误收敛 | 客户端只展示友好文案，服务端记录详细日志 |
| 混淆构建 | `OBFUSCATE=1` 时混淆 background/content，仅作为提高逆向成本 |

---

## 5. 已知限制

1. **浏览器扩展运行在用户设备上**，不存在绝对安全，只能提高攻击成本。
2. **复制完整 Chrome profile** 会带走 IndexedDB 中的私钥，这是浏览器方案的天花板；订阅版用短 lease、permit 和迁移画像兜底。
3. **远程 selector 策略已暂时废弃**，当前 selector 全部内置在插件本地。
4. **device proof 当前只签服务端 challenge**，未把 `lease_id/purpose/client_install_id` 一起放进签名上下文；由于 permit 本身已绑定 lease、operation 和 task hash，且当前产品只在开始发布时做一次校验，暂不作为上线阻断项。后续提高安全等级时再做上下文绑定。
5. **买断制/永久授权** 需要 Native Helper 做系统级设备绑定，订阅版当前不引入。

---

## 6. 买断制/Native Helper 预留方向（P2）

未来若推出买断制，可采用：

- Native Helper 生成系统级 Ed25519 设备密钥对。
- 私钥存入系统安全存储（Windows DPAPI/TPM、macOS Keychain、Linux keyring）。
- 服务端签发绑定设备公钥的 Ed25519 License certificate。
- 插件启动时 WASM 离线验证 License 签名，服务器关机仍可验证。
- 通过单调计数和 Native Helper 辅助防止系统时间回拨。

该方案能满足：买断离线可用、换浏览器可用、控制一码多用。但开发和维护成本较高，订阅版当前不做。

---

## 7. 相关文档

- [`pubflow-Pro/_doc/PubFlow Pro 安全-授权保护设计.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-授权保护设计.md)：完整威胁模型与架构设计。
- [`pubflow-Pro/_doc/PubFlow Pro 安全-加固清单.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-加固清单.md)：已落地的安全加固清单。
- [`pubflow-Pro/_doc/PubFlow Pro 安全-密钥轮换手册.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-密钥轮换手册.md)：JWT 与协议公钥轮换操作手册。
- [`pubflow-Pro/_doc/PubFlow Pro 安全-测试计划.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-测试计划.md)：发布前手工安全测试计划。
- [`pubflow-Pro/_doc/PubFlow Pro 安全=隐私数据保留说明.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全=隐私数据保留说明.md)：隐私数据收集与保留说明。
