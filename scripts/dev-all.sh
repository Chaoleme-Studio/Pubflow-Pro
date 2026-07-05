#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${ENV:-development}"

source "$ROOT_DIR/scripts/build-common.sh"
load_root_env "$ENV_NAME"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill 0
}
trap cleanup EXIT INT TERM

echo "Starting PubFlow Pro (all services)..."
echo "  Server:    ${PUBLIC_API_BASE_URL:-http://127.0.0.1:5189}"
echo "  Web:       http://127.0.0.1:${WEB_DEV_SERVER_PORT:-5188}"
echo "  Extension: WXT dev mode"
echo ""
echo "Press Ctrl+C to stop all."
echo ""

ENV="$ENV_NAME" "$ROOT_DIR/scripts/dev-server.sh" &
ENV="$ENV_NAME" "$ROOT_DIR/scripts/dev-web.sh" &
ENV="$ENV_NAME" "$ROOT_DIR/scripts/dev-extension.sh" &
wait
