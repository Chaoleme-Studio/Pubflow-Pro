# PubFlow 代码保护与授权设计总方案

> 版本：v3  
> 日期：2026-05-23  
> 适用项目：PubFlow 多平台短视频发布助手，WXT + Vue 3 + Vite + TypeScript Chrome 扩展  
> 目标：在国产扩展商店或私有分发场景下，提高代码复制、选择器批量提取、盗版授权和一码多机的成本。

---

## 0. 当前落地状态（2026-07-04）

本文保留完整安全架构和后续买断制方向，部分章节是设计预案，不代表订阅版当前全部启用。当前项目落地状态以此段为准：

- 订阅版不引入 Native Helper，不增加用户安装成本；买断制/永久授权再单独规划 Native Helper。
- 订阅版使用服务端 30 天 lease + 浏览器实例级 ECDSA P-256 设备密钥。
- 点击“开始发布”时申请一次 `start_distribution` permit，TTL 为 30 分钟；`OPEN_PLATFORM` 和 `CONTINUE_FILL` 暂不做授权校验，优先保证发布体验顺滑。
- 平台 selector 全部以内置 `src/platforms/*/selectors.ts` 为准；远程 selector/PFSP 代码保留但已暂时废弃，不进入发布主链路。
- 自助解绑每日最多 10 次，并消耗迁移额度；迁移额度按订阅时长折算，每 30 天 3 次，月卡 3 次、年卡 36 次。
- device proof 当前只签服务端 challenge；permit 已绑定 lease、operation 和 task hash。更高安全等级可后续把 `lease_id / purpose / client_install_id` 纳入签名上下文。

---

## 1. 结论先行

PubFlow 是浏览器扩展，不是微信/抖音小程序。用户拿到扩展包后，JS、WASM、资源文件、运行时 DOM 调用都在本机。因此它不存在绝对安全，只能做成本控制。

本方案的核心结论：

1. 不建议继续使用“客户端 WASM 内藏 HMAC 密钥”的授权模型。  
   只要签发授权所需的密钥在客户端，就有被提取并批量生成盗版 license 的风险。

2. 推荐改成“服务器私钥签名，客户端公钥验签”。  
   扩展和 Native Helper 只保存公钥，不能生成授权，只能验证服务器签发的授权。

3. 浏览器指纹不适合作为强机器码。  
   浏览器升级、系统语言、显卡驱动、屏幕参数、隐私策略变化都可能导致指纹漂移。强绑定应使用 Native Helper 获取系统稳定 ID，并生成设备密钥对。

4. 永久离线授权可以做，但不能可靠防本地改时间和本地 patch。  
   如果商业上必须“永久离线”，只能接受风险，并用时间回拨检测、单调计数、授权证书签名、Native Helper 安全存储来提高成本。若要商业可控，推荐短期 lease + 离线宽限。

5. 混淆、WASM、选择器加密是加固层，不是授权根基。  
   它们可以防普通复制和批量静态提取，但不能防专业逆向在本机运行时 hook。

最终推荐架构：

```
浏览器扩展
  ├─ Dashboard 授权 UI
  ├─ Background 授权状态管理
  ├─ Content Script 平台发布自动化
  ├─ WASM 本地加固逻辑
  └─ 内置：服务器公钥、产品公钥、基础校验逻辑

Native Helper 本地助手
  ├─ 获取系统稳定 ID
  ├─ 生成并保存设备密钥对
  ├─ 使用设备私钥签名服务器 nonce
  ├─ 维护本地时间状态和防回拨记录
  └─ 通过 Chrome Native Messaging 与扩展通信

授权服务器
  ├─ 用户、订单、license、设备管理
  ├─ 激活、解绑、吊销、续租
  ├─ 使用私钥签发 license certificate / lease
  └─ 下发选择器配置、版本策略、黑名单
```

---

## 2. 威胁模型

### 2.1 要保护的资产

