#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/pubflow-Pro-Web"
OUT_DIR="$ROOT_DIR/dist/web"

# 默认使用 development 环境；可通过 ENV=production 覆盖
ENV_NAME="${ENV:-development}"

# 加载根目录环境变量，Vite 会自动读取当前 shell 中的 VITE_* 变量
source "$ROOT_DIR/scripts/build-common.sh"
load_root_env "$ENV_NAME"

echo "=== Building Web Frontend ==="
cd "$WEB_DIR"
pnpm install
ENV="$ENV_NAME" pnpm build --mode "$ENV_NAME"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -r "$WEB_DIR/dist" "$OUT_DIR/html"

echo "=== Web frontend built ==="
echo "  $OUT_DIR/html/"
