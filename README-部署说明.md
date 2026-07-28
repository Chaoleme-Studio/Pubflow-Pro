# PubFlow Pro 部署说明

本文只说明当前项目怎么区分开发/生产、怎么打包、怎么部署到京东云生产环境。授权协议和加密设计见 `README-授权方案.md`。

## 当前端口

| 位置 | 端口 | 用途 |
| --- | ---: | --- |
| 京东云生产机 | `5189` | Rust 后端服务 |
| 京东云生产机 | `5188` | Nginx，对外提供 Web 并反代 API |
| 京东云生产机 | `80/443` | 域名和 HTTPS 备案通过后统一切换，当前尚未启用 |

公网入口：

```text
http://117.72.147.216:5188/
```

API 公网入口：

```text
http://117.72.147.216:5189/v1/product/catalog
```

Nginx 配置逻辑是：

```text
浏览器 -> 117.72.147.216:5188 -> 京东云 Nginx
京东云 Nginx /           -> /home/wong/Desktop/Application/PubFlow/web
京东云 Nginx /v1/...       -> 127.0.0.1:5189/v1/...
京东云 Nginx /static/...  -> 127.0.0.1:5189/static/...
```

## 配置边界

### Web 后台

Web 后台不需要配置后端地址。前端代码请求的是同源相对路径 `/v1/...`，部署后由 Nginx 反代到本机后端，不会因域名启用 HTTPS 而产生混合内容请求。

所以 Web 后台只要重新构建并推送即可。

### 插件端

插件端请求哪个授权服务，是构建时写入插件包的。仓库根目录分别维护 `.env.development` 和 `.env.production`，构建脚本按环境读取 `PUBLIC_API_BASE_URL`。

```env
# .env.development
PUBLIC_API_BASE_URL=http://127.0.0.1:5189

# .env.production
PUBLIC_API_BASE_URL=http://117.72.147.216:5189
```

这个值是构建期写入插件包的。打完包以后再改 `.env` 不会影响已经生成的 ZIP/CRX，必须重新打包。

X 与 YouTube 使用和其他平台相同的浏览器页面自动填充方案，复用用户在 `x.com` 和 YouTube Studio 的现有登录状态。构建时不需要 OAuth Client ID、开发者 API Key 或平台 Client Secret，PubFlow 后端也不接收平台凭据和视频文件。

### 服务端

服务端当前仍使用项目已有的配置系统，生产进程监听京东云机的 `127.0.0.1:5189`。

当前远端后端启动目录：

```text
/home/wong/Desktop/Application/PubFlow/backend
```

当前远端前端目录：

```text
/home/wong/Desktop/Application/PubFlow/web
```

## 打包和部署

正式发布由当前 Mac 完成全部编译，Linux 服务器只接收产物并运行：

```bash
./scripts/build-all.sh
python3 -m venv .venv-deploy
.venv-deploy/bin/pip install -r scripts/requirements-deploy.txt
.venv-deploy/bin/python scripts/deploy-to-nucbox.py jd --no-build --configure-nginx
```

京东云是生产环境，`.env.production` 默认使用它的 PostgreSQL 本机映射端口
`25432`。NucBox 只作为测试机，`wan` / `lan` 部署通道会在运行时覆盖为
`5432`。数据库地址是运行时配置，不需要在 Linux 服务器重新编译二进制。

### 构建 Web 产物

```bash
ENV=production ./scripts/build-web.sh
```

Web 静态产物位于 `dist/web/html/`，将其同步到京东云 `/home/wong/Desktop/Application/PubFlow/web/`后，检查并重载 Nginx。首页 SSG 输出、`robots.txt` 、`sitemap.xml` 和静态 404 页都会包含在该目录中。

Nginx 配置模板为 [`deploy/nginx/pubflow-pro.conf`](./deploy/nginx/pubflow-pro.conf)；上线前执行：

```bash
nginx -t && systemctl reload nginx
```

### 构建生产插件

```bash
# 先确认根目录 .env.production 里的 PUBLIC_API_BASE_URL 是公网地址
./scripts/build-extension.sh
```

产物位置：

```text
dist/extension/chrome-mv3/
dist/extension/pubflow-extension.zip
```

## 常见判断

如果 `http://117.72.147.216:5188/` 没反应，先分别检查：

```bash
curl -I http://117.72.147.216:5188/
curl http://117.72.147.216:5189/v1/product/catalog
```

如果第一个正常、第二个失败，多半是后端或 Nginx 反代问题。

如果两个都失败，多半是 Nginx、机器防火墙或远端服务状态问题。

如果网页能打开但按钮报错，看浏览器控制台和 Network；Web 后台本身没有单独的 API 地址配置，所有请求都应该是同域 `/v1/...`。