| 资产 | 说明 | 价值 |
|---|---|---|
| 平台选择器 | `src/platforms/*/selectors.ts` 中的 DOM 选择器和发布页定位规则 | 同行复制后可快速复刻 |
| 发布执行逻辑 | `src/content/publishSteps.ts`、`fieldFiller.ts`、各平台 `content.ts` | 自动化流程、容错策略、拟人节奏 |
| 授权状态 | 是否 Pro、有效期、设备绑定、功能权限 | 商业收入 |
| 远程配置 | 选择器版本、平台开关、功能策略 | 持续运营能力 |
| Native Helper | 设备身份、设备私钥、本地时间状态 | 设备绑定根基 |

### 2.2 攻击者分层

| 攻击者 | 能力 | 目标 | 应对目标 |
|---|---|---|---|
| 普通用户 | 会打开扩展目录、看 JS 文件 | 免费使用 Pro | 应能有效拦住 |
| 前端开发者 | 会格式化、搜索字符串、改返回值 | 改授权、复制选择器 | 提高到数小时以上成本 |
| 逆向人员 | 会调试、hook、反混淆、wasm2wat | 做破解版、自签 license | 防批量签发，降低长期可用性 |
| 竞争对手 | 愿意投入时间重写 | 复刻产品 | 无法完全阻止，只能提高复制成本 |

### 2.3 无法彻底防住的事情

浏览器扩展在用户机器上运行，有几个上限必须接受：

1. 最终传给 `document.querySelector()` 的选择器一定可以在运行时看到。
2. Content Script 的 DOM 操作逻辑最终一定可以被调试和 hook。
3. 用户拥有本机管理员权限时，可以 patch JS、WASM、Native Helper。
4. 永久离线授权无法实时知道退款、盗号、超设备数、吊销。
5. 只靠本地时间无法可靠判断真实过期时间。

所以本方案的目标不是“不可破解”，而是：

- 不能批量伪造正版 license。
- 不能简单复制扩展目录就长期可用。
- 不能静态打开 JS 就拿走选择器和业务逻辑。
- 盗版需要持续维护 patch，不能长期稳定吃到配置更新。

---

## 3. 方案选择

### 3.1 三个可选授权模式

| 模式 | 描述 | 优点 | 缺点 | 建议 |
|---|---|---|---|---|
| 永久离线授权 | 激活一次后永久本地验签 | 用户体验最好，无服务器依赖 | 无法可靠防改时间、吊销、退款、patch | 仅适合低客单价或买断版 |
| 短期 lease + 离线宽限 | 在线激活，定期续租，离线可用 7-30 天 | 商业可控，能吊销和管设备数 | 需要服务器，用户偶尔联网 | 推荐默认方案 |
| 全在线授权 | 每次关键操作都请求服务器 | 控制最强 | 用户体验差，网络依赖重 | 不适合发布自动化工具 |

### 3.2 推荐决策

建议产品上提供两种授权：

1. Pro 订阅版：短期 lease + 离线宽限。  
   默认有效期 7 天或 30 天。用户只要偶尔联网即可。

2. 永久买断版：永久 license certificate + 本地防回拨。  
   明确接受不能远程吊销、不能强防 patch 的风险。价格应高于订阅，且限制设备数。

这样既能满足“永久离线授权”的商业诉求，又不把所有用户都放进不可控模式。

---

## 4. 新授权架构

### 4.1 密钥体系

使用非对称签名：

```
服务器
  LICENSE_SIGNING_PRIVATE_KEY  私钥，只在服务器环境变量或 KMS 中

扩展 / Native Helper
  LICENSE_SIGNING_PUBLIC_KEY   公钥，可公开，用于验签
```

推荐算法：

- Ed25519：签名短、速度快、实现简单，适合 license 签名。
- 或 ECDSA P-256：生态兼容好，但实现细节更容易踩坑。

不要使用客户端 HMAC 签名授权。HMAC 是对称密钥，验签方和签发方共用同一个 secret。只要客户端能验签，就必须拥有 secret 或能派生 secret，最终可能被提取。

### 4.2 License Certificate

`licenseCert` 是长期授权证书，由服务器私钥签名。

