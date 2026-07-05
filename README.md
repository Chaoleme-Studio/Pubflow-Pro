# PubFlow Pro

跨平台短视频自动发布浏览器扩展的授权管理系统。包含后端服务、管理后台前端、浏览器插件三个部分。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户购买流程                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  方案A: 网站购买          方案B: 第三方平台                       │
│  ┌──────────────┐        ┌──────────────┐                       │
│  │ 用户访问购买页 │        │ 管理员批量生成  │                       │
│  │ 选择套餐/支付  │        │ 激活码上架售卖  │                       │
│  └──────┬───────┘        └──────┬───────┘                       │
│         │                       │                               │
│         ▼                       ▼                               │
│  查询激活码                用户付款拿到码                          │
│         │                       │                               │
│         └───────────┬───────────┘                               │
│                     ▼                                           │
│             用户拿到激活码                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        插件激活流程                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 用户在插件中输入激活码                                        │
│  2. 插件通过 PFAP v1 调用 POST /v1/lease/activate                │
│  3. 服务端校验激活码 → 签发 JWT lease token（最长 30 天）          │
│  4. 插件自动加密存储 lease token 和 client_install_id             │
│  5. 紧接调用 /v1/lease/verify，首次绑定浏览器 P-256 设备公钥        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        日常使用流程                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  插件启动                                                        │
│    │                                                            │
│    ├─→ 读取本地 lease token                                      │
│    │     └─→ 客户端不信任本地 JWT 解析结果作为授权依据             │
│    │                                                            │
│    ├─→ POST /v1/lease/verify                                     │
│    │     └─→ 服务端验签 + 设备 proof + 过期/吊销状态校验           │
│    │                                                            │
│    └─→ 使用内置 Selector 自动化发布                               │
│          └─→ 点击「开始发布」时申请 permit，再打开各平台页面填充发布  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 授权方案

当前采用**订阅制 + 服务端短 lease + 浏览器实例设备密钥**模型：

- lease token 为 JWT HS256，订阅版最长 **30 天**。
- 浏览器内生成 **ECDSA P-256** 设备密钥对，私钥 `extractable=false` 存储在 IndexedDB。
- verify/renew/permit 必须携带 device proof（私钥签名服务端 challenge）。
- **开始发布**时申请一次性 `start_distribution` permit，5 分钟 TTL。
- 平台 selector 全部内置在插件本地，远程 selector 下发暂时废弃。
- 迁移额度按订阅时长折算：每 30 天 3 次，月卡 3 次、年卡 36 次。

