#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist/wasm"
EXTENSION_OUT_DIR="$ROOT_DIR/../pubflow-Pro/public/wasm"
EXTENSION_SOURCE_DIR="$ROOT_DIR/../pubflow-Pro/src/licensing/wasm"
TARGET="web"

usage() {
  cat <<'USAGE'
Usage: scripts/build-wasm.sh [--target web|bundler|no-modules|nodejs] [--out-dir <dir>]

Builds the PubFlow WASM package for frontend JavaScript.

Examples:
  scripts/build-wasm.sh
  scripts/build-wasm.sh --target bundler --out-dir ../pubflow/src/wasm
  scripts/build-wasm.sh --extension-out-dir ../pubflow-Pro/public/wasm
  scripts/build-wasm.sh --extension-source-dir ../pubflow-Pro/src/licensing/wasm

Output:
  dist/wasm/pubflow_wasm.js
  dist/wasm/pubflow_wasm_bg.wasm
  dist/wasm/pubflow_wasm.d.ts
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:?missing wasm-pack target}"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="${2:?missing output directory}"
      shift 2
      ;;
    --extension-out-dir)
      EXTENSION_OUT_DIR="${2:?missing extension wasm output directory}"
      shift 2
      ;;
    --extension-source-dir)
      EXTENSION_SOURCE_DIR="${2:?missing extension source wasm output directory}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack is required. Install it with:" >&2
  echo "  cargo install wasm-pack" >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

wasm-pack build "$ROOT_DIR/wasm" \
  --target "$TARGET" \
  --release \
  --out-dir "$OUT_DIR"

cat > "$OUT_DIR/README.md" <<'README'
# PubFlow WASM

Frontend usage:

```ts
import init, {
  verify_license,
  decrypt_selectors,
  pfsp_build_selector_request,
  pfsp_decode_selector_response,
  check_license_expired,
  generate_device_hash,
} from './pubflow_wasm.js';

await init();
```
README

echo "WASM package built:"
find "$OUT_DIR" -maxdepth 1 -type f -print

if [[ -n "$EXTENSION_OUT_DIR" ]]; then
  rm -rf "$EXTENSION_OUT_DIR"
  mkdir -p "$EXTENSION_OUT_DIR"
  cp "$OUT_DIR"/pubflow_wasm.js \
     "$OUT_DIR"/pubflow_wasm_bg.wasm \
     "$EXTENSION_OUT_DIR"/
  echo "WASM package copied to extension:"
  find "$EXTENSION_OUT_DIR" -maxdepth 1 -type f -print
fi

if [[ -n "$EXTENSION_SOURCE_DIR" ]]; then
  rm -rf "$EXTENSION_SOURCE_DIR"
  mkdir -p "$EXTENSION_SOURCE_DIR"
  cp "$OUT_DIR"/pubflow_wasm.js \
     "$OUT_DIR"/pubflow_wasm_bg.wasm \
     "$OUT_DIR"/pubflow_wasm.d.ts \
     "$OUT_DIR"/pubflow_wasm_bg.wasm.d.ts \
     "$EXTENSION_SOURCE_DIR"/
  echo "WASM package copied to extension source:"
  find "$EXTENSION_SOURCE_DIR" -maxdepth 1 -type f -print
fi
