# PubFlow Pro 需求清单 v1.0

> 文档位置：`/Users/wong/Code/VueLang/文章批量发送/pubflow-Pro/README-需求清单.md`  
> 日期：2026-06-26  
> 涉及项目：
> - `pubflow-Pro`（浏览器插件端）
> - `pubflow-Pro-server-axum-starter`（后端服务）
> - `pubflow-Pro-Web`（前端售卖/管理页）

---

## 需求总览

| 编号 | 需求名称 | 优先级 | 涉及端 | 状态 |
|---|---|---|---|---|
| R1 | 限时折扣 | P0 | 后端、前端-Web | 已完成 |
| R2 | 下载中心改造 | P0 | 后端、前端-Web | 已完成（不含后台上传文件） |
| R3 | 补发激活码 | P1 | 后端、前端-Web | 已完成（后台 + 用户自助） |
| R4 | 调整设备限制 | P1 | 后端、前端-Web | 已完成 |
| R5 | 插件版本检测与更新提示 | P1 | 插件端、后端 | 已完成 |
| R6 | 买断制授权改造（Native Helper + Ed25519 License） | P2 | 后端、插件端、Native Helper、WASM | 待开发 |

---

## R1. 限时折扣

### 目标

支持为月卡、年卡设置限时折扣，在指定时间区间内以折扣价销售，前端展示原价划线和折扣价。

### 验收标准

- [ ] 后台管理页可为每个计划配置：原价、折扣价、折扣开始时间、折扣结束时间、是否启用。
- [ ] 未配置折扣或不在折扣区间时，按原价销售。
- [ ] 折扣区间内，购买页展示原价划线 + 折扣价高亮 +「限时折扣」标签/倒计时。
- [ ] 订单摘要显示实际支付价格和节省金额。
- [ ] 创建订单时后端根据当前时间重新计算价格，不信任前端传价。
- [ ] 后端返回的商品目录接口返回当前生效价格。

### 涉及文件

- 后端：`app/src/modules/product/service.rs`、`app/src/modules/product/dto.rs`
- 后端：`entity/src/product_catalog.rs`、迁移文件
- 后端：`app/src/modules/purchase/service.rs`
- 前端：`pubflow-Pro-Web/src/pages/PurchasePage.vue`
- 前端：`pubflow-Pro-Web/src/pages/AdminPage.vue`
- 前端：`pubflow-Pro-Web/src/api.ts`

### 示例

月卡原价 ¥29.9，限时折扣价 ¥9.9；年卡原价 ¥199，限时折扣价 ¥66。

---

## R2. 下载中心改造

### 目标

解决当前下载中心链接失效、用户无法下载插件的问题。支持通过服务器托管或第三方平台分发。

### 验收标准

- [ ] 后台管理页可配置下载链接（支持 CRX 和 ZIP）。
- [ ] 下载链接支持两种模式：
  - 模式 A：服务器托管（`/static/downloads/` 直链）。
  - 模式 B：外部链接（GitHub/Gitee Release、CDN 等，无需认证）。
- [ ] 前端下载页从接口读取下载配置，展示下载卡片和按钮。
- [ ] 用户点击后直接下载或跳转外部链接。
- [ ] 后台可上传/替换下载文件（如果是服务器托管模式）。短期先使用外部链接或 `/downloads/` 静态文件配置。

### 涉及文件

- 后端：`app/src/modules/product/service.rs`、`app/src/modules/product/dto.rs`
- 后端：`entity/src/product_catalog.rs`、迁移文件
- 后端：静态文件服务配置
- 前端：`pubflow-Pro-Web/src/pages/DownloadPage.vue`
- 前端：`pubflow-Pro-Web/src/api.ts`

### 推荐方案

短期优先使用 **GitHub/Gitee Release + 外部直链**，零带宽成本，快速上线。后续用户量大了再切到服务器托管。

---

## R3. 补发激活码

### 目标

用户在激活码丢失、泄露、换机失败等场景下，后台管理员可为其补发新激活码，并可选择注销原激活码。
同时提供前台“卡密服务”页，用户可以自助查询、补发新卡密并注销旧卡密。

### 验收标准

- [ ] 后台 License 列表/详情页增加「补发激活码」按钮。
- [ ] 补发时弹窗填写原因，并选择是否注销原激活码。
- [ ] 前台增加「卡密服务」Tab，用户可凭旧激活码自助补发或注销。
- [ ] 补发后生成新 License，保留原套餐、有效期、设备限制策略。
- [ ] 如选择注销原激活码，自动吊销其关联的所有 lease。
- [ ] 补发记录通过 `license_id` 关联，不直接存储激活码字符串。
- [ ] 后台可查看某 License 的补发历史。

### 涉及文件

