# PubFlow Pro 部署说明

本文只说明当前项目怎么区分开发/生产、怎么打包、怎么推到 NucBox。授权协议和加密设计见 `README-授权方案.md`。

## 当前端口

| 位置 | 端口 | 用途 |
| --- | ---: | --- |
| NucBox | `3001` | Rust 后端服务 |
| NucBox | `8099` | Nginx，对外提供 Web 后台并反代 API |
| 腾讯云 | `30009` | NPS 穿透到 NucBox `8099` |
| 腾讯云 | `29903` | NPS 穿透到 NucBox SSH `22` |
| NucBox | `80` | 机器上已有服务，当前 PubFlow 不占用 |

公网入口：

```text
http://124.222.232.50:30009/
```

API 也走同一个入口：

```text
http://124.222.232.50:30009/v1/product/catalog
```

Nginx 配置逻辑是：

```text
浏览器 -> 124.222.232.50:30009 -> NucBox:8099
NucBox:8099 /          -> /home/wong/Desktop/Application/PubFlow/frontend
NucBox:8099 /v1/...    -> 127.0.0.1:3001/v1/...
NucBox:8099 /static/... -> 127.0.0.1:3001/static/...
```

## 配置边界

### Web 后台

Web 后台不需要配置后端地址。前端代码请求的是相对路径 `/v1/...`，部署后由 Nginx 反代到本机后端。

所以 Web 后台只要重新构建并推送即可。

### 插件端

插件端请求哪个授权服务，是构建时写入插件包的。目前使用最简单的方案：只保留一套 `.env`，你在打包前手动切换 `PUBFLOW_LICENSE_API_BASE_URL`。

```env
# 本地调试
PUBFLOW_LICENSE_API_BASE_URL=http://127.0.0.1:3001

# 生产打包
PUBFLOW_LICENSE_API_BASE_URL=http://124.222.232.50:30009
```

这个值是构建期写入插件包的。打完包以后再改 `.env` 不会影响已经生成的 ZIP/CRX，必须重新打包。

### 服务端

服务端当前仍使用项目已有的配置系统。部署脚本会把本地构建好的 Linux 后端程序和 `config/` 一起推到 NucBox。

当前远端后端启动目录：

```text
/home/wong/Desktop/Application/PubFlow/backend
```

当前远端前端目录：

```text
/home/wong/Desktop/Application/PubFlow/frontend
```

## 打包和部署

完整构建并部署 Web 后台 + 后端：

```bash
python3 scripts/deploy-to-nucbox.py wan --configure-nginx
```

只部署 Web 后台：

```bash
python3 scripts/deploy-to-nucbox.py wan --web-only --configure-nginx
```

只部署后端：

```bash
python3 scripts/deploy-to-nucbox.py wan --backend-only --configure-nginx
```

只重启远端后端：

```bash
python3 scripts/deploy-to-nucbox.py wan --restart --configure-nginx --no-build
```

打生产插件 ZIP：

```bash
# 先确认 pubflow-Pro/.env 里的 PUBFLOW_LICENSE_API_BASE_URL 是公网地址
./scripts/build-extension.sh
```

产物位置：

```text
dist/extension/chrome-mv3/
dist/extension/pubflow-extension.zip
```

## 常见判断

如果 `http://124.222.232.50:30009/` 没反应，先分别检查：

```bash
curl -I http://124.222.232.50:30009/
curl http://124.222.232.50:30009/v1/product/catalog
```

如果第一个正常、第二个失败，多半是后端或 Nginx 反代问题。

如果两个都失败，多半是 NPS、Nginx、机器防火墙或远端服务状态问题。

如果网页能打开但按钮报错，看浏览器控制台和 Network；Web 后台本身没有单独的 API 地址配置，所有请求都应该是同域 `/v1/...`。
