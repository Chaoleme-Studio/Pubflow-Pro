# PubFlow Pro 产品需求文档（PRD）

> 版本：v1.0  
> 日期：2026-06-26  
> 适用项目：
> - `pubflow-Pro`（浏览器插件端）
> - `pubflow-Pro-server-axum-starter`（后端服务）
> - `pubflow-Pro-Web`（前端售卖/管理页）

---

## 1. 文档说明

### 1.1 背景

PubFlow Pro 是一款面向内容创作者的浏览器扩展，支持多平台批量发布图文、视频和长文章。当前项目已完成基础订阅授权（月卡/年卡）、后台管理、订单支付、设备限制等能力。

### 1.2 目标

本文档明确后续需要实现的全部功能需求，按优先级分阶段推进。

### 1.3 范围

- 前端售卖与管理页（Vue 3）
- 后端服务（Rust Axum + SeaORM + PostgreSQL）
- 浏览器插件端（Chrome MV3 + WXT + Vue 3 + TypeScript）
- Native Helper 本地助手（Rust 二进制，Chrome Native Messaging）

---

## 2. 需求总览

| 编号 | 需求名称 | 优先级 | 涉及端 | 状态 |
|---|---|---|---|---|
| R1 | 限时折扣 | P0 | 后端、前端-Web | 待开发 |
| R2 | 下载中心改造 | P0 | 后端、前端-Web | 待开发 |
| R3 | 补发激活码 | P1 | 后端、前端-Web | 待开发 |
| R4 | 调整设备限制 | P1 | 后端、前端-Web | 已完成 |
| R5 | AI Provider 自定义中转 API 权限优化 | P1 | 插件端 | 待开发 |
| R6 | 插件版本检测与更新提示 | P1 | 插件端、后端 | 待开发 |
| R7 | 买断制授权改造（Native Helper + Ed25519 License） | P2 | 后端、插件端、Native Helper、WASM | 待开发 |

---

## R1. 限时折扣

### 2.1 需求目标

支持为月卡、年卡设置限时折扣，在指定时间区间内以折扣价销售，前端展示原价划线和折扣价。

### 2.2 用户场景

- 运营人员想在特定活动期间（如618、双11）促销月卡和年卡。
- 用户访问购买页时，看到限时折扣价格和倒计时，促进转化。
- 后台管理员可以灵活配置折扣价和活动时间。

### 2.3 验收标准

- [ ] `product_catalog` 表增加折扣相关字段：原价、折扣价、折扣开始时间、折扣结束时间、是否启用折扣。
- [ ] 后台管理页可为每个计划配置折扣参数。
- [ ] 未配置折扣或不在折扣时间区间内时，按原价销售。
- [ ] 折扣生效时，商品目录接口返回折扣价；非折扣区间返回原价。
- [ ] 创建订单时后端必须根据当前时间重新计算价格，不信任前端传价。
- [ ] 前端购买页展示原价划线 + 折扣价高亮 +「限时折扣」标签/倒计时。
- [ ] 订单摘要显示实际支付价格和节省金额。

### 2.4 详细设计

#### 2.4.1 数据库变更

在 `product_catalog` 表新增以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `original_price_cents` | i32 | 原价，单位分 |
| `discount_price_cents` | i32 | 折扣价，单位分 |
| `discount_start_at` | Timestamp | 折扣开始时间 |
| `discount_end_at` | Timestamp | 折扣结束时间 |
| `discount_enabled` | bool | 是否启用折扣 |

#### 2.4.2 后端接口

**获取商品目录**

```http
GET /v1/product/catalog
```

响应：

```json
{
  "data": {
    "plans": [
      {
        "id": "monthly",
        "name": "月卡",
        "price": "9.9",
        "original_price": "29.9",
        "unit": "月",
        "note": "限时折扣",
        "amount_cents": 990,
        "is_discount": true
      }
    ],
    "downloads": []
  }
}
```