```json
{
  "type": "LICENSE_CERT",
  "version": 1,
  "licenseId": "lic_01J...",
  "userId": "usr_01J...",
  "product": "pubflow-extension",
  "tier": "PRO",
  "features": ["publish", "batch", "ai", "selector-updates"],
  "maxDevices": 2,
  "issuedAt": "2026-05-23T00:00:00Z",
  "expiresAt": "2027-05-23T00:00:00Z",
  "isPerpetual": false
}
```

签名输入必须覆盖所有 claims。不要只签 `machineCode + expireAt`，否则 `tier`、`features`、`maxDevices` 可能被篡改。

序列化建议：

```
base64url(jsonPayload) + "." + base64url(signature)
```

不要把 Base64 当加密。Base64 只是编码，payload 可以被用户读到，但不能被篡改，因为有签名。

### 4.3 Lease

`lease` 是短期使用票据，也由服务器私钥签名。

```json
{
  "type": "LICENSE_LEASE",
  "version": 1,
  "leaseId": "lse_01J...",
  "licenseId": "lic_01J...",
  "deviceId": "dev_abc...",
  "devicePublicKeyHash": "sha256:...",
  "tier": "PRO",
  "features": ["publish", "batch", "ai", "selector-updates"],
  "validFrom": "2026-05-23T00:00:00Z",
  "validUntil": "2026-06-22T00:00:00Z",
  "minExtensionVersion": "0.1.0",
  "policyVersion": 3
}
```

扩展启动时验证：

1. 签名正确。
2. `product` 或 `type` 正确。
3. 当前设备匹配。
4. 当前版本不低于 `minExtensionVersion`。
5. 当前时间在 `validFrom` 和 `validUntil` 范围内。
6. 功能开关与 `features` 一致。

---

## 5. 机器绑定设计

### 5.1 为什么不用浏览器指纹

浏览器指纹可以作为弱信号，但不适合作为 license 绑定根基。

脆弱点：

- 浏览器升级会改变 UA。
- 系统语言、时区、屏幕、显卡驱动会变化。
- 隐私插件可能伪造 WebGL、Canvas、UA。
- 扩展重装或清理 storage 会丢失 salt。
- 同一台机器多个浏览器环境可能生成不同指纹。

因此浏览器环境最多作为辅助，不作为唯一机器码。

### 5.2 Native Helper 方案

新增一个很小的本地程序，通过 Chrome Native Messaging 与扩展通信。

职责：

1. 获取系统稳定 ID。
2. 第一次运行生成设备密钥对。
3. 把设备私钥放系统安全存储。
4. 对服务器 nonce 做签名。
5. 维护本地时间状态，辅助检测时间回拨。

系统稳定 ID 建议：

| 系统 | 信号 | 说明 |
|---|---|---|
| Windows | `MachineGuid` + 用户 SID 可选 | 读取后 hash，不上传明文 |
| macOS | `IOPlatformUUID` | 读取后 hash |
| Linux | `/etc/machine-id` | 读取后 hash |

设备 ID：

```
deviceId = base64url(SHA256(productSalt || osStableId || helperInstallId))
```

其中 `helperInstallId` 是 Native Helper 首次运行生成的随机 ID，保存到系统安全存储或用户配置目录。这样可以避免同系统克隆导致完全相同。

### 5.3 设备密钥对

第一次运行：

```
Native Helper
  ├─ 生成 Ed25519 设备密钥对
  ├─ 私钥保存到系统安全存储
  └─ 公钥返回给扩展和服务器
```

后续验证：

```
服务器生成 nonce
  ↓
扩展转发给 Native Helper
  ↓
Native Helper 用设备私钥签名 nonce
  ↓
服务器用已登记设备公钥验签
```

这样服务器能确认：请求来自激活过的那台设备，而不是用户复制了一份 license 文件。

---

## 6. 激活与使用流程

### 6.1 首次激活

```
1. 用户安装扩展和 Native Helper
2. 扩展调用 Native Helper: getDeviceInfo
3. Native Helper 返回 deviceId、devicePublicKey、helperVersion
4. 用户输入序列号或登录账号
5. 扩展请求服务器: POST /activations/challenge
6. 服务器返回 nonce
7. Native Helper 签名 nonce
8. 扩展请求服务器: POST /activations
9. 服务器校验订单、设备数、签名
10. 服务器签发 licenseCert 和 lease
11. 扩展保存授权状态
```

