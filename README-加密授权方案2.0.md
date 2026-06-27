# PubFlow 加密授权方案 2.0

> 版本：2.0  
> 日期：2026-06-26  
> 范围：前端售卖页、后端授权服务、浏览器插件授权机制  
> 目标：支持买断制（服务器离线可用）、提高授权防共享能力、完善运营功能

---

## 1. 当前授权机制概述

PubFlow 当前采用「激活码 → 服务器 lease → 浏览器扩展」的订阅授权模式：

1. 用户购买月卡/年卡，获得 `activation_code`（如 `PF-XXXX...`）。
2. 插件首次启动时，通过 **PFAP（PubFlow Activation Protocol）** 把激活码和浏览器 `client_install_id` 发给服务器。
3. 服务器返回 `lease_token`（JWT，HS256 签名，有效期最长 365 天）。
4. 插件每次启动调用 `/v1/lease/verify` 做在线验证。
5. 平台选择器通过 `server_secret + activation_code` 派生密钥，经 AES-256-GCM 解密后使用。

### 1.1 当前薄弱点

| 薄弱点 | 说明 | 影响 |
|---|---|---|
| `client_install_id` 太弱 | 由 `crypto.randomUUID()` 生成，存在 `browser.storage.local`，换浏览器、清数据、重装插件都会变 | 无法真正绑定设备 |
| 依赖服务器在线验证 | `lease_token` 是服务器 HS256 签名，插件端无法离线验证 | 服务器关机即失效 |
| `machine_hash` 未真正使用 | `lease.service.rs:404` 中写死为 `"client-install-id"` | 设备绑定名存实亡 |
| 没有离线签名 License | `core/src/license.rs` 和 WASM 已有 Ed25519 验签能力，但 lease 流程未使用 | 买断制无法落地 |
| 扩展目录完全暴露 | unpacked 扩展可被用户任意修改、复制 | 任何本地文件保护都无效 |

---

## 2. 核心问题与约束

### 2.1 必须满足的需求

1. **买断制**：用户一次性付费后，即使服务器关机也能长期使用。
2. **换浏览器可用**：同一台电脑上更换浏览器或重装插件后，授权仍然有效。
3. **控制一码多用**：同一激活码不能无限制地在多台电脑/多个用户间共享。（本人可以切换 目前是切换次数限制方案）

### 2.2 明确不做的事

- 不追求绝对不可破解。浏览器扩展在 unpacked 模式下运行在用户机器上，不存在绝对安全。
- 不把核心功能强依赖云端，避免服务器宕机导致用户无法使用。
- 不采用端口监听、扩展目录文件保护等低级且无效的方案。

### 2.3 关键认知

> **在浏览器扩展里，不存在「用户改不了」的本地存储。**
>
> 任何放在扩展目录、`chrome.storage.local`、`IndexedDB`、`localStorage` 里的数据，用户都能查看、修改、清空。
>
> 唯一能提高安全性的是：**密码学签名（服务器私钥签名，客户端公钥验证）** 和 **系统级设备绑定（Native Helper）**。

---

## 3. 候选方案对比

针对买断制和防共享目标，讨论以下三个方案。

---

### 方案一：通用 WASM + Ed25519 签名 License（无 Native Helper）

#### 3.1.1 实现思路

1. 后端激活接口不再返回 HS256 JWT，而是签发 **Ed25519 签名 License certificate**。
2. License 字段包含：
   - `device_id`（浏览器 `install_id` 或机器码哈希）
   - `tier`（pro / enterprise）
   - `plan`（perpetual / monthly / yearly）
   - `expires_at`（买断制可设为极远时间）
   - `activation_code`
   - `signature`（Ed25519 签名）
3. WASM 中硬编码 Ed25519 公钥，离线验证签名和过期时间。
4. 插件保存 License certificate，启动时 WASM 验签即可，无需联网。
5. 选择器解密继续使用 `server_secret + activation_code` 派生密钥。

#### 3.1.2 技术实现要点

- **后端**：改造 `/v1/lease/activate`，使用 `core/src/license.rs` 的 `License` 结构和 `sign()` 方法。
- **WASM**：复用 `wasm/src/lib.rs` 中的 `verify_license()`，插件端调用 WASM 离线验签。
- **插件端**：改造 `licenseManager.ts`，用 WASM 验签替代 `/v1/lease/verify` 在线请求。
- **数据库**：`licenses` 表已支持 `plan`、`max_devices`、`device_migration_limit` 等字段，无需大改。

#### 3.1.3 优点