说明：
- `price` 和 `amount_cents` 始终返回当前生效价格（折扣期内返回折扣价）。
- 折扣期内额外返回 `original_price` 和 `is_discount: true`。

**创建订单**

```http
POST /v1/purchase/orders
```

请求体：

```json
{
  "plan": "monthly",
  "channel": "wechat"
}
```

后端逻辑：
- 根据 `plan` 和当前时间，从 `product_catalog` 计算当前生效价格。
- 不使用前端传入的价格。
- 折扣期外按原价创建订单。

#### 2.4.3 前端页面

**购买页 `PurchasePage.vue`**

折扣生效时计划卡片：

```
┌─────────────────┐
│ 月卡            │
│                 │
│ ¥29.9 ¥9.9/月  │
│ 限时折扣        │
│                 │
│ 剩余 23:59:59   │
└─────────────────┘
```

订单摘要：

```
订单摘要
────────────
月卡                    ¥9.9
原价                    ¥29.9
节省                    ¥20.0

支付方式        微信支付
```

**后台管理页 `AdminPage.vue`**

新增「折扣配置」区域：
- 计划选择（monthly/yearly）
- 原价输入（元）
- 折扣价输入（元）
- 折扣开始时间
- 折扣结束时间
- 是否启用开关
- 保存/取消按钮

### 2.5 涉及文件

- `pubflow-Pro-server-axum-starter/entity/src/product_catalog.rs`
- `pubflow-Pro-server-axum-starter/migration/src/`（新增迁移文件）
- `pubflow-Pro-server-axum-starter/app/src/modules/product/service.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/product/dto.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/purchase/service.rs`
- `pubflow-Pro-Web/src/api.ts`
- `pubflow-Pro-Web/src/pages/PurchasePage.vue`
- `pubflow-Pro-Web/src/pages/AdminPage.vue`

### 2.6 优先级

P0

---

## R2. 下载中心改造

### 3.1 需求目标

解决当前下载中心链接失效、用户无法下载插件的问题。支持通过服务器托管或第三方平台分发下载文件。

### 3.2 用户场景

- 用户购买后访问下载页，需要下载 CRX 或 ZIP 安装包。
- 运营人员希望灵活切换下载来源（服务器托管 / Gitee / GitHub / CDN）。
- 不想每次发版都手动改前端代码里的下载链接。

### 3.3 验收标准

- [ ] 后台管理页可配置下载链接（支持 CRX 和 ZIP）。
- [ ] 下载链接支持两种模式：
  - 模式 A：服务器托管（`/static/downloads/` 直链）
  - 模式 B：外部链接（GitHub/Gitee Release、CDN 等，无需认证）
- [ ] 前端下载页从接口读取下载配置，展示下载卡片和按钮。
- [ ] 用户点击后直接下载或跳转外部链接。
- [ ] 服务器托管模式下，后台可上传/替换下载文件（可选，短期可用文件系统）。

### 3.4 详细设计

#### 3.4.1 数据库变更

复用 `product_catalog` 表，`kind = "download"` 的记录。

确保 `href` 字段支持完整外部 URL：

| href 示例 | 含义 |
|---|---|
| `/static/downloads/pubflow-pro.crx` | 服务器托管 |
| `https://gitee.com/xxx/releases/download/v1.0/pubflow-pro.crx` | 外部直链 |

#### 3.4.2 后端接口

下载配置随 `/v1/product/catalog` 一起返回。

#### 3.4.3 前端页面

**下载页 `DownloadPage.vue`**

从接口获取下载配置，渲染下载卡片：

```
┌─────────────────┐  ┌─────────────────┐
│ Chrome 扩展 CRX │  │ 离线包 ZIP      │
│ 推荐            │  │ 离线            │
│                 │  │                 │
│ [下载]          │  │ [下载]          │
└─────────────────┘  └─────────────────┘
```

下载逻辑：
- 如果是相对路径，拼接当前域名下载。
- 如果是外部链接，直接 `window.open` 跳转。

#### 3.4.4 推荐方案