### 6.2 日常启动

```
1. 扩展读取本地 licenseCert 和 lease
2. 使用内置公钥验签
3. 调用 Native Helper 获取 deviceId
4. 校验 lease 是否绑定当前设备
5. 校验时间和功能权限
6. 通过后启用 Pro 功能
```

### 6.3 续租

```
1. lease 距离过期小于 3 天
2. 扩展后台自动请求 renew challenge
3. Native Helper 签名 nonce
4. 服务器校验 license 状态、设备状态、版本策略
5. 返回新的 lease
```

### 6.4 换绑

推荐策略：

- 每个 license 允许绑定 `maxDevices` 台设备。
- 订阅版当前按订阅时长折算迁移额度：每 30 天 3 次，月卡 3 次、年卡 36 次；自助解绑每日最多 10 次，并消耗迁移额度。
- 风险订单或频繁换绑转人工审核。
- 永久买断版也应保留设备数限制。

---

## 7. 永久离线授权评估

### 7.1 能不能做

能做。形式是服务器签发一个 `isPerpetual: true` 的 license certificate：

```json
{
  "type": "LICENSE_CERT",
  "licenseId": "lic_01J...",
  "tier": "LIFETIME",
  "features": ["publish", "batch"],
  "maxDevices": 1,
  "deviceId": "dev_abc...",
  "issuedAt": "2026-05-23T00:00:00Z",
  "expiresAt": null,
  "isPerpetual": true
}
```

客户端本地验签通过后永久可用。

### 7.2 好不好

从用户体验看很好；从商业控制看较弱。

优点：

- 不依赖服务器。
- 不怕网络环境差。
- 用户买断体验清晰。
- 售后简单，适合企业内网或离线机器。

缺点：

- 无法远程吊销。
- 退款后无法让已离线用户失效。
- license 文件被复制后，只能靠设备绑定拦截。
- 用户 patch 本地校验后可自用。
- 无法持续控制选择器配置和版本策略。

### 7.3 改本地时间能不能继续用

分情况：

1. 如果是真永久 license，没有过期时间，改时间没有意义。
2. 如果是“长期但有过期时间”的离线 license，用户回拨系统时间确实可能继续用。
3. 如果使用 Native Helper 记录时间状态，可以检测一部分回拨，但不能做到绝对可靠。

### 7.4 本地防回拨设计

Native Helper 维护一个本地时间状态：

```json
{
  "lastSeenWallClock": "2026-05-23T10:00:00Z",
  "lastSeenMonotonicMs": 123456789,
  "lastLeaseValidUntil": "2026-06-22T00:00:00Z",
  "rollbackScore": 0
}
```

每次启动：

1. 当前系统时间小于 `lastSeenWallClock - 10 minutes`，增加回拨分。
2. 当前系统时间大幅跳跃，也记录异常。
3. 如果能联网，使用服务器时间校准。
4. 如果回拨分超过阈值，要求联网重新验证。

局限：

- 用户可以删除本地状态文件。
- 管理员可以 patch Native Helper。
- 系统重装会丢状态。
- 离线环境无法获得可信当前时间。

所以防回拨只能增加成本，不能作为强安全边界。

### 7.5 永久离线版建议

如果你一定要支持永久离线：

1. 使用服务器私钥签发永久证书。
2. 永久证书绑定 `deviceId` 和 `devicePublicKeyHash`。
3. 激活时必须在线一次。
4. 激活后可以永久离线使用。
5. Native Helper 本地保存设备私钥和授权状态。
6. 永久版不承诺远程吊销。
7. 永久版不要包含需要持续维护成本的权益，例如长期 AI 额度或无限云配置。
8. 选择器更新可以作为“在线服务权益”，永久离线版只使用内置选择器快照。

---

## 8. 授权 API 设计

### 8.1 接口列表

```
POST /api/v1/activations/challenge
POST /api/v1/activations
POST /api/v1/leases/renew
GET  /api/v1/licenses/:licenseId
POST /api/v1/devices/:deviceId/deactivate
GET  /api/v1/configs/platform-selectors
```

