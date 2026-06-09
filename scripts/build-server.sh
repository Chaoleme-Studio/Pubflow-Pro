#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/pubflow-Pro-server-axum-starter"
OUT_DIR="$ROOT_DIR/dist/server"

echo "=== Building Server Artifacts ==="
cd "$SERVER_DIR"

# Build WASM (for extension)
./scripts/build-wasm.sh --out-dir "$OUT_DIR/wasm"

# Build Native helper
./scripts/build-native.sh --out-dir "$OUT_DIR/native"

echo "=== Server artifacts built ==="
echo "  $OUT_DIR/wasm/     (WASM package)"
echo "  $OUT_DIR/native/   (Native helper)"
