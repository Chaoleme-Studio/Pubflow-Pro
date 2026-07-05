#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT_DIR/pubflow-Pro"
OUT_DIR="$ROOT_DIR/dist/extension"
DOWNLOADS_DIR="$ROOT_DIR/downloads"

# 默认使用 development 环境；可通过 ENV=production 覆盖
ENV_NAME="${ENV:-development}"

# 加载根目录环境变量；子项目内部不再生成 .env
source "$ROOT_DIR/scripts/build-common.sh"
load_root_env "$ENV_NAME"

echo "=== Building Extension (obfuscated) ==="
cd "$EXT_DIR"

LICENSE_API_BASE_URL="${PUBFLOW_LICENSE_API_BASE_URL:-${PUBLIC_API_BASE_URL:-}}"

# 如果启用了混淆且使用远程授权地址，自动从 /v1/selector/version 拉取当前协议公钥
if [ -n "$LICENSE_API_BASE_URL" ]; then
  case "$LICENSE_API_BASE_URL" in
    http://localhost*|http://127.0.0.1*|https://localhost*|https://127.0.0.1*)
      : ;;
    *)
      if [ -z "${PUBFLOW_PROTOCOL_PUBLIC_KEY:-}" ]; then
        echo "[build-extension] Fetching protocol public key from $LICENSE_API_BASE_URL/v1/selector/version"
        FETCHED_KEY=''
        for attempt in 1 2 3; do
          echo "[build-extension] Attempt $attempt/3"
          FETCHED_KEY="$(curl -sS --max-time 15 "$LICENSE_API_BASE_URL/v1/selector/version" 2>/dev/null | sed -n 's/.*"protocol_public_key"[[:space:]]*:[[:space:]]*"\([0-9a-fA-F]*\)".*/\1/p' || true)"
          if [ -n "$FETCHED_KEY" ] && [ "${#FETCHED_KEY}" -eq 64 ]; then
            break
          fi
          if [ "$attempt" -lt 3 ]; then
            sleep 2
          fi
        done
        if [ -n "$FETCHED_KEY" ] && [ "${#FETCHED_KEY}" -eq 64 ]; then
          export PUBFLOW_PROTOCOL_PUBLIC_KEY="$FETCHED_KEY"
          echo "[build-extension] PUBFLOW_PROTOCOL_PUBLIC_KEY set from remote"
        else
          echo "[build-extension] ERROR: failed to fetch a valid 32-byte protocol public key after 3 attempts"
          echo "[build-extension] You can set it manually: PUBFLOW_PROTOCOL_PUBLIC_KEY=<key> ./scripts/build-extension.sh"
        fi
      fi
      ;;
  esac
fi

pnpm install
ENV="$ENV_NAME" pnpm build:protected

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -r "$EXT_DIR/.output/chrome-mv3" "$OUT_DIR/chrome-mv3"

cd "$OUT_DIR/chrome-mv3"
zip -r "$OUT_DIR/pubflow-extension.zip" .

# 同时复制 CRX 安装包，供下载中心备用；没有签名产物时只提供 ZIP。
if [ -f "$EXT_DIR/.output/chrome-mv3.crx" ]; then
  cp -f "$EXT_DIR/.output/chrome-mv3.crx" "$OUT_DIR/pubflow-extension.crx"
fi

mkdir -p "$DOWNLOADS_DIR"
cp -f "$OUT_DIR/pubflow-extension.zip" "$DOWNLOADS_DIR/pubflow-extension.zip"
if [ -f "$OUT_DIR/pubflow-extension.crx" ]; then
  cp -f "$OUT_DIR/pubflow-extension.crx" "$DOWNLOADS_DIR/pubflow-extension.crx"
fi

echo "=== Extension built ==="
echo "  $OUT_DIR/chrome-mv3/     (unpacked)"
echo "  $OUT_DIR/pubflow-extension.zip"
if [ -f "$OUT_DIR/pubflow-extension.crx" ]; then
  echo "  $OUT_DIR/pubflow-extension.crx"
fi
echo "  $DOWNLOADS_DIR/          (local download source)"