短期优先使用 **Gitee/GitHub Release + 外部直链**：
- 零带宽成本
- 快速上线
- 后续用户量大了再切到服务器托管

### 3.5 涉及文件

- `pubflow-Pro-server-axum-starter/app/src/modules/product/service.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/product/dto.rs`
- `pubflow-Pro-server-axum-starter/entity/src/product_catalog.rs`
- `pubflow-Pro-server-axum-starter/config/*.toml`（静态文件服务配置）
- `pubflow-Pro-Web/src/pages/DownloadPage.vue`
- `pubflow-Pro-Web/src/api.ts`

### 3.6 优先级

P0

---

## R3. 补发激活码

### 4.1 需求目标

用户在激活码丢失、泄露、换机失败等场景下，后台管理员可为其补发新激活码，并可选择注销原激活码。

### 4.2 用户场景

- 用户丢失激活码，联系客服补发。
- 用户怀疑激活码泄露，要求注销旧码并发放新码。
- 用户换机失败，需要重新激活。

### 4.3 验收标准

- [ ] 后台 License 列表/详情页增加「补发激活码」按钮。
- [ ] 补发时弹窗填写原因，并选择是否注销原激活码。
- [ ] 补发后生成新 License，保留原套餐、有效期、设备限制策略。
- [ ] 如选择注销原激活码，自动吊销其关联的所有 lease。
- [ ] 补发记录通过 `license_id` 关联，不直接存储激活码字符串。
- [ ] 后台可查看某 License 的补发历史。

### 4.4 详细设计

#### 4.4.1 数据库变更

新增 `license_replacements` 表：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `old_license_id` | UUID | 原 License ID，外键关联 `licenses` |
| `new_license_id` | UUID | 新 License ID，外键关联 `licenses` |
| `reason` | String | 补发原因 |
| `operator` | String | 操作人 |
| `revoked_old` | bool | 是否注销原 License |
| `created_at` | Timestamp | 创建时间 |

#### 4.4.2 后端接口

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

业务流程：
1. 查询原 License。
2. 复制原 License 策略（plan、tier、max_devices、device_migration_limit、expires_at 等）。
3. 生成新 License 和激活码。
4. 如 `revoke_old = true`，原 License `is_revoked = true`，并吊销关联 lease。
5. 记录 `license_replacements`。
6. 记录 `license_events` 的 `replace` 事件。

#### 4.4.3 前端页面

**后台管理页 `AdminPage.vue`**

License 列表增加「补发」操作按钮。

补发弹窗字段：
- 原激活码（只读）
- 补发原因（输入框）
- 是否注销原激活码（开关）
- 新激活码（生成后展示）

补发历史展示：
- 补发时间
- 原激活码（通过 `license_id` 关联查询）
- 新激活码（通过 `license_id` 关联查询）
- 原因
- 操作人
- 是否注销原码

### 4.5 涉及文件

- `pubflow-Pro-server-axum-starter/entity/src/license.rs`（新增补发表）
- `pubflow-Pro-server-axum-starter/migration/src/`（新增迁移文件）
- `pubflow-Pro-server-axum-starter/app/src/modules/admin/service.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/admin/handler.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/admin/dto.rs`
- `pubflow-Pro-Web/src/pages/AdminPage.vue`
- `pubflow-Pro-Web/src/api.ts`

### 4.6 优先级

P1

---

## R4. 调整设备限制（已完成）

### 5.1 状态

已完成。

### 5.2 功能说明

后台支持为单个 License 动态调整最大设备数和迁移次数上限。

### 5.3 涉及文件

- `pubflow-Pro-server-axum-starter/app/src/modules/admin/service.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/admin/handler.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/admin/dto.rs`
- `pubflow-Pro-Web/src/pages/AdminPage.vue`
- `pubflow-Pro-Web/src/api.ts`

---

## R5. AI Provider 自定义中转 API 权限优化

### 6.1 需求目标

修复当前插件无法访问非预设 AI API 域名的问题，同时保持相对严谨的权限管理。