- 后端：`entity/src/license.rs`（新增补发记录表）
- 后端：迁移文件
- 后端：`app/src/modules/admin/service.rs`、`app/src/modules/admin/handler.rs`、`app/src/modules/admin/dto.rs`
- 前端：`pubflow-Pro-Web/src/pages/AdminPage.vue`
- 前端：`pubflow-Pro-Web/src/api.ts`

### 数据模型

新增 `license_replacements` 表：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `old_license_id` | 原 License ID |
| `new_license_id` | 新 License ID |
| `reason` | 补发原因 |
| `operator` | 操作人 |
| `revoked_old` | 是否注销原 License |
| `created_at` | 创建时间 |

---

## R4. 调整设备限制

### 目标

后台支持为单个 License 动态调整最大设备数和迁移次数上限，处理用户换机、重装等特殊情况。

### 验收标准

- [ ] 后台 License 列表/详情页增加「调整限制」按钮。
- [ ] 可修改 `max_devices`（最大设备数）和 `device_migration_limit`（迁移次数上限）。
- [ ] 修改时记录到 `license_events`，原因可填写。
- [ ] 界面展示当前已用设备数和已迁移次数。
- [ ] 调整后可立即生效，用户再次激活时按新限制判断。

### 涉及文件

- 后端：`app/src/modules/admin/service.rs`、`app/src/modules/admin/handler.rs`、`app/src/modules/admin/dto.rs`
- 前端：`pubflow-Pro-Web/src/pages/AdminPage.vue`
- 前端：`pubflow-Pro-Web/src/api.ts`

---

## R5. 插件版本检测与更新提示

### 目标

插件启动时检测是否有新版本，提示用户下载更新。

### 验收标准

- [ ] 后端提供版本信息接口（JSON 或 `update.xml`）。
- [ ] 插件后台启动时请求版本信息，对比当前 `manifest.version`。
- [ ] 发现新版本时弹出通知，点击打开下载页或下载最新 CRX。
- [ ] 更新检测失败不影响当前使用。
- [ ] 文档中说明：已解压加载不支持自动更新；CRX 安装方式可配置 `update_url`。

### 涉及文件

- 后端：新增版本/更新接口
- 插件：`pubflow/src/entrypoints/background.ts`
- 插件：`pubflow/wxt.config.ts`（manifest 版本和 `update_url`）

### 说明

以当前混淆和权限强度，**不建议也不指望上架 Chrome Web Store**。继续通过官网/Release 分发。

---

## R6. 买断制授权改造（Native Helper + Ed25519 License）

### 目标

支持买断制套餐，用户一次性付费后，即使服务器关机也能长期使用，且换浏览器后仍能使用。

### 验收标准

- [ ] 后端支持 `plan: "perpetual"`。
- [ ] 后端激活接口签发 Ed25519 签名 License，绑定设备公钥。
- [ ] Native Helper 生成设备 Ed25519 密钥对，私钥存入系统安全存储。
- [ ] Native Helper 提供设备签名、公钥获取、License 验证接口。
- [ ] 插件端通过 Chrome Native Messaging 调用 Native Helper。
- [ ] 插件端 WASM 离线验证 License 签名。
- [ ] 未安装 Native Helper 时，插件引导用户安装。
- [ ] 后台管理页支持生成买断制激活码、查看设备公钥、解绑设备、吊销 License。

### 涉及文件

- 后端：`core/src/license.rs`
- 后端：`app/src/modules/lease/service.rs`、`app/src/modules/lease/handler.rs`
- 后端：`app/src/modules/admin/service.rs`
- 后端：`entity/src/license.rs`、迁移文件
- Native Helper：`pubflow-Pro-server-axum-starter/native/src/handler.rs`、`native/src/main.rs`
- WASM：`pubflow-Pro-server-axum-starter/wasm/src/lib.rs`
- 插件：`pubflow/src/licensing/*`
- 前端：`pubflow-Pro-Web/src/pages/AdminPage.vue`

### 说明

这是长期方案，优先级低于前面的运营功能。完整设计见 `README-加密授权方案2.0.md`。

---

## 实施建议

### 第一阶段（2-3 周）

1. **R1 限时折扣**：直接增收，开发量适中。
2. **R2 下载中心改造**：解决用户无法安装的问题，必须做。

### 第二阶段（1-2 周）

3. **R3 补发激活码**：客服刚需。
4. **R4 调整设备限制**：减少客服介入成本。

### 第三阶段（1-2 周）

5. **R5 插件版本检测**：提升用户体验。

### 第四阶段（2-3 个月）

6. **R6 买断制授权改造**：为商业化长期铺路。

---

## 备注

- 所有前端改动集中在 `pubflow-Pro-Web`。
- 所有后端改动集中在 `pubflow-Pro-server-axum-starter`。
- 插件端改动集中在 `pubflow-Pro`。
- 详细授权安全方案参考：`README-加密授权方案2.0.md`。
