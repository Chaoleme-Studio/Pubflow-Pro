#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT_DIR/pubflow-Pro"
OUT_DIR="$ROOT_DIR/dist/extension"
DOWNLOADS_DIR="$ROOT_DIR/downloads"

echo "=== Building Extension (obfuscated) ==="
cd "$EXT_DIR"
pnpm install
pnpm build:protected

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
