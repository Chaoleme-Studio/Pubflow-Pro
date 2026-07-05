#!/usr/bin/env bash
# 公共环境辅助脚本
# 提供 load_root_env 函数，只从仓库根目录的 .env.development 或 .env.production 加载环境变量。
# 使用方式：
#   source "$(dirname "$0")/../scripts/build-common.sh"
#   load_root_env [development|production]

set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
ROOT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")/.." && pwd)"

# 从根目录环境文件加载变量，并导出为当前 shell 环境变量。
# 参数：环境名称，development 或 production
load_root_env() {
  local env_name="${1:-development}"
  local env_file="$ROOT_DIR/.env.$env_name"

  if [ ! -f "$env_file" ]; then
    echo "[build-common] ERROR: 根目录环境文件不存在: $env_file"
    echo "[build-common] 请从 .env.development 复制一份并命名为 .env.production（生产环境）"
    return 1
  fi

  echo "[env] Loading environment: $env_name ($env_file)"

  local key value
  while IFS= read -r line || [ -n "$line" ]; do
    # 跳过空行和注释行
    line="${line%%#*}"
    [ -z "$line" ] && continue

    # 只处理 KEY=VALUE 格式
    case "$line" in
      *=*)
        key="${line%%=*}"
        value="${line#*=}"

        # 去除 key/value 首尾空格
        key="$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        value="$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

        # 去除可选的引号
        if { [ "${value#\"}" != "$value" ] && [ "${value%\"}" != "$value" ]; } ||
           { [ "${value#\'}" != "$value" ] && [ "${value%\'}" != "$value" ]; }; then
          value="${value:1:-1}"
        fi

        if [ -n "$key" ] && [ -z "${!key+x}" ]; then
          export "$key=$value"
        fi
        ;;
    esac
  done < "$env_file"

  derive_root_env_aliases
  if [ -n "${DATABASE_URL:-}" ]; then
    echo "[env] API=${PUBLIC_API_BASE_URL:-}, SERVER=${APP_SERVER_HOST:-}:${APP_SERVER_PORT:-}, DB=configured"
  else
    echo "[env] API=${PUBLIC_API_BASE_URL:-}, SERVER=${APP_SERVER_HOST:-}:${APP_SERVER_PORT:-}, DB=missing"
  fi
}

derive_root_env_aliases() {
  if [ -n "${PUBLIC_API_BASE_URL:-}" ]; then
    export PUBFLOW_LICENSE_API_BASE_URL="${PUBFLOW_LICENSE_API_BASE_URL:-$PUBLIC_API_BASE_URL}"
    export VITE_PUBFLOW_API_BASE_URL="${VITE_PUBFLOW_API_BASE_URL:-$PUBLIC_API_BASE_URL}"
  fi
}
