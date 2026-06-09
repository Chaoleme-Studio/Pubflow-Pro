#!/usr/bin/env bash
set -euo pipefail

# PubFlow 数据库初始化脚本
# 用法: ./scripts/setup-db.sh [host] [port] [user] [dbname]
# 默认: ./scripts/setup-db.sh nucbox-g3.local 5432 postgres pubflow

HOST="${1:-nucbox-g3.local}"
PORT="${2:-5432}"
USER="${3:-postgres}"
DBNAME="${4:-pubflow}"

echo "=== PubFlow 数据库初始化 ==="
echo "目标: ${USER}@${HOST}:${PORT}/${DBNAME}"
echo ""

run_psql() {
    psql -h "$HOST" -p "$PORT" -U "$USER" "$@"
}

if command -v psql &>/dev/null; then
    # 本地有 psql，直接连接
    if run_psql -lqt 2>/dev/null | grep -qw "$DBNAME"; then
        echo "数据库 '$DBNAME' 已存在，跳过创建"
    else
        echo "创建数据库 '$DBNAME'..."
        run_psql -c "CREATE DATABASE $DBNAME;" 2>/dev/null
        echo "数据库创建成功"
    fi
elif command -v ssh &>/dev/null; then
    # 本地没有 psql，通过 SSH 到远程服务器执行
    echo "本地未安装 psql，通过 SSH 到 ${HOST} 执行..."
    ssh "${USER}@${HOST}" "psql -p ${PORT} -U ${USER} -lqt 2>/dev/null | grep -qw ${DBNAME}" && {
        echo "数据库 '$DBNAME' 已存在，跳过创建"
    } || {
        echo "创建数据库 '$DBNAME'..."
        ssh "${USER}@${HOST}" "psql -p ${PORT} -U ${USER} -c 'CREATE DATABASE ${DBNAME};'"
        echo "数据库创建成功"
    }
else
    echo "错误: 本地未安装 psql 和 ssh"
    echo "请在 PostgreSQL 所在的服务器上手动执行:"
    echo "  psql -U ${USER} -c 'CREATE DATABASE ${DBNAME};'"
    exit 1
fi

echo ""
echo "=== 完成 ==="
echo "现在可以运行 cargo run 启动应用，表结构会自动迁移"
