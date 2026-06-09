#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill 0
}
trap cleanup EXIT INT TERM

echo "Starting PubFlow Pro (all services)..."
echo "  Server:    http://127.0.0.1:3001"
echo "  Web:       http://127.0.0.1:5188"
echo "  Extension: WXT dev mode"
echo ""
echo "Press Ctrl+C to stop all."
echo ""

"$ROOT_DIR/scripts/dev-server.sh" &
"$ROOT_DIR/scripts/dev-web.sh" &
"$ROOT_DIR/scripts/dev-extension.sh" &
wait
