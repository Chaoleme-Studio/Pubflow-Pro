#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist/native"
TARGET_TRIPLE=""
MACHINE_SALT_VALUE="${MACHINE_SALT:-pubflow-local-machine-salt}"

usage() {
  cat <<'USAGE'
Usage: scripts/build-native.sh [--target <triple>] [--out-dir <dir>]

Builds the PubFlow native machine-code helper.

Examples:
  scripts/build-native.sh
  MACHINE_SALT="your-production-salt" scripts/build-native.sh
  scripts/build-native.sh --target aarch64-apple-darwin --out-dir dist/downloads

Output:
  dist/native/pubflow-native-<platform>
  dist/native/pubflow-native-<platform>.json
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_TRIPLE="${2:?missing target triple}"
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

mkdir -p "$OUT_DIR"

if [[ -n "$TARGET_TRIPLE" ]]; then
  MACHINE_SALT="$MACHINE_SALT_VALUE" cargo build -p pubflow-native --release --target "$TARGET_TRIPLE"
  BIN_DIR="$ROOT_DIR/target/$TARGET_TRIPLE/release"
  PLATFORM="$TARGET_TRIPLE"
else
  MACHINE_SALT="$MACHINE_SALT_VALUE" cargo build -p pubflow-native --release
  BIN_DIR="$ROOT_DIR/target/release"
  PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
fi

BIN_NAME="pubflow-native"
if [[ "$TARGET_TRIPLE" == *"windows"* ]]; then
  BIN_NAME="pubflow-native.exe"
fi

OUT_BIN="$OUT_DIR/pubflow-native-$PLATFORM"
if [[ "$BIN_NAME" == *.exe ]]; then
  OUT_BIN="$OUT_BIN.exe"
fi

cp "$BIN_DIR/$BIN_NAME" "$OUT_BIN"
chmod +x "$OUT_BIN" 2>/dev/null || true

MANIFEST="$OUT_DIR/pubflow-native-$PLATFORM.json"
sed "s|REPLACE_WITH_ACTUAL_PATH|$OUT_BIN|g" "$ROOT_DIR/native/pubflow-native.json" > "$MANIFEST"

echo "Native helper built:"
echo "  $OUT_BIN"
echo "  $MANIFEST"
echo ""
echo "Machine code smoke test:"
"$OUT_BIN" --print-machine-code --json || true
