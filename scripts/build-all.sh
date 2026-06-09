#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=============================="
echo "  PubFlow Pro - Full Build"
echo "=============================="
echo ""

"$ROOT_DIR/scripts/build-server.sh"
echo ""
"$ROOT_DIR/scripts/build-extension.sh"
echo ""
"$ROOT_DIR/scripts/build-web.sh"

echo ""
echo "=============================="
echo "  All builds complete!"
echo "=============================="
echo ""
echo "Artifacts:"
echo "  dist/extension/   - Chrome extension (obfuscated)"
echo "  dist/web/         - Web frontend"
echo "  dist/server/wasm/ - WASM package"
echo "  dist/server/native/ - Native helper"
