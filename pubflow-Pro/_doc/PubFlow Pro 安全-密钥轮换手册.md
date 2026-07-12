# PubFlow Pro Key Rotation Runbook

> 目标：订阅版支持 JWT 授权链路平滑轮换，并为 Selector/PFAP/PFSP 协议公钥提供签名信任链。

## JWT Key Rotation

JWT 覆盖后台登录、lease token、发布 permit。服务端支持：

- 当前签名密钥：`JWT_SECRET`
- 当前密钥版本：`JWT_KEY_VERSION`
- 旧密钥验证列表：`JWT_PREVIOUS_SECRETS`

`JWT_PREVIOUS_SECRETS` 格式：

```env
JWT_PREVIOUS_SECRETS=1:old-secret-at-least-32-characters,2:older-secret-at-least-32-characters
```

新签发 token 会：

- 在 JWT header 写入 `kid=<JWT_KEY_VERSION>`。
- lease/permit claims 写入 `key_version=<JWT_KEY_VERSION>`。

验签时：

- 如果 token header 有 `kid`，优先用对应版本的 key 验签。
- 如果没有 `kid`，按当前 key 和旧 key 列表依次尝试，兼容历史 token。

## 推荐轮换流程

1. 准备新密钥，设置：
   - `JWT_SECRET=<new-secret>`
   - `JWT_KEY_VERSION=<new-version>`
   - `JWT_PREVIOUS_SECRETS=<old-version>:<old-secret>`
2. 部署服务端。
3. 保持旧 key 至少一个 lease 周期，当前订阅 lease 上限为 31 天。
4. 超过 grace period 后，从 `JWT_PREVIOUS_SECRETS` 移除旧 key。
5. 再次部署，旧 token 将自然失效。

## Selector/PFAP/PFSP Protocol Key Trust Chain

协议加密公钥是 X25519，用于 PFAP/PFSP 密钥协商；它本身不做签名。服务端通过一把单独的 P-256 元数据签名私钥，为 `/v1/selector/version` 返回的协议公钥签名。扩展可内置对应 P-256 SPKI 公钥作为信任根。

服务端配置：

```env
SELECTOR_PROTOCOL_PRIVATE_KEY=<x25519-private-key-hex>
SELECTOR_PROTOCOL_KEY_VERSION=1
SELECTOR_PROTOCOL_SIGNING_PRIVATE_KEY=<p256-signing-private-key-hex>
```

扩展构建配置：

```env
PUBFLOW_PROTOCOL_PUBLIC_KEY=<current-x25519-public-key-hex>
PUBFLOW_PROTOCOL_TRUST_ROOT_P256_SPKI=<p256-spki-public-key-base64url>
```

轮换流程：

1. 生成新的 `SELECTOR_PROTOCOL_PRIVATE_KEY`，计算新的 X25519 public key。
2. 增加 `SELECTOR_PROTOCOL_KEY_VERSION`。
3. 保持 `SELECTOR_PROTOCOL_SIGNING_PRIVATE_KEY` 不变，由它签发新 public key metadata。
4. 部署服务端。
5. 新版扩展若发现 `/v1/selector/version` 的协议公钥不同于内置 pin，会用 `PUBFLOW_PROTOCOL_TRUST_ROOT_P256_SPKI` 验签；验签通过才接受。
6. 等旧扩展自然升级后，再把 `PUBFLOW_PROTOCOL_PUBLIC_KEY` 更新为新 key，形成新的直接 pin。

注意：如果扩展未内置 `PUBFLOW_PROTOCOL_TRUST_ROOT_P256_SPKI`，仍只接受 `PUBFLOW_PROTOCOL_PUBLIC_KEY` 精确匹配，不会盲信远程新公钥。
