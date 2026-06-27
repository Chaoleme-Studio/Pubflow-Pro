#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/pubflow-Pro-server-axum-starter"
OUT_DIR="$ROOT_DIR/dist/server"
BIN_NAME="pubflow-server"

echo "=== Building Server Artifacts ==="
cd "$SERVER_DIR"

echo "Building backend binary..."
cargo build -p app --release

rm -rf "$OUT_DIR/bin" "$OUT_DIR/config"
mkdir -p "$OUT_DIR/bin" "$OUT_DIR/config"

cp "$SERVER_DIR/target/release/app" "$OUT_DIR/bin/$BIN_NAME"
chmod +x "$OUT_DIR/bin/$BIN_NAME"
cp -r "$SERVER_DIR/config/." "$OUT_DIR/config/"
cp "$SERVER_DIR/.env.example" "$OUT_DIR/.env.example"

# Build WASM (for extension)
./scripts/build-wasm.sh --out-dir "$OUT_DIR/wasm"

if [[ "${BUILD_NATIVE:-0}" == "1" ]]; then
  ./scripts/build-native.sh --out-dir "$OUT_DIR/native"
fi

echo "=== Server artifacts built ==="
echo "  $OUT_DIR/bin/$BIN_NAME"
echo "  $OUT_DIR/config/"
echo "  $OUT_DIR/.env.example"
echo "  $OUT_DIR/wasm/     (WASM package)"
if [[ "${BUILD_NATIVE:-0}" == "1" ]]; then
  echo "  $OUT_DIR/native/   (Native helper)"
fi
