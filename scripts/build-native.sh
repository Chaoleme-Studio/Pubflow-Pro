#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE_DIR="$ROOT_DIR/pubflow-Pro-Native"
OUT_DIR="$ROOT_DIR/dist/native"
ENV_NAME="${ENV:-development}"
TARGET="${CARGO_BUILD_TARGET:-}"
SKIP_WEB=0
BUILDER="auto"

usage() {
  cat <<'EOF'
Usage: scripts/build-native.sh [options]

Options:
  --target <rust-target>  Build for an explicit Rust target.
  --out-dir <path>        Write artifacts to this directory.
  --skip-web              Reuse the existing pubflow-Pro-Web/dist assets.
  --builder <name>        Use auto, cargo, zigbuild, or xwin.
  -h, --help              Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      [ "$#" -ge 2 ] || { echo "--target requires a value" >&2; exit 2; }
      TARGET="$2"
      shift 2
      ;;
    --out-dir)
      [ "$#" -ge 2 ] || { echo "--out-dir requires a value" >&2; exit 2; }
      OUT_DIR="$2"
      shift 2
      ;;
    --skip-web)
      SKIP_WEB=1
      shift
      ;;
    --builder)
      [ "$#" -ge 2 ] || { echo "--builder requires a value" >&2; exit 2; }
      BUILDER="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

HOST_TARGET="$(rustc -vV | sed -n 's/^host: //p')"
TARGET="${TARGET:-$HOST_TARGET}"

case "$TARGET" in
  aarch64-apple-darwin)
    PLATFORM="mac-arm64"
    EXE_SUFFIX=""
    ;;
  x86_64-apple-darwin)
    PLATFORM="mac-x64"
    EXE_SUFFIX=""
    ;;
  x86_64-pc-windows-msvc|x86_64-pc-windows-gnu)
    PLATFORM="win-x64"
    EXE_SUFFIX=".exe"
    ;;
  x86_64-unknown-linux-gnu)
    PLATFORM="linux-x64"
    EXE_SUFFIX=""
    ;;
  *)
    echo "Unsupported Native target: $TARGET" >&2
    echo "Supported targets: aarch64-apple-darwin, x86_64-apple-darwin, x86_64-pc-windows-msvc, x86_64-unknown-linux-gnu" >&2
    exit 2
    ;;
esac
ARCHIVE_SUFFIX="zip"

source "$ROOT_DIR/scripts/build-common.sh"
load_root_env "$ENV_NAME"

# rust-embed reads the Web build at compile time.
if [ "$SKIP_WEB" -eq 0 ]; then
  ENV="$ENV_NAME" "$ROOT_DIR/scripts/build-web.sh"
elif [ ! -f "$ROOT_DIR/pubflow-Pro-Web/dist/index.html" ]; then
  echo "Web build is missing: $ROOT_DIR/pubflow-Pro-Web/dist/index.html" >&2
  exit 1
fi

echo "=== Building PubFlow Native ($PLATFORM / $TARGET) ==="
cd "$NATIVE_DIR"
if [ "$BUILDER" = "auto" ]; then
  case "$TARGET:$HOST_TARGET" in
    x86_64-unknown-linux-gnu:*linux*) BUILDER="cargo" ;;
    x86_64-unknown-linux-gnu:*) BUILDER="zigbuild" ;;
    x86_64-pc-windows-msvc:*windows*) BUILDER="cargo" ;;
    x86_64-pc-windows-msvc:*) BUILDER="xwin" ;;
    *) BUILDER="cargo" ;;
  esac
fi

case "$BUILDER" in
  cargo)
    cargo build --release --target "$TARGET"
    ;;
  zigbuild)
    command -v cargo-zigbuild >/dev/null 2>&1 || { echo "cargo-zigbuild is required for $TARGET" >&2; exit 1; }
    cargo zigbuild --release --target "$TARGET"
    ;;
  xwin)
    command -v cargo-xwin >/dev/null 2>&1 || { echo "cargo-xwin is required for $TARGET" >&2; exit 1; }
    cargo xwin build --release --target "$TARGET"
    ;;
  *)
    echo "Unsupported builder: $BUILDER" >&2
    exit 2
    ;;
esac

SOURCE_BIN="$NATIVE_DIR/target/$TARGET/release/pubflow-pro-native$EXE_SUFFIX"
if [ ! -f "$SOURCE_BIN" ]; then
  echo "Native build artifact is missing: $SOURCE_BIN" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
BINARY_NAME="pubflow-pro-native-$PLATFORM$EXE_SUFFIX"
ARCHIVE_NAME="pubflow-pro-native-$PLATFORM.$ARCHIVE_SUFFIX"
rm -f "$OUT_DIR/$BINARY_NAME" "$OUT_DIR/$ARCHIVE_NAME"
cp "$SOURCE_BIN" "$OUT_DIR/$BINARY_NAME"

if command -v 7z >/dev/null 2>&1; then
  (cd "$OUT_DIR" && 7z a -tzip "$ARCHIVE_NAME" "$BINARY_NAME" >/dev/null)
elif command -v zip >/dev/null 2>&1; then
  (cd "$OUT_DIR" && zip -q "$ARCHIVE_NAME" "$BINARY_NAME")
else
  echo "Creating Native packages requires 7z or zip" >&2
  exit 1
fi

echo "=== PubFlow Native built ==="
echo "  Binary:  $OUT_DIR/$BINARY_NAME"
echo "  Archive: $OUT_DIR/$ARCHIVE_NAME"
