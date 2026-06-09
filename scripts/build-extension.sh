#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT_DIR/pubflow-Pro"
OUT_DIR="$ROOT_DIR/dist/extension"

echo "=== Building Extension (obfuscated) ==="
cd "$EXT_DIR"
pnpm install
pnpm build:protected

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -r "$EXT_DIR/.output/chrome-mv3" "$OUT_DIR/chrome-mv3"

cd "$OUT_DIR/chrome-mv3"
zip -r "$OUT_DIR/pubflow-extension.zip" .

echo "=== Extension built ==="
echo "  $OUT_DIR/chrome-mv3/     (unpacked)"
echo "  $OUT_DIR/pubflow-extension.zip"