| 优点 | 说明 |
|---|---|
| 服务器关机可用 | License 是本地可验证的签名证书 |
| 实现相对简单 | 复用现有 `license.rs` 和 WASM 代码 |
| 用户体验好 | 不需要安装额外程序 |
| 防有效期篡改 | 改 `expires_at` 会导致签名验证失败 |
| 防通用破解包 | 没有有效激活码无法解密选择器 |

#### 3.1.4 缺点

| 缺点 | 说明 |
|---|---|
| 无法真正防共享 | 用户可以把 License certificate + 激活码一起复制给另一台电脑 |
| 换浏览器需重新激活 | `install_id` 是浏览器级别的，换浏览器就是新设备 |
| 无法防止存储清空 | 用户清空插件数据后需要重新激活 |
| 一码多用依赖后端 | 只能依赖后端设备数限制，但买断制下难以强联网校验 |

---

### 方案二：Native Helper + Ed25519 签名 License + WASM 离线验签

#### 3.2.1 实现思路

1. **Native Helper 作为系统级信任根**：
   - 首次运行时生成 Ed25519 设备密钥对。
   - 私钥存入系统安全存储（Windows DPAPI/TPM、macOS Keychain、Linux keyring/加密文件）。
   - 公钥上报服务器。
2. **激活流程**：
   - 用户输入激活码。
   - 扩展通过 Chrome Native Messaging 请求 Native Helper 用设备私钥签名服务器下发的 nonce。
   - 扩展将签名和机器码哈希发送给服务器。
   - 服务器验证签名，检查设备数限制，签发 **绑定该设备公钥的 Ed25519 License**。
3. **离线验证流程**：
   - 插件启动时，WASM 验证 License 的服务器签名。
   - 扩展通过 Native Messaging 请求 Native Helper 用设备私钥签名当前状态。
   - 验证 License 中的 `device_public_key` 与 Native Helper 的公钥匹配。
   - 全部通过则授权有效，无需联网。
4. **设备数控制**：
   - 新设备激活时，后端检查 `max_devices`，超限则拒绝或自动吊销最旧设备。
   - 保留 `device_migration_limit` 和 `device_migration_count` 控制换机次数。

#### 3.2.2 技术实现要点

- **Native Helper（`native/`）**：
  - 已有 `get_machine_id`、`get_platform`、`ping` 能力。
  - 新增：`generate_device_keypair`、`sign_activation_nonce`、`verify_license`。
  - 使用平台安全存储保存私钥。
  - 维护本地单调时间，防止系统时间回拨。
- **后端**：
  - `licenses` 表新增 `device_public_key` 字段。
  - `/v1/lease/activate` 接收设备签名，验证后签发绑定设备公钥的 License。
  - 保留并强化设备数限制和迁移逻辑。
- **插件端**：
  - 新增 Native Messaging 调用封装。
  - 激活和验证流程中加入 Native Helper 调用。
  - 未安装 Native Helper 时引导用户安装。
- **WASM**：
  - 保持 Ed25519 验签逻辑。
  - License 结构扩展 `device_public_key` 字段。

#### 3.2.3 优点

| 优点 | 说明 |
|---|---|
| 服务器关机可用 | License 本地签名验证 |
| 换浏览器可用 | 设备身份在系统层，不依赖浏览器 `install_id` |
| 真正控制一码多用 | 私钥存在系统安全存储，复制扩展目录到另一台电脑无效 |
| 激活码+扩展包共享也无效 | 另一台电脑没有原设备的私钥 |
| 可维护安全时间 | Native Helper 能记录防回拨时间戳 |
| 可校验扩展完整性 | Native Helper 可计算扩展文件哈希（但只能作为辅助） |
| 攻击成本高 | 从「改 JS」提升到「逆向 Rust 二进制 + 攻破系统安全存储」 |

#### 3.2.4 缺点

| 缺点 | 说明 |
|---|---|
| 用户体验变重 | 首次使用需要安装 Native Helper |
| 安装兼容性问题 | Windows 需要安装包/注册表，macOS 需要签名/Keychain 权限，Linux 更复杂 |
| 杀毒软件误报 | Rust 二进制可能被误报 |
| 开发和维护成本高 | 跨平台密钥管理、安装包、自动更新 |
| 仍有上限 | 如果用户有管理员权限并能 patch Native Helper 或模拟完整系统环境，仍可能破解 |
| 买断制下无法实时吊销 | 一旦 License 签发，离线状态下无法收回 |

---

### 方案三：个性化 WASM（作为参考，不作为推荐）

#### 3.3.1 实现思路

