#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DOWNLOADS_FS_PATH="${DOWNLOADS_FS_PATH:-$ROOT_DIR/downloads}"
cd "$ROOT_DIR/pubflow-Pro-server-axum-starter"
cargo run -p app