### 6.2 用户场景

- 用户购买了第三方 OpenAI 中转 API，域名不在预设列表中。
- 用户希望使用自己的私有化部署模型接口。

### 6.3 验收标准

- [ ] 预设 AI Provider（OpenAI、DeepSeek、通义千问等）无需弹窗即可使用。
- [ ] 标准 OpenAI Compatible 接口（路径含 `/v1/`）无需弹窗即可使用。
- [ ] 非标准路径的自定义 API 首次使用时，通过 Chrome 动态权限申请弹窗授权。
- [ ] 插件 manifest 不再使用 `<all_urls>` 宽泛权限。

### 6.4 详细设计

#### 6.4.1 manifest 权限配置

`wxt.config.ts`：

```ts
const AI_PROVIDER_HOST_PERMISSIONS = [
  // 已知预设域名
  'https://api.openai.com/*',
  'https://api.deepseek.com/*',
  'https://dashscope.aliyuncs.com/*',
  'https://api.siliconflow.cn/*',
  'https://api.xiaomimimo.com/*',

  // 兜底覆盖绝大多数 OpenAI Compatible 接口
  'https://*/v1/*',
];
```

#### 6.4.2 动态权限申请

在 `useSettingsAI.ts` 中添加：

```ts
async function ensureHostPermission(baseUrl: string): Promise<boolean> {
  if (!baseUrl) return false;

  const url = new URL(baseUrl);
  const origin = `${url.protocol}//${url.host}/*`;

  const hasPermission = await chrome.permissions.contains({
    origins: [origin],
  });

  if (hasPermission) return true;

  return chrome.permissions.request({
    origins: [origin],
  });
}
```

在保存自定义 provider 前调用：

```ts
const allowed = await ensureHostPermission(provider.baseUrl);
if (!allowed) {
  throw new Error('需要授权访问该 API 地址');
}
```

### 6.5 涉及文件

- `pubflow-Pro/wxt.config.ts`
- `pubflow-Pro/src/features/settings/useSettingsAI.ts`
- `pubflow-Pro/src/features/settings/aiPresets.ts`

### 6.6 优先级

P1

---

## R6. 插件版本检测与更新提示

### 7.1 需求目标

插件启动时检测是否有新版本，提示用户下载更新。

### 7.2 用户场景

- 用户安装了旧版插件，新版发布后希望用户及时更新。
- 已解压加载的扩展没有自动更新能力，需要手动提示。

### 7.3 验收标准

- [ ] 后端新建 `versions` 表，记录插件版本发布历史。
- [ ] 后台管理页支持新增版本、设置下载链接、填写更新内容。
- [ ] 后端提供 `GET /v1/product/version?platform=chrome` 接口返回最新版本。
- [ ] 插件后台启动时请求版本接口，对比当前 `manifest.version`。
- [ ] 发现新版本时弹出通知，点击打开下载页或下载最新 CRX。
- [ ] 更新检测失败不影响当前使用。
- [ ] 文档中说明：已解压加载不支持自动更新；CRX 安装方式可配置 `update_url`。

### 7.4 详细设计

#### 7.4.1 数据库变更

新建 `versions` 表：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `platform` | String | 平台，如 `chrome`、`edge` |
| `version` | String | 版本号，如 `1.1.0` |
| `download_url` | String | CRX 下载链接 |
| `release_notes` | String | 更新内容，支持 Markdown |
| `force_update` | bool | 是否强制更新 |
| `created_at` | Timestamp | 发布时间 |

#### 7.4.2 后端接口

**获取最新版本**

```http
GET /v1/product/version?platform=chrome
```

响应：

```json
{
  "data": {
    "id": "uuid",
    "platform": "chrome",
    "version": "1.1.0",
    "download_url": "https://...",
    "release_notes": "- 修复了...\n- 新增了...",
    "force_update": false,
    "created_at": "2026-06-26T..."
  }
}
```

#### 7.4.3 后台管理页

新增「版本管理」Tab：
- 版本列表（版本号、平台、发布时间、下载链接）
- 新增版本按钮
  - 平台选择
  - 版本号输入
  - 下载链接输入
  - 更新内容文本框
  - 是否强制更新开关
- 编辑/删除版本

#### 7.4.4 插件端检测

在 `background.ts` 启动时：

```ts
async function checkUpdate() {
  try {
    const current = browser.runtime.getManifest().version;
    const res = await fetch(`${apiBaseUrl}/v1/product/version?platform=chrome`);
    const data = await res.json();
    const latest = data.data.version;

    if (compareVersion(latest, current) > 0) {
      // 弹通知提示更新
      browser.notifications.create({
        type: 'basic',
        iconUrl: browser.runtime.getURL('icon/128.png'),
        title: 'PubFlow 有新版本',
        message: `最新版本 ${latest}，点击下载更新`,
      });

      browser.notifications.onClicked.addListener(() => {
        browser.tabs.create({ url: data.data.download_url });
      });
    }
  } catch {
    // 更新检测失败不影响使用
  }
}
```

版本号对比函数：

```ts
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
```

### 7.5 涉及文件

- `pubflow-Pro-server-axum-starter/entity/src/version.rs`（新建）
- `pubflow-Pro-server-axum-starter/migration/src/`（新增迁移文件）
- `pubflow-Pro-server-axum-starter/app/src/modules/product/service.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/product/handler.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/product/dto.rs`
- `pubflow-Pro-Web/src/pages/AdminPage.vue`
- `pubflow-Pro-Web/src/api.ts`
- `pubflow-Pro/src/entrypoints/background.ts`
- `pubflow-Pro/wxt.config.ts`

### 7.6 优先级

P1

---

## R7. 买断制授权改造（Native Helper + Ed25519 License）

### 8.1 需求目标

支持买断制套餐，用户一次性付费后，即使服务器关机也能长期使用，且换浏览器后仍能使用。

### 8.2 用户场景

- 用户希望一次性付费，永久使用，不依赖服务器在线状态。
- 用户更换浏览器或重装插件后，授权仍然有效。
- 运营方希望控制同一激活码在多台设备间共享。

### 8.3 验收标准

- [ ] 后端支持 `plan: "perpetual"`。
- [ ] 后端激活接口签发 Ed25519 签名 License，绑定设备公钥。
- [ ] Native Helper 生成设备 Ed25519 密钥对，私钥存入系统安全存储。
- [ ] Native Helper 提供设备签名、公钥获取、License 验证接口。
- [ ] 插件端通过 Chrome Native Messaging 调用 Native Helper。
- [ ] 插件端 WASM 离线验证 License 签名。
- [ ] 未安装 Native Helper 时，插件引导用户安装。
- [ ] 后台管理页支持生成买断制激活码、查看设备公钥、解绑设备、吊销 License。

### 8.4 详细设计

#### 8.4.1 整体架构

```
┌─────────────────────────────────────────┐
│           浏览器扩展 (插件端)             │
│  ├─ 激活流程                              │
│  ├─ Native Messaging 调用                 │
│  ├─ WASM Ed25519 验签                     │
│  └─ License 本地存储                      │
├─────────────────────────────────────────┤
│         Native Helper (Rust 二进制)        │
│  ├─ 生成 Ed25519 设备密钥对                │
│  ├─ 私钥存入系统安全存储                   │
│  ├─ 签名激活 nonce                        │
│  └─ 验证 License 设备绑定                  │
├─────────────────────────────────────────┤
│              后端服务 (Rust Axum)          │
│  ├─ 验证设备签名                          │
│  ├─ 签发 Ed25519 License                 │
│  ├─ 设备数限制                            │
│  └─ 设备迁移管理                          │
└─────────────────────────────────────────┘
```

#### 8.4.2 数据库变更

**`licenses` 表新增字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `device_public_key` | String | 绑定的设备 Ed25519 公钥 |

**保留已有字段：**
- `max_devices`
- `device_migration_limit`
- `device_migration_count`

#### 8.4.3 Native Helper 接口

通过 Chrome Native Messaging 调用。

**生成/获取设备公钥**

```json
{
  "action": "get_device_public_key"
}
```

响应：

```json
{
  "success": true,
  "public_key_hex": "...",
  "machine_hash": "..."
}
```

**签名激活 nonce**

```json
{
  "action": "sign_activation_nonce",
  "activation_code": "PF-XXXX",
  "server_nonce": "..."
}
```

响应：

```json
{
  "success": true,
  "signature_hex": "...",
  "machine_hash": "..."
}
```

**验证 License**

```json
{
  "action": "verify_license",
  "license_json": "..."
}
```

响应：

```json
{
  "success": true,
  "valid": true
}
```

#### 8.4.4 后端接口

**激活**

```http
POST /v1/lease/activate
```

请求体：

```json
{
  "activation_code": "PF-XXXX",
  "device_public_key_hex": "...",
  "signature_hex": "...",
  "server_nonce": "...",
  "machine_hash": "..."
}
```

后端逻辑：
1. 查询 License。
2. 验证设备签名。
3. 检查设备数限制。
4. 签发 Ed25519 License certificate：
   - `device_public_key`
   - `tier`
   - `plan: "perpetual"`
   - `expires_at: 一个较远时间`
   - `activation_code`
   - `signature`
5. 返回 License。

#### 8.4.5 License 结构

```rust
pub struct License {
    pub device_id: String,          // 机器码哈希
    pub device_public_key: String,  // 设备公钥
    pub tier: LicenseTier,
    pub plan: String,
    pub expires_at: i64,
    pub activation_code: String,
    pub signature: String,
}
```

签名覆盖字段：`device_id + device_public_key + tier + plan + expires_at + activation_code`。

#### 8.4.6 插件端验证流程

1. 启动时读取本地 License。
2. WASM 验证 License 的服务器签名。
3. Native Helper 用设备私钥签名当前状态。
4. 对比 License 中的 `device_public_key` 与 Native Helper 公钥。
5. 全部通过则授权有效，无需联网。

#### 8.4.7 设备数控制

- 新设备激活时，后端检查 `max_devices`。
- 超限则拒绝或自动吊销最旧设备。
- 保留 `device_migration_limit` 控制换机次数。

### 8.5 涉及文件

- `pubflow-Pro-server-axum-starter/core/src/license.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/lease/service.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/lease/handler.rs`
- `pubflow-Pro-server-axum-starter/app/src/modules/admin/service.rs`
- `pubflow-Pro-server-axum-starter/entity/src/license.rs`、迁移文件
- `pubflow-Pro-server-axum-starter/native/src/handler.rs`
- `pubflow-Pro-server-axum-starter/native/src/main.rs`
- `pubflow-Pro-server-axum-starter/wasm/src/lib.rs`
- `pubflow-Pro/src/licensing/*`
- `pubflow-Pro-Web/src/pages/AdminPage.vue`

### 8.6 优先级

P2

---

## 9. 实施路线图

### 第一阶段（1-2 周）

1. **R1 限时折扣**：直接增收，开发量适中。
2. **R2 下载中心改造**：解决用户无法安装的问题，必须做。

### 第二阶段（1-2 周）

3. **R3 补发激活码**：客服刚需。
4. **R5 AI Provider 自定义中转 API 权限优化**：修复现有功能问题。
5. **R6 插件版本检测与更新提示**：提升用户体验。

### 第三阶段（2-3 个月）

6. **R7 买断制授权改造**：长期商业化基础。

---

## 10. 备注

- 所有前端改动集中在 `pubflow-Pro-Web`。
- 所有后端改动集中在 `pubflow-Pro-server-axum-starter`。
- 插件端改动集中在 `pubflow-Pro`。
- 详细授权安全方案参考：`README-加密授权方案2.0.md`。
