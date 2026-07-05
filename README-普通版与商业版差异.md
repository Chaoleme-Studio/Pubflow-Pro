# PubFlow 普通版与商业版差异

> 记录日期：2026-07-04  
> 普通版目录：`/Users/wong/Code/VueLang/文章批量发送/pubflow`  
> 商业版插件目录：`/Users/wong/Code/VueLang/文章批量发送/pubflow-Pro/pubflow-Pro`

## 总体原则

- 普通版保持纯浏览器插件逻辑，平台 Selector 和发布流程全部放在本地代码中。
- 商业版以普通版插件为基础，只增加授权校验、官网购买、后台管理和服务端统计。
- 平台发布实现不依赖服务端下发 CSS Selector，selector 全部内置在插件本地。

## 插件端差异

- 商业版新增 `src/licensing/` 授权模块，使用 PFAP v1 激活协议与服务端交互。
- 商业版在设置页底部新增「授权保护」，激活后显示授权有效和到期时间。
- 商业版在**点击「开始发布」时**做授权/permit 校验，校验通过后再打开各平台页面。
- `OPEN_PLATFORM` 和 `CONTINUE_FILL` 当前不做授权校验，优先保证一轮发布过程顺滑；后续如风险升高可恢复为低频缓存校验（代码中已预留 TODO）。
- 商业版激活码、安装实例 ID、lease token 存在插件加密存储中；到期时间和授权状态可存在普通浏览器 storage 中用于展示。
- 商业版 footer 链接通过 `PUBFLOW_OFFICIAL_SITE_URL` 指向官网；普通版 footer 可继续指向 GitHub。
- 商业版新增启动版本检测：后台启动时请求 `/v1/product/extension-update`，发现新版本通过浏览器通知提示下载。

## 授权与设备策略

- 当前订阅版使用浏览器扩展安装实例 ID：`client_install_id`。
- 这不是硬件机器码，因此同一台电脑换浏览器、重装插件或清理插件 storage 都会变成新的安装实例。
- 标准版授权码默认只允许 1 个 active 安装实例（`max_devices = 1`）。
- 商业版服务端使用浏览器实例级 **ECDSA P-256 设备密钥**做设备证明：
  - 私钥 `extractable=false`，存储在 IndexedDB。
  - 激活后首次 `/verify` 绑定设备公钥。
  - 后续 `verify/renew/permit` 必须带 device proof。
- 迁移额度按订阅时长折算：每 30 天 3 次，月卡 3 次、年卡 36 次。
- 用户可通过授权中心自助解绑旧设备，每日上限 10 次，同样消耗迁移额度。
- 超过迁移额度后需要人工处理或后台调整。
- 后续如果要做到真正「同一电脑跨浏览器识别」，需要 Native Helper 或账号体系，订阅版当前不引入。

## 服务端与官网差异

- 商业版包含 Rust/Axum 后端，负责订单、激活码、lease 签发、授权验证、permit 签发、迁移记录和管理后台 API。
- 官网购买页通过 `/v1/product/catalog` 加载套餐，通过 `/v1/purchase/orders` 创建订单。
- 后端创建订单时重新读取商品目录并计算当前生效价，不信任前端传价。
- 后台「商品配置」可维护月卡/年卡原价、限时折扣、折扣时间窗口、下载链接。
- 下载中心从 `/v1/product/catalog` 读取 CRX/ZIP/外部链接配置，接口失败时才使用本地备用链接。
- 管理后台可以查看订单、激活码、授权事件、DAU。
- 管理后台支持补发激活码、选择是否注销旧码并吊销旧 lease。
- 管理后台支持调整单个 License 的最大安装实例数和迁移次数上限，并写入授权事件。
- 管理后台支持冻结/解冻 License、解绑指定设备，操作记录包含 operator、IP、reason、target id。
- 授权事件记录激活、校验、续租、permit、迁移、解绑、风控标记和后台操作，作为审计依据。

## Selector 策略

- 普通版和商业版插件都使用本地 Selector（`src/platforms/*/selectors.ts`）。
- 服务端 Selector 加密下发代码保留，但**标记为暂时废弃/未来预留**，当前发布主链路不使用。
- 后续平台页面变更时，优先修改插件本地 `src/platforms/*` 代码并发新版插件。

## 构建配置差异

- 商业版插件新增：
  - `PUBFLOW_LICENSE_API_BASE_URL`：授权服务地址。
  - `PUBFLOW_OFFICIAL_SITE_URL`：插件 footer 跳转官网地址。
  - `PUBFLOW_PROTOCOL_PUBLIC_KEY`：PFAP/PFSP 协议公钥，构建时注入。
- 商业版官网新增：
  - `VITE_PUBFLOW_API_BASE_URL`：官网请求后端的 API base；留空时使用同源 `/v1`。
- 商业版可启用 `OBFUSCATE=1` 对扩展 runtime chunk 做混淆，但这只是提高破解成本，不作为授权根基。