详细方案见 [`README-授权方案.md`](./README-授权方案.md)。
完整威胁模型与安全架构见 [`pubflow-Pro/_doc/PubFlow Pro 安全-授权保护设计.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-授权保护设计.md)。

## 加密方案

| 数据 | 加密方式 | 存储位置 | 解密/验证方 |
|------|---------|---------|-----------|
| Lease Token | JWT (HS256) | 客户端加密存储 | 服务端验签 + device proof + 状态校验 |
| 设备私钥 | ECDSA P-256，不可导出 | 浏览器 IndexedDB | 浏览器 WebCrypto |
| 管理员密码 | Argon2 | 环境变量 | 服务端验证 |
| 订单查询令牌 | SHA-256 keyed hash | 客户端（URL 参数） | 服务端验证 |

### Lease Token

```
格式：JWT (HS256)
有效期：订阅版最长 30 天，以 license 到期时间为上限
自定义 Claims：
  - lease_id        租约唯一 ID
  - license_id      关联的 license ID
  - client_install_id  插件安装实例标识
  - lease_type      租约类型（subscription）
  - tier            许可等级（pro）
  - features        功能列表
  - valid_from      租约生效时间
  - valid_until     租约失效时间
  - min_extension_version  最低插件版本要求
  - policy_version  策略版本号
  - key_version     JWT 密钥版本
验证：
  - 客户端仅持有 token，不把未验签 payload 作为授权依据
  - 服务端验签 + device proof + 过期检查 + 吊销状态
```

部署、端口、Nginx 反代、插件生产打包配置见 [`README-部署说明.md`](./README-部署说明.md)。

## 项目结构

```
pubflow-Pro/
├── pubflow-Pro-server-axum-starter/    后端服务 (Rust/Axum)
│   ├── app/                            HTTP API、配置、中间件
│   ├── entity/                         SeaORM 实体
│   ├── migration/                      数据库迁移
│   ├── core/                           授权签名、加密、设备哈希
│   ├── wasm/                           浏览器插件 WASM 模块
│   ├── native/                         本地机器码工具（买断制预留）
│   └── scripts/                        构建脚本
│
├── pubflow-Pro-Web/                    管理后台前端 (Vue 3)
│   ├── src/pages/AdminPage.vue         管理后台主页
│   ├── src/pages/PurchasePage.vue      购买页
│   └── src/api.ts                      API 接口定义
│
└── pubflow-Pro/                        浏览器插件 (WXT + Vue 3)
    ├── entrypoints/                    background / content / dashboard
    └── src/licensing/                  授权、permit、设备密钥
```

## 核心 API

### 公开接口

| 接口 | 说明 |
|------|------|
| `GET /v1/product/catalog` | 获取产品套餐和下载配置 |
| `POST /v1/purchase/orders` | 创建购买订单 |
| `GET /v1/purchase/orders/:order_no?token=` | 查询订单状态和激活码（需 query token） |
| `POST /v1/lease/activate` | 激活（激活码 → lease token） |
| `POST /v1/lease/challenge` | 签发设备签名 challenge |
| `POST /v1/lease/verify` | 验证 lease token 并绑定/校验设备公钥 |
| `POST /v1/lease/renew` | 续租 |
| `POST /v1/lease/permit` | 申请发布 permit |
| `POST /v1/lease/deactivate` | 停用设备 / 自助解绑 |
| `GET /v1/license-center/lookup` | 查询授权状态和迁移额度 |
| `POST /v1/license-center/self-reset-devices` | 自助解绑旧设备 |
| `POST /v1/user/register` | 用户注册（限速） |
| `POST /v1/user/login` | 用户登录（限速） |
| `GET /v1/user/me` | 获取当前用户信息（需 JWT） |

### 管理接口（需 admin JWT）

| 接口 | 说明 |
|------|------|
| `POST /v1/admin/login` | 管理员登录 |
| `POST /v1/admin/licenses/generate` | 批量生成激活码 |
| `GET /v1/admin/orders` | 订单列表 |
| `GET /v1/admin/licenses` | 授权列表 |
| `GET /v1/admin/leases` | 授权激活记录 |
| `GET /v1/admin/leases/dau` | DAU 统计 |
| `POST /v1/admin/licenses/:id/freeze` | 冻结 License |
| `POST /v1/admin/licenses/:id/unfreeze` | 解冻 License |
| `POST /v1/admin/licenses/:id/unbind-device` | 解绑指定设备 |

## 快速开始

### 后端

```bash
cd pubflow-Pro-server-axum-starter
cp .env.example .env
# 编辑 .env 配置数据库连接等
cargo run -p app
```

### 前端

```bash
cd pubflow-Pro-Web
pnpm install
pnpm dev
```

### 构建客户端产物

```bash
cd pubflow-Pro-server-axum-starter
make build-artifacts  # 构建 Native 工具 + WASM 包
```

## 管理后台功能

- **总览**：订单统计、今日支付、激活状态、DAU 趋势图、时间筛选
- **订单**：筛选、搜索、分页、支付状态追踪
- **授权明细**：批量生成激活码、查看授权状态、调整设备限制、冻结/解冻/解绑
- **授权记录**：用户激活日志（IP、平台、时间、状态、operator、reason）
- **审计事件**：license_events 记录激活、迁移、解绑、后台操作

## 相关文档

- [`README-产品需求.md`](./README-产品需求.md)：产品需求总览与状态。
- [`README-授权方案.md`](./README-授权方案.md)：当前已落地的授权方案。
- [`README-部署说明.md`](./README-部署说明.md)：部署与构建说明。
- [`README-普通版与商业版差异.md`](./README-普通版与商业版差异.md)：pubflow 与 pubflow-Pro 的差异。
- [`pubflow-Pro/_doc/PubFlow Pro 安全-授权保护设计.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-授权保护设计.md)：完整威胁模型与架构设计。
- [`pubflow-Pro/_doc/PubFlow Pro 安全-加固清单.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-加固清单.md)：安全加固清单。
- [`pubflow-Pro/_doc/PubFlow Pro 安全-密钥轮换手册.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-密钥轮换手册.md)：密钥轮换手册。
- [`pubflow-Pro/_doc/PubFlow Pro 安全-测试计划.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-测试计划.md)：手工安全测试计划。
- [`pubflow-Pro/_doc/PubFlow Pro 安全=隐私数据保留说明.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全=隐私数据保留说明.md)：隐私数据保留说明。