用户购买后，后端根据激活码动态生成一个额外的个性化 WASM 文件，内嵌与该激活码相关的密钥片段。用户把这个 WASM 放入已解压的扩展目录，与通用 WASM 配合完成授权验证或选择器解密。

#### 3.3.2 优点

- 每个用户的 WASM 不同，通用破解包无法直接使用。
- 可作为安装包水印，追踪泄露来源。
- 服务器简单，只需一个根据激活码生成 WASM 的服务。

#### 3.3.3 缺点

- **无法防止「整个文件夹 + 激活码 + 个性化 WASM」一起共享**。
- 如果 A 用户把整个目录和激活码复制给 B，B 输入 A 的激活码即可使用。
- 构建和分发流程变复杂。
- 换机、重装需要重新生成 WASM。

#### 3.3.4 结论

**不推荐作为主要安全方案。** 它只能提高通用破解成本，不能解决一码多用问题。

---

## 4. 方案对比总结

| 维度 | 方案一：通用 Ed25519 License | 方案二：Native Helper + Ed25519 License | 方案三：个性化 WASM |
|---|---|---|---|
| 服务器关机可用 | ✅ | ✅ | ✅ |
| 换浏览器可用 | ❌ | ✅ | ❌ |
| 防一码多用 | ❌ | ✅ | ❌ |
| 防通用破解包 | ✅ | ✅ | ✅ |
| 防有效期篡改 | ✅ | ✅ | ✅ |
| 用户体验 | 好 | 需安装 Native Helper | 好 |
| 开发成本 | 低 | 中 | 中 |
| 维护成本 | 低 | 中 | 中 |
| 推荐度 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |

---

## 5. 最终推荐方案

**选用方案二：Native Helper + Ed25519 签名 License + WASM 离线验签。**

### 5.1 推荐理由

1. **唯一同时满足三个核心需求**：买断离线可用、换浏览器可用、控制一码多用。
2. **安全风险可控**：私钥存在系统安全存储，复制扩展目录无效。
3. **与现有项目兼容**：现有 `native/` 目录已具备机器码获取能力，扩展改造成本中等。
4. **攻击成本足够高**：对一个小工具来说，逆向 Rust 二进制 + 攻破系统安全存储的门槛已经足够。

### 5.2 最小可行实现路径（MVP）

#### 第一阶段：建立设备身份（1-2 个月）

1. Native Helper 生成 Ed25519 设备密钥对，私钥存入系统安全存储。
2. Native Helper 提供 `sign_activation_nonce` 和 `get_device_public_key` 接口。
3. 插件端通过 Chrome Native Messaging 调用 Native Helper。
4. 后端 `licenses` 表新增 `device_public_key` 字段。
5. 后端激活接口验证设备签名。

#### 第二阶段：签发 Ed25519 License（1 个月）

1. 后端 `/v1/lease/activate` 签发绑定设备公钥的 License certificate。
2. WASM 离线验证 License 签名和过期时间。
3. 插件端保存 License，启动时 WASM 验签，不再强依赖 `/v1/lease/verify`。
4. 保留 `/v1/lease/verify` 作为可选在线校验和吊销检查。

#### 第三阶段：设备管理与运营（1 个月）

1. 后端强化设备数限制和迁移逻辑。
2. 后台管理页支持查看设备列表、手动解绑、吊销 License。
3. 插件端提供 Native Helper 安装引导。

---

## 6. 关于扩展目录完整性校验的说明

曾有考虑：扩展启动时计算自身目录文件哈希，检测是否被篡改。

**结论：无效，不推荐。**

原因：
1. 扩展没有写自己目录的权限，但可以读取自身资源。
2. 校验代码本身也在扩展目录中，攻击者可以直接修改校验代码返回 `true`。
3. 攻击者可以直接用一个已经破解的完整目录覆盖，所有文件哈希都「正确」。
4. 没有信任根的情况下，「自己校验自己」逻辑上不成立。

因此，**不把完整性校验作为主要安全手段**。

---

## 7. 需求清单

以下需求按优先级排列，纳入后续开发计划。

### 7.1 高优先级

#### R1. 限时折扣功能

**需求描述**：
支持为月卡、年卡设置限时折扣，在指定时间区间内以折扣价销售，前端展示原价划线和折扣价。

**后端**：
- `product_catalog` 表增加字段：
  - `original_price_cents`：原价（分）
  - `discount_price_cents`：折扣价（分）
  - `discount_start_at`：折扣开始时间
  - `discount_end_at`：折扣结束时间
