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
│  2. 插件调用 POST /v1/lease/activate                             │
│  3. 服务端校验激活码 → 绑定插件安装标识 → 签发 JWT lease token      │
│  4. 插件自动加密存储 lease token                                  │
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
│    ├─→ POST /v1/selector/fetch（PFSP 自定义协议）                 │
│    │     └─→ 检查：lease 签名、安装标识、过期、吊销状态            │
│    │                                                            │
│    ├─→ 请求加密 Selector 数据                                    │
│    │     └─→ WASM 解密：AES-256-GCM(密钥 = SHA256(secret+激活码))│
│    │                                                            │
│    └─→ 使用解密后的 Selector 自动化发布                           │
│          └─→ 填充表单、上传视频、点击发布按钮                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 加密方案

| 数据 | 加密方式 | 存储位置 | 解密方 |
|------|---------|---------|-------|
| Selector 配置 | AES-256-GCM | PostgreSQL | WASM（客户端） |
| Lease Token | JWT (HS256) | 客户端加密存储 | 服务端验签 + 安装标识/状态校验 |
| 管理员密码 | Argon2 | 环境变量 | 服务端验证 |
| 订单查询令牌 | SHA-256 keyed hash | 客户端（URL 参数） | 服务端验证 |

### Selector 加密细节

```
密钥派生：SHA-256(server_secret + 用户激活码)
加密算法：AES-256-GCM
数据格式：nonce(12字节) + 密文 + tag(16字节)，Base64 编码
```

每个用户的激活码不同 → 解密密钥不同 → 一个用户密钥泄露不影响其他人。

### Lease Token

```
格式：JWT (HS256)
有效期：license 剩余 >60 天时为 365 天，否则为 30 天，以 license 到期时间为上限
自定义 Claims：
  - lease_id        租约唯一 ID
  - license_id      关联的 license ID
  - machine_hash    当前版本为插件安装标识，后续永久版可升级为 Native 设备码
  - lease_type      租约类型（subscription）
  - tier            许可等级（pro/enterprise）
  - features        功能列表（publish, batch, selector-updates 等）
  - valid_from      租约生效时间（Unix 时间戳）
  - valid_until     租约失效时间（Unix 时间戳）
  - min_extension_version  最低插件版本要求
  - policy_version  策略版本号
标准 Claims（由 JWT 库自动注入）：exp, iat
验证：
  - 客户端：仅持有 token，不把未验签 payload 作为授权依据
  - 服务端：验签 + 安装标识匹配 + 过期检查 + 吊销状态
```

更完整的 PFSP、自定义协议、WASM、Native 与授权边界说明见 [README-加密授权方案.md](./README-加密授权方案.md)。

部署、端口、Nginx 反代、插件生产打包配置见 [README-部署说明.md](./README-部署说明.md)。

## 项目结构

```
pubflow-Pro/
├── pubflow-Pro-server-axum-starter/    后端服务 (Rust/Axum)
│   ├── app/                            HTTP API、配置、中间件
│   ├── entity/                         SeaORM 实体
│   ├── migration/                      数据库迁移
│   ├── core/                           授权签名、加密、设备哈希
│   ├── wasm/                           浏览器插件 WASM 模块
│   ├── native/                         本地机器码工具
│   └── scripts/                        构建脚本
│
├── pubflow-Pro-Web/                    管理后台前端 (Vue 3)
│   ├── src/pages/AdminPage.vue         管理后台主页
│   ├── src/pages/PurchasePage.vue      购买页
│   └── src/api.ts                      API 接口定义
│
└── README.md                           本文件
```

## 核心 API

### 公开接口

| 接口 | 说明 |
|------|------|
| `GET /v1/product/catalog` | 获取产品套餐和下载配置 |
| `POST /v1/purchase/orders` | 创建购买订单 |
| `GET /v1/purchase/orders/:order_no?token=` | 查询订单状态和激活码（需 query token） |
| `POST /v1/lease/activate` | 激活（激活码 → lease token） |
| `POST /v1/lease/verify` | 验证 lease token |
| `POST /v1/lease/renew` | 续租 |
| `POST /v1/lease/deactivate` | 停用设备 |
| `GET /v1/selector/version` | 获取当前 Selector 版本信息 |
| `POST /v1/selector/fetch` | 获取加密的 Selector 配置数据 |
| `POST /v1/user/register` | 用户注册（限速 2req/s） |
| `POST /v1/user/login` | 用户登录（限速 2req/s） |
| `GET /v1/user/me` | 获取当前用户信息（需 JWT） |

### 管理接口（需 JWT）

| 接口 | 说明 |
|------|------|
| `POST /v1/admin/login` | 管理员登录 |
| `POST /v1/admin/licenses/generate` | 批量生成激活码 |
| `GET /v1/admin/orders` | 订单列表 |
| `GET /v1/admin/licenses` | 授权列表 |
| `GET /v1/admin/leases` | 授权激活记录 |
| `GET /v1/admin/leases/dau` | DAU 统计 |
| `POST /v1/admin/selector/upload` | 上传 Selector 配置 |

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
- **授权明细**：批量生成激活码、查看授权状态
- **授权记录**：用户激活日志（IP、平台、时间、状态）
- **Selector**：上传加密配置、版本管理