### 8.2 激活 challenge

Request:

```json
{
  "serial": "PF-XXXX-XXXX",
  "deviceId": "dev_abc",
  "devicePublicKey": "base64url...",
  "helperVersion": "1.0.0",
  "extensionVersion": "0.1.0"
}
```

Response:

```json
{
  "challengeId": "chl_01J...",
  "nonce": "base64url-random-32-bytes",
  "expiresAt": "2026-05-23T10:05:00Z"
}
```

### 8.3 完成激活

Request:

```json
{
  "challengeId": "chl_01J...",
  "serial": "PF-XXXX-XXXX",
  "deviceId": "dev_abc",
  "devicePublicKey": "base64url...",
  "signature": "base64url-ed25519-signature"
}
```

Response:

```json
{
  "licenseCert": "base64url(payload).base64url(signature)",
  "lease": "base64url(payload).base64url(signature)",
  "serverTime": "2026-05-23T10:00:00Z"
}
```

### 8.4 续租

Request:

```json
{
  "licenseId": "lic_01J...",
  "deviceId": "dev_abc",
  "currentLeaseId": "lse_01J...",
  "nonceSignature": "base64url..."
}
```

Response:

```json
{
  "lease": "base64url(payload).base64url(signature)",
  "serverTime": "2026-05-23T10:00:00Z"
}
```

### 8.5 错误语义

统一错误格式：

```json
{
  "error": {
    "code": "DEVICE_LIMIT_EXCEEDED",
    "message": "设备数量已达到授权上限"
  }
}
```

常见错误码：

| Code | 含义 |
|---|---|
| `INVALID_SERIAL` | 序列号不存在或格式错误 |
| `LICENSE_EXPIRED` | 授权已过期 |
| `LICENSE_REVOKED` | 授权已吊销 |
| `DEVICE_LIMIT_EXCEEDED` | 设备数量超限 |
| `CHALLENGE_EXPIRED` | challenge 已过期 |
| `SIGNATURE_INVALID` | 设备签名无效 |
| `VERSION_BLOCKED` | 扩展版本过低或被禁用 |

---

## 9. 代码保护方案

### 9.1 当前构建产物暴露程度

WXT 底层使用 Vite 打包。默认生产构建会压缩 JS：

- 删除注释和空格。
- 缩短局部变量名。
- 合并模块。
- 移除部分死代码。

但 minification 不是 obfuscation。DevTools 格式化后，逻辑仍能阅读，字符串和 DOM 选择器也可能被搜索到。

### 9.2 JS 混淆

不上 Chrome Web Store、走国产商店或私发时，可以考虑构建时混淆：

- 控制流平坦化。
- 字符串数组加密。
- split strings。
- 去除 console。
- 保留 source map 只在内部构建使用。

建议只对生产构建启用，并对高风险模块优先启用：

- `src/content/publishSteps.ts`
- `src/content/fieldFiller.ts`
- `src/platforms/*/content.ts`
- `src/platforms/*/selectors.ts`
- 授权状态管理模块

注意：

- 混淆会增加包体和运行时成本。
- 控制流平坦化可能影响性能和调试。
- Vue 组件、第三方库、WXT runtime 不建议全量强混淆。
- `renameGlobals` 容易破坏运行环境，默认关闭。

### 9.3 WASM

WASM 适合：

- license payload 解析与验签。
- 本地策略判断。
- 选择器解密。
- 关键算法封装。

WASM 不适合：

- DOM 操作。
- `querySelector`。
- 表单填充。
- 与网页事件系统强耦合的逻辑。

因为 WASM 不能直接操作页面 DOM，Content Script 的核心流程仍会留在 JS。

### 9.4 选择器加密

选择器可以从 TS 明文迁移为加密配置：

```
构建时
  selectors.json
    ↓
  AES-GCM 加密
    ↓
  selectors.enc

运行时
  Background 加载 selectors.enc
    ↓
  WASM 解密
    ↓
  Content Script 按需请求平台字段选择器
    ↓
  document.querySelector()
```