- `/v1/product/catalog` 返回当前生效价格（如果在折扣区间内返回折扣价，否则返回原价）。
- `/v1/purchase/orders` 创建订单时必须根据当前时间重新计算价格，不能信任前端传价。

**前端（Web 购买页）**：
- 计划卡片展示原价划线和折扣价。
- 显示「限时折扣」标签或倒计时。
- 订单摘要显示实际支付价格和节省金额。

**后台管理页**：
- 支持为每个计划配置折扣价和折扣时间区间。
- 支持开关控制是否启用折扣。

#### R2. 买断制授权改造（Native Helper + Ed25519 License）

**需求描述**：
支持买断制套餐，用户购买后获得永久或长期有效的 License，服务器关机后仍可离线使用。

**后端**：
- `licenses` 表新增 `device_public_key` 字段。
- 支持 `plan: "perpetual"`。
- `/v1/lease/activate` 接收设备签名，验证后签发绑定设备公钥的 Ed25519 License。
- 设备数限制和迁移逻辑保留并强化。

**Native Helper**：
- 生成 Ed25519 设备密钥对，私钥存入系统安全存储。
- 提供 `sign_activation_nonce`、`get_device_public_key`、`verify_license` 接口。
- 维护本地单调时间，防止系统时间回拨。

**插件端**：
- 激活和验证流程加入 Native Helper 调用。
- 未安装 Native Helper 时引导安装。
- WASM 离线验证 License 签名。

**后台管理页**：
- 生成激活码时支持选择 `perpetual` 套餐。
- 支持查看 License 绑定的设备公钥。

#### R3. 下载中心改造

**需求描述**：
当前下载中心使用本地固定路径，用户实际下载不到文件。需要支持通过外部链接或服务器托管下载。

**方案 A（外部 CDN/Release，推荐）**：
- 每次发版将 `pubflow-pro.crx` 和 `pubflow-pro.zip` 上传到 GitHub Releases / Gitee Release / 第三方 CDN。
- 后台配置下载链接。
- 前端点击后直接跳转外部链接下载。

**方案 B（服务器托管）**：
- 后端提供 `/static/downloads/` 静态文件服务。
- 前端下载链接指向服务器地址。
- 需要处理带宽和存储。

**前端**：
- `DownloadPage.vue` 改为从 `/v1/product/catalog` 获取下载配置，支持多个平台和下载方式。
- 展示下载按钮和文件信息。

#### R4. 补发激活码功能

**需求描述**：
用户激活码丢失、泄露或需要换绑时，后台支持补发新激活码，原激活码可选择注销或保留。

**后端**：
- 新增补发记录表 `license_replacements`（或复用 `license_events`）：
  - `id`
  - `old_license_id`：原 License ID
  - `new_license_id`：新 License ID
  - `reason`：补发原因（丢失、泄露、换绑等）
  - `operator`：操作人
  - `created_at`
- 后台补发时：
  - 可选注销原 License（`is_revoked = true`）。
  - 生成新 License，保留原套餐、有效期、设备限制等策略。
  - 记录补发关系，关联原激活码 ID 和新激活码 ID。
- 后台查询 License 时，可查看补发历史。

**前端（后台管理页）**：
- License 列表增加「补发」操作按钮。
- 补发时弹窗选择：是否注销原激活码、补发原因。
- 展示补发历史记录。

**说明**：
> 后台记录补发请求时，应记录 `old_license_id` 和 `new_license_id`，而不是直接记录激活码字符串。`license_events` 表和 `license_replacements` 表通过 `license_id` 关联即可查询到对应激活码。

#### R5. 调整设备迁移上限和认证次数

**需求描述**：
后台支持为单个 License 动态调整最大设备数和迁移次数上限，方便处理用户换机、重装等特殊情况。

**后端**：
- 提供接口修改 `license.max_devices`、`license.device_migration_limit`。
- 修改时记录到 `license_events`，原因可填写「运营调整」等。

**前端（后台管理页）**：
- License 详情/列表增加「调整限制」操作。
- 可修改 `max_devices` 和 `device_migration_limit`。
- 显示当前已用设备数和已迁移次数。

---

### 7.2 中优先级

#### R6. 插件版本检测与更新提示

**需求描述**：
插件启动时检测是否有新版本，提示用户下载更新。

**实现方式**：
- 扩展后台请求 `https://你的域名/update.yml` 或 JSON 版本接口。   这块可以直接用GitHub的地址 在GitHub Action里边增加一个生成update yML
- 对比当前 `manifest.version` 和最新版本。
- 如果有新版本，弹出通知或打开下载页。

