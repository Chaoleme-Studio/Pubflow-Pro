# PubFlow Server (Axum)

PubFlow 后端服务，基于 Axum + SeaORM + PostgreSQL。提供授权、订单、Selector 加密存储、Lease 在线验证等 API。

## Workspace 结构

```text
app/        HTTP API、配置、中间件、业务模块
entity/     SeaORM 实体（license, device, lease, order, selector）
migration/  数据库迁移
core/       授权签名、设备哈希、Selector 加解密（纯逻辑，无 IO）
native/     本地机器码生成工具 + Chrome Native Messaging 宿主
wasm/       浏览器插件调用的 WASM 包
scripts/    构建脚本
```

## 常用命令

```bash
cargo run -p app                # 启动服务
cargo test --workspace          # 运行测试
cargo clippy --workspace --all-targets  # 代码检查
```

## 环境变量

复制 `.env.example` 到 `.env`，关键配置：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串 |
| `ADMIN_USERNAME` | 管理员账号 |
| `ADMIN_PASSWORD` | 管理员密码（自动生成 Argon2 哈希） |
| `ADMIN_PASSWORD_HASH` | 管理员密码哈希（优先级高于明文密码） |
| `LICENSE_SIGNING_SEED_HEX` | Ed25519 签名密钥（64 位 hex） |
| `SELECTOR_SECRET` | Selector 加密密钥 |
| `JWT_SECRET` | JWT 签名密钥 |

## 核心 API

### 公开接口

| 接口 | 说明 |
|------|------|
| `GET /v1/product/catalog` | 套餐和下载配置 |
| `POST /v1/purchase/orders` | 创建订单 |
| `GET /v1/purchase/orders/:order_no` | 查询订单状态和激活码 |
| `POST /v1/purchase/notify/wechat` | 微信支付回调 |
| `POST /v1/purchase/notify/alipay` | 支付宝回调 |

### 授权 Lease 接口

| 接口 | 说明 |
|------|------|
| `POST /v1/lease/activate` | 激活（激活码 → lease token） |
| `POST /v1/lease/verify` | 验证 lease token 有效性 |
| `POST /v1/lease/renew` | 续租 |
| `POST /v1/lease/deactivate` | 停用设备 |

### 管理接口（需 JWT）

| 接口 | 说明 |
|------|------|
| `POST /v1/admin/login` | 管理员登录 |
| `POST /v1/admin/licenses/generate` | 批量生成激活码 |
| `GET /v1/admin/orders` | 订单列表 |
| `GET /v1/admin/licenses` | 授权列表 |
| `POST /v1/admin/selector/upload` | 上传 Selector |
| `POST /v1/payment/confirm` | 手动确认支付 |

## 加密方案

### Selector 加密

- 算法：AES-256-GCM
- 密钥：`HKDF-SHA256(server_secret, salt=license_code, info=pubflow-selector-aes-256-gcm-v2)`
- 格式：`nonce(12B) || ciphertext || tag(16B)`，Base64 编码
- 存储：PostgreSQL `selectors` 表

### License 签名

- 算法：Ed25519
- 内容：License JSON（activation_code, tier, expires_at）
- 验证：WASM 模块内置公钥，离线可验

### Lease Token

- 格式：JWT（HS256）
- 有效期：30 天
- Claims：lease_id, license_id, device_id, tier, features, exp
- 验证：服务端校验签名 + 设备匹配 + 过期检查

## 构建客户端产物

```bash
make build-native   # 构建 Native 机器码工具
make build-wasm     # 构建 WASM 包
make build-artifacts  # 一次性构建全部
```

WASM 产物用于浏览器插件，提供：
- `verify_license()` - License 签名验证
- `decrypt_selectors()` - Selector 数据解密
- `pfsp_build_selector_request()` - 构建 PFSP selector 请求
- `pfsp_decode_selector_response()` - 解码 PFSP selector 响应
- `generate_device_hash()` - 设备哈希生成

## 数据库

```bash
sea-orm-cli migrate up
sea-orm-cli migrate down
sea-orm-cli generate entity -o entity/src
```
