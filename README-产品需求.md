# PubFlow Pro 产品需求文档

> 版本：v1.1  
> 日期：2026-07-04  
> 适用项目：
> - `pubflow-Pro`（浏览器插件端）
> - `pubflow-Pro-server-axum-starter`（后端服务）
> - `pubflow-Pro-Web`（前端售卖/管理页）

---

## 1. 文档说明

### 1.1 背景

PubFlow Pro 是一款面向内容创作者的浏览器扩展，支持多平台批量发布图文、视频和长文章。当前已完成基础订阅授权（月卡/年卡）、后台管理、订单支付、设备限制、自助解绑等能力。

### 1.2 目标

本文档明确产品功能需求与当前状态，按优先级分阶段推进。

### 1.3 范围

- 前端售卖与管理页（Vue 3）
- 后端服务（Rust Axum + SeaORM + PostgreSQL）
- 浏览器插件端（Chrome MV3 + WXT + Vue 3 + TypeScript）
- Native Helper 本地助手（Rust 二进制，Chrome Native Messaging），仅买断制方案使用

---

## 2. 需求总览

| 编号 | 需求名称 | 优先级 | 涉及端 | 状态 |
|---|---|---|---|---|
| R1 | 限时折扣 | P0 | 后端、前端-Web | 已完成 |
| R2 | 下载中心改造 | P0 | 后端、前端-Web | 已完成（外部链接模式） |
| R3 | 补发激活码 | P1 | 后端、前端-Web | 已完成（后台 + 用户自助） |
| R4 | 调整设备限制 | P1 | 后端、前端-Web | 已完成 |
| R5 | 插件版本检测与更新提示 | P1 | 插件端、后端 | 已完成 |
| R6 | 设备密钥与发布 permit | P1 | 后端、插件端 | 已完成 |
| R7 | 买断制授权改造（Native Helper + Ed25519 License） | P2 | 后端、插件端、Native Helper、WASM | 待开发 |

---

## 3. 已完成需求摘要

### R1. 限时折扣

- `product_catalog` 支持原价、折扣价、折扣时间窗口、启用开关。
- `/v1/product/catalog` 返回当前生效价格。
- 创建订单时后端按当前时间重新计算价格，不信任前端传价。
- 购买页展示原价划线、折扣价高亮、限时折扣标签/倒计时。

### R2. 下载中心改造

- 后台可配置 CRX/ZIP 下载链接，支持外部直链（GitHub/Gitee Release、CDN）。
- 前端下载页从接口读取下载配置，点击后直接下载或跳转外部链接。
- 短期使用外部链接模式，零带宽成本。

### R3. 补发激活码

- 后台支持补发新激活码，可选择是否注销原激活码。
- 前台「卡密服务」页支持用户自助查询、补发、注销。
- 补发记录通过 `license_replacements` 表关联原/新 License。

### R4. 调整设备限制

- 后台 License 详情页支持调整 `max_devices` 和 `device_migration_limit`。
- 修改时写入 `license_events` 审计日志。

### R5. 插件版本检测与更新提示

- 后端提供版本信息接口。
- 插件启动时检测新版本，弹出通知引导下载。
- 更新检测失败不影响当前使用。

### R6. 设备密钥与发布 permit

- 订阅版使用浏览器实例级 **ECDSA P-256 设备密钥**，私钥不可导出。
- 短 lease 最长 30 天，到期需联网续租。
- 点击「开始发布」时申请一次性 `start_distribution` permit，30 分钟 TTL，避免发布过程中的正常编辑和平台切换被过早打断。
- 平台 selector 全部内置在插件本地，远程 selector 下发暂时废弃。
- 授权/permit 校验仅在 `START_DISTRIBUTION` 入口执行，`OPEN_PLATFORM` 和 `CONTINUE_FILL` 暂不校验。

---

## 4. 待开发需求

### R7. 买断制授权改造（Native Helper + Ed25519 License）

#### 目标

支持买断制套餐，用户一次性付费后，即使服务器关机也能长期使用，且换浏览器后仍能使用。

#### 验收标准

- [ ] 后端支持 `plan: "perpetual"`。
- [ ] 后端激活接口签发 Ed25519 签名 License，绑定设备公钥。
- [ ] Native Helper 生成设备 Ed25519 密钥对，私钥存入系统安全存储。
- [ ] Native Helper 提供设备签名、公钥获取、License 验证接口。
- [ ] 插件端通过 Chrome Native Messaging 调用 Native Helper。
- [ ] 插件端 WASM 离线验证 License 签名。
- [ ] 未安装 Native Helper 时，插件引导用户安装。
- [ ] 后台管理页支持生成买断制激活码、查看设备公钥、解绑设备、吊销 License。

#### 涉及文件

- 后端：`core/src/license.rs`
- 后端：`app/src/modules/lease/service.rs`、`app/src/modules/lease/handler.rs`
- 后端：`app/src/modules/admin/service.rs`
- 后端：`entity/src/license.rs`、迁移文件
- Native Helper：`pubflow-Pro-server-axum-starter/native/src/handler.rs`、`native/src/main.rs`
- WASM：`pubflow-Pro-server-axum-starter/wasm/src/lib.rs`
- 插件：`pubflow-Pro/src/licensing/*`
- 前端：`pubflow-Pro-Web/src/pages/AdminPage.vue`

#### 说明

这是长期方案，优先级低于前面的运营功能。详细设计参考：

- [`pubflow-Pro/_doc/PubFlow Pro 安全-授权保护设计.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-授权保护设计.md)
- [`README-授权方案.md`](./README-授权方案.md)

---

## 5. 实施建议

### 第一阶段（已完成）

1. R1 限时折扣
2. R2 下载中心改造

### 第二阶段（已完成）

3. R3 补发激活码
4. R4 调整设备限制
5. R5 插件版本检测
6. R6 设备密钥与发布 permit

### 第三阶段（P2，按需启动）

7. R7 买断制授权改造

---

## 6. 相关文档

- [`README-授权方案.md`](./README-授权方案.md)：当前已落地的订阅版授权方案。
- [`pubflow-Pro/_doc/PubFlow Pro 安全-授权保护设计.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-授权保护设计.md)：完整威胁模型与安全架构设计。
- [`pubflow-Pro/_doc/PubFlow Pro 安全-加固清单.md`](./pubflow-Pro/_doc/PubFlow%20Pro%20安全-加固清单.md)：已落地的安全加固清单。