但要明确：运行时明文无法避免。攻击者可以 hook：

- `document.querySelector`
- `document.querySelectorAll`
- `Element.prototype.querySelector`
- `chrome.runtime.sendMessage`
- WASM decrypt 返回值

选择器加密的价值是防静态批量提取，不是防运行时拦截。

### 9.5 远程选择器配置

更推荐的长期方案：

- 扩展内置一份基础选择器快照，保证离线可用。
- 在线用户根据 lease 拉取最新平台选择器配置。
- 配置由服务器签名，扩展验签。
- 配置可按版本、平台、用户 tier 下发。

配置结构：

```json
{
  "type": "SELECTOR_CONFIG",
  "version": 12,
  "platform": "douyin",
  "minExtensionVersion": "0.1.0",
  "selectors": {
    "title": ["..."],
    "description": ["..."]
  },
  "issuedAt": "2026-05-23T00:00:00Z"
}
```

---

## 10. 反调试与完整性

### 10.1 反调试建议

反调试只能增加分析成本，不能作为安全边界。

可以做：

- 检测异常调试耗时。
- 检测频繁断点导致的 heartbeat drift。
- 记录异常分数。
- 异常时要求重新在线验证。

不建议做：

- 修改 `Object.prototype`。
- 大量插入 `debugger`。
- 故意让功能随机失败。
- 伪装成平台 bug 的缓慢降级。

原因：

- 容易误伤正常用户。
- 会增加售后成本。
- 会降低产品可信度。
- 专业逆向仍能绕过。

### 10.2 完整性校验

可以校验：

- 关键 JS chunk hash。
- WASM 文件 hash。
- Native Helper 版本和签名。
- 选择器配置签名。

但完整性校验要注意：

- 校验逻辑在客户端，仍可被 patch。
- 预期 hash 不能只放 JS 明文里。
- 校验失败不建议随机降级，建议进入“需要修复/重新安装/重新验证”状态。

### 10.3 降级策略

不推荐原 v2 的“缓慢降级，让用户以为平台 bug”。

建议改为明确状态：

| 状态 | 行为 |
|---|---|
| 未授权 | 只开放免费功能，引导激活 |
| 授权过期 | 禁用 Pro 功能，提示续费 |
| 需要联网续租 | 保留宽限期，到期后禁用 Pro |
| 设备不匹配 | 禁用 Pro，提示换绑 |
| 文件损坏或疑似篡改 | 提示重新安装或重新验证 |

---

## 11. Native Helper 设计

### 11.1 命令接口

扩展通过 Native Messaging 调用：

```json
{
  "id": "req_01",
  "method": "getDeviceInfo",
  "params": {}
}
```

Response:

```json
{
  "id": "req_01",
  "ok": true,
  "result": {
    "deviceId": "dev_abc",
    "devicePublicKey": "base64url...",
    "os": "macos",
    "helperVersion": "1.0.0"
  }
}
```

### 11.2 方法列表

| Method | 用途 |
|---|---|
| `getDeviceInfo` | 返回设备 ID、公钥、helper 版本 |
| `signNonce` | 使用设备私钥签名服务器 nonce |
| `getTimeState` | 返回本地时间状态 |
| `updateTimeState` | 保存服务器时间和本地最后使用时间 |
| `healthCheck` | 检查 helper 是否正常 |

### 11.3 安全存储

| 系统 | 私钥存储建议 |
|---|---|
| Windows | DPAPI CurrentUser |
| macOS | Keychain |
| Linux | Secret Service/libsecret，降级为加密文件 |

私钥不要直接写普通 JSON 文件。即使落盘，也要使用系统用户级加密。

---

## 12. 数据存储

### 12.1 扩展 storage

`chrome.storage.local` 保存：

```json
{
  "pf_license_cert": "...",
  "pf_lease": "...",
  "pf_last_server_time": "2026-05-23T10:00:00Z",
  "pf_selector_config_cache": {
    "version": 12,
    "payload": "...",
    "signature": "..."
  }
}
```

不要保存：

- 服务器私钥。
- HMAC secret。
- 设备私钥。
- 未加密的敏感 token。