**说明**：
- 已解压加载的扩展不支持 Chrome 自动更新。
- CRX 安装方式可配置 `update_url` 实现自动更新。
- 以当前混淆和权限强度，**不建议也不指望上架 Chrome Web Store**，通过官网/Release 分发即可。

#### R7. 项目同步规范（pubflow vs pubflow-Pro）

**需求描述**：
明确自用版（`pubflow`）和商用版（`pubflow-Pro`）的代码差异边界，降低同步维护成本。

**建议做法**：
- 将商用授权逻辑集中到 `src/licensing/protection/` 目录。
- 自用版中该目录提供空实现（直接返回授权有效）。
- 商用版中该目录提供真实实现（WASM、Native Helper、激活流程）。
- 其他业务代码两版本保持一致，同步时只覆盖业务代码，保留 `protection` 目录。
- 长期建议改用 Git 分支管理：`main` 分支为自用版，`pro` 分支基于 `main` 合并商用保护逻辑。

---

### 7.3 低优先级

#### R8. 双服务器 Failover

**需求描述**：
插件端支持配置多个 API 地址，一台服务器不可用时自动切换到另一台。

**实现方式**：
- 插件端配置多个 `apiBaseUrl`。
- 请求失败时按顺序重试下一个地址。
- 后端保持无状态，共用同一数据库和文件存储。

**说明**：
这是运维层面的增强，等用户量和收入上去后再实施。

#### R9. 弱联网黑名单（可选增强）

**需求描述**：
买断制下，插件启动时尝试联网拉取黑名单，发现 License 被标记为盗版/滥用时记录并可能限制部分功能。

**说明**：
- 失败不影响核心功能。
- 仅作为辅助手段，不能依赖它阻止离线使用。
- 在买断制下效果有限。

---

## 8. 补发激活码方案详细设计

### 8.1 数据模型

新增表 `license_replacements`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `old_license_id` | UUID | 原 License ID，外键关联 `licenses` |
| `new_license_id` | UUID | 新 License ID，外键关联 `licenses` |
| `reason` | String | 补发原因 |
| `operator` | String | 操作人（管理员账号） |
| `revoked_old` | Boolean | 是否注销原 License |
| `created_at` | Timestamp | 创建时间 |

### 8.2 接口设计

**补发激活码**

```http
POST /v1/admin/licenses/replace
Authorization: Bearer <admin_token>
```

请求体：

```json
{
  "activation_code": "PF-XXXX",
  "reason": "用户反馈激活码丢失",
  "revoke_old": true
}
```

响应体：

```json
{
  "old_license_id": "uuid",
  "new_license_id": "uuid",
  "new_activation_code": "PF-YYYY",
  "revoked_old": true
}
```

### 8.3 业务流程

1. 管理员在后台输入原激活码，选择补发原因，选择是否注销原激活码。
2. 后端查询原 License，复制其策略（plan、tier、max_devices、device_migration_limit、expires_at 等）。
3. 生成新的 License 和激活码。
4. 如果 `revoke_old = true`，将原 License `is_revoked` 置为 `true`，并吊销其关联的所有 lease。
5. 在 `license_replacements` 中记录补发关系。
6. 在 `license_events` 中记录 `replace` 事件。
7. 返回新激活码给管理员。

### 8.4 查询关联

通过 `license_id` 关联即可查询激活码，无需在补发表中冗余存储激活码字符串：

```sql
SELECT 
  lr.id,
  old.activation_code AS old_activation_code,
  new.activation_code AS new_activation_code,
  lr.reason,
  lr.operator,
  lr.revoked_old,
  lr.created_at
FROM license_replacements lr
JOIN licenses old ON lr.old_license_id = old.id
JOIN licenses new ON lr.new_license_id = new.id
WHERE old.activation_code = 'PF-XXXX';
```

---

## 9. 结论与下一步

1. **安全方案**：采用 **Native Helper + Ed25519 签名 License + WASM 离线验签**，这是当前约束下唯一能满足买断制、换浏览器可用、控制一码多用的方案。
2. **运营功能**：优先实现限时折扣、下载中心改造、补发激活码、调整设备限制。
3. **插件分发**：不走 Chrome Web Store，通过官网/Release 分发 CRX/ZIP，配合 update.xml 或手动更新提示。
4. **项目维护**：明确 `pubflow` 与 `pubflow-Pro` 的差异边界，建议集中到 `src/licensing/protection/`。

下一步建议：确认本方案后，先输出 Native Helper 第一阶段的技术设计文档，再并行推进限时折扣和下载中心改造。
