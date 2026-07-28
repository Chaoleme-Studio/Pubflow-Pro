#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 默认使用 development 环境；可通过 ENV=production 覆盖
ENV_NAME="${ENV:-development}"

echo "=============================="
echo "  PubFlow Pro - Full Build"
echo "  Environment: $ENV_NAME"
echo "=============================="
echo ""

ENV="$ENV_NAME" "$ROOT_DIR/scripts/build-server.sh"
echo ""
ENV="$ENV_NAME" "$ROOT_DIR/scripts/build-extension.sh"
echo ""
# Web 已由 Native 全平台构建脚本统一构建并嵌入四个平台产物。
ENV="$ENV_NAME" "$ROOT_DIR/scripts/build-native-all.sh"

echo ""
echo "=============================="
echo "  All builds complete!"
echo "=============================="
echo ""
echo "Artifacts:"
echo "  dist/extension/   - Chrome extension (obfuscated)"
echo "  dist/web/         - Web frontend"
echo "  dist/native/      - Platform-named PubFlow Native binary and archive"
echo "  dist/server/wasm/ - WASM package"
echo "  dist/server/native/ - Native helper"
