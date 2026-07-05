#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${ENV:-development}"

source "$ROOT_DIR/scripts/build-common.sh"
load_root_env "$ENV_NAME"

cd "$ROOT_DIR/pubflow-Pro"
pnpm install
ENV="$ENV_NAME" pnpm dev
