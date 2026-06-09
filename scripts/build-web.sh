#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/pubflow-Pro-Web"
OUT_DIR="$ROOT_DIR/dist/web"

echo "=== Building Web Frontend ==="
cd "$WEB_DIR"
pnpm install
pnpm build

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -r "$WEB_DIR/dist" "$OUT_DIR/html"

echo "=== Web frontend built ==="
echo "  $OUT_DIR/html/"
