# PubFlow Web

官网、购买页、下载中心、卡密服务和管理后台，基于 Vue 3 + Vite + TypeScript 构建。

## 功能

- 业务驾驶舱：订单统计、今日支付、激活状态、趋势图表
- 订单管理：筛选、搜索、分页、支付状态追踪
- 授权管理：批量生成激活码、查看授权状态、激活/到期时间
- Selector 管理：上传加密 Selector 配置、版本管理
- 购买页面：用户选择套餐 → 支付 → 查询激活码

## 技术栈

- Vue 3 + TypeScript + Vite
- Vue Router + Vite SSG（首页收录，业务页 `noindex`）
- 无 UI 框架、无全局状态管理
- Lucide Vue 图标
- 复用 pubflow-Pro-server 的 API 接口

## 开发

```bash
pnpm install
pnpm dev        # 开发服务器
pnpm build      # 类型检查 + 生产构建
```

## API 接口

| 接口 | 说明 |
|------|------|
| `GET /v1/product/catalog` | 获取套餐和下载配置 |
| `POST /v1/purchase/orders` | 创建购买订单 |
| `GET /v1/purchase/orders/:order_no` | 查询订单状态和激活码 |
| `POST /v1/admin/login` | 管理员登录 |
| `POST /v1/admin/licenses/generate` | 批量生成激活码 |
| `GET /v1/admin/orders` | 订单列表 |
| `GET /v1/admin/licenses` | 授权列表 |
| `POST /v1/admin/selector/upload` | 上传 Selector |
| `GET /v1/selector/version` | 获取 Selector 版本 |

## 页面说明

- `/` - 首页（产品介绍）
- `/buy` - 购买页（选择套餐、支付、查询激活码）
- `/downloads` - 下载页（客户端下载）
- `/license` - 卡密自助服务
- `/admin` - 管理后台（需登录）

`pnpm build` 会生成各路由的静态 HTML、`robots.txt` 和 `sitemap.xml`。只有 `/` 会写入 sitemap，并设置为可收录。
