#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${ENV:-development}"

source "$ROOT_DIR/scripts/build-common.sh"
load_root_env "$ENV_NAME"

export DOWNLOADS_FS_PATH="${DOWNLOADS_FS_PATH:-$ROOT_DIR/downloads}"
cd "$ROOT_DIR/pubflow-Pro-server-axum-starter"
PUBFLOW_ENV="$ENV_NAME" ENV="$ENV_NAME" APP_ENV="$ENV_NAME" cargo run -p app