### 12.2 服务器数据库

核心表：

- `users`
- `orders`
- `licenses`
- `devices`
- `leases`
- `activation_challenges`
- `revocations`
- `selector_configs`

`devices` 示例字段：

| 字段 | 说明 |
|---|---|
| `device_id` | hash 后设备 ID |
| `license_id` | 所属授权 |
| `device_public_key` | 设备公钥 |
| `first_activated_at` | 首次激活时间 |
| `last_seen_at` | 最近续租时间 |
| `status` | active / deactivated / blocked |

---

## 13. 实现优先级

### Phase 1：授权根基

1. 新建授权服务器。
2. 实现 Ed25519 私钥签发、公钥验签。
3. 实现 license certificate。
4. 实现扩展端验签。
5. Dashboard 支持输入序列号和展示授权状态。

### Phase 2：Native Helper

1. 实现 Native Messaging。
2. 获取系统稳定 ID。
3. 生成设备密钥对。
4. 实现 nonce 签名。
5. 激活流程绑定设备。

### Phase 3：Lease 与商业控制

1. 实现 lease 签发和续租。
2. 支持设备数限制。
3. 支持解绑和吊销。
4. 支持短期离线宽限。
5. 支持永久离线证书。

### Phase 4：代码保护

1. 生产构建启用 JS 混淆。
2. 授权和选择器相关逻辑迁入 WASM。
3. 选择器配置 AES-GCM 加密。
4. 远程选择器配置签名下发。

### Phase 5：加固与运营

1. 轻量反调试检测。
2. 完整性校验。
3. 版本策略和黑名单。
4. 日志与异常统计。
5. 换绑和售后流程。

---

## 14. 与旧方案的主要改动

| 旧方案 | 新方案 |
|---|---|
| WASM 内藏 HMAC 密钥 | 服务器私钥签名，客户端只放公钥 |
| 客户端能派生授权 secret | 客户端不能生成授权 |
| 浏览器指纹作为机器码 | Native Helper + 系统稳定 ID + 设备密钥对 |
| 完全离线验证为主 | 推荐 lease + 离线宽限，兼容永久证书 |
| 选择器固定本地加密 | 本地快照 + 远程签名配置 |
| 反调试强干扰 | 轻量检测，异常要求验证 |
| 缓慢降级 | 明确授权状态和错误提示 |
| HMAC payload 未覆盖 tier 风险 | 所有 claims 都进入签名 payload |

---

## 15. 推荐最终落地版本

如果只选一个版本落地，我建议：

1. 订阅版使用 30 天 lease，离线最多可用 30 天。
2. 永久买断版使用永久 license certificate，绑定 1-2 台设备。
3. 激活和换绑必须在线。
4. Native Helper 负责设备身份，不使用浏览器指纹做强绑定。
5. 扩展只保留公钥和本地验签逻辑。
6. 选择器使用内置快照 + 在线签名更新。
7. 混淆和 WASM 作为生产构建加固。

这样能同时满足：

- 用户可以离线使用。
- 你可以控制订阅、续费、设备数。
- 永久买断有明确边界。
- 破解者不能批量签发 license。
- 选择器和核心逻辑不容易被静态复制。

---

## 16. 安全等级评估

| 攻击手段 | 新方案效果 |
|---|---|
| 直接读 JS 源码 | 混淆后成本较高 |
| 搜索选择器字符串 | 加密和远程配置后成本较高 |
| 自己生成 license | 无服务器私钥，基本不可行 |
| 复制 license 到另一台机器 | 设备密钥绑定后不可直接用 |
| 改本地时间 | lease 模式可通过续租限制；永久版无过期则不受影响 |
| patch 本地 JS 自用 | 无法完全阻止 |
| patch 后批量分发 | 可用版本和配置更新压制，维护成本较高 |
| 提取运行时选择器 | 无法完全阻止，只能提高批量化成本 |

一句话总结：

> 授权安全靠服务器私钥和设备密钥绑定；代码保护靠混淆、WASM、选择器加密；商业可控靠短期 lease；永久离线只能作为买断特性，并接受不能强吊销和不能绝对防 patch 的边界。
