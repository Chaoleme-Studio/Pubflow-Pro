#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist/wasm"
TARGET="web"

usage() {
  cat <<'USAGE'
Usage: scripts/build-wasm.sh [--target web|bundler|no-modules|nodejs] [--out-dir <dir>]

Builds the PubFlow WASM package for frontend JavaScript.

Examples:
  scripts/build-wasm.sh
  scripts/build-wasm.sh --target bundler --out-dir ../pubflow/src/wasm

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
  check_license_expired,
  generate_device_hash,
} from './pubflow_wasm.js';

await init();
```
README

echo "WASM package built:"
find "$OUT_DIR" -maxdepth 1 -type f -print
