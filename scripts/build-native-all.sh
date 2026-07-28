#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist/native"
ENV_NAME="${ENV:-development}"
SKIP_WEB=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out-dir)
      [ "$#" -ge 2 ] || { echo "--out-dir requires a value" >&2; exit 2; }
      OUT_DIR="$2"
      shift 2
      ;;
    --skip-web)
      SKIP_WEB=1
      shift
      ;;
    -h|--help)
      echo "Usage: scripts/build-native-all.sh [--out-dir <path>] [--skip-web]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "build-native-all.sh currently targets the macOS release workstation" >&2
  exit 1
fi

command -v cargo-zigbuild >/dev/null 2>&1 || {
  echo "Missing cargo-zigbuild. Install it with: cargo install cargo-zigbuild" >&2
  exit 1
}
command -v cargo-xwin >/dev/null 2>&1 || {
  echo "Missing cargo-xwin. Install it with: cargo install cargo-xwin" >&2
  exit 1
}

rustup target add \
  aarch64-apple-darwin \
  x86_64-apple-darwin \
  x86_64-unknown-linux-gnu \
  x86_64-pc-windows-msvc

if [ "$SKIP_WEB" -eq 0 ]; then
  ENV="$ENV_NAME" "$ROOT_DIR/scripts/build-web.sh"
fi

targets=(
  aarch64-apple-darwin
  x86_64-apple-darwin
  x86_64-unknown-linux-gnu
  x86_64-pc-windows-msvc
)

for target in "${targets[@]}"; do
  ENV="$ENV_NAME" "$ROOT_DIR/scripts/build-native.sh" \
    --skip-web \
    --target "$target" \
    --out-dir "$OUT_DIR"
done

echo "=== All PubFlow Native packages built ==="
for package in "$OUT_DIR"/pubflow-pro-native-*.zip; do
  [ -f "$package" ] && echo "  $package"
done
