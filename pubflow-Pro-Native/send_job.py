"""手机端模拟器：向 Rust PubFlow Native 发起完整发布任务。"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

AGENT_ENV_KEYS = {
    "PUBFLOW_AGENT_API_TOKEN",
    "PUBFLOW_AGENT_DATA_DIR",
    "PUBFLOW_AGENT_PORT",
    "PUBFLOW_AGENT_URL",
}


def main() -> None:
    root_env = read_root_agent_env()
    parser = argparse.ArgumentParser(description="向 PubFlow Pro Native 发送发布任务")
    parser.add_argument("job_file", help="完整发布配置 JSON 文件；传 - 从 stdin 读取")
    parser.add_argument("--url", default=config_value(root_env, "PUBFLOW_AGENT_URL"))
    parser.add_argument("--token", default=config_value(root_env, "PUBFLOW_AGENT_API_TOKEN") or "")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(
            config_value(root_env, "PUBFLOW_AGENT_DATA_DIR") or "~/.pubflow-pro-native"
        ).expanduser(),
    )
    args = parser.parse_args()

    token = args.token.strip() or read_token(args.data_dir / "api-token")
    if not token:
        parser.error("未找到 Agent Token；请先启动 Rust Native，或传入 --token")

    configured_port = config_value(root_env, "PUBFLOW_AGENT_PORT")
    port = parse_port(configured_port) if configured_port else read_persisted_port(args.data_dir)
    base_url = (args.url or f"http://127.0.0.1:{port or 5190}").rstrip("/")
    health = get_health(base_url)
    workspace = health.get("workspace", "未知")
    extension_connected = health.get("extensionConnected") is True
    workspace_matched = health.get("workspaceMatched")
    native_authorized = health.get("nativePublishAuthorized") is True
    connection_label = "已连接" if extension_connected else "未连接"
    print(f"Agent 工作区：{workspace}", file=sys.stderr)
    print(f"Chrome 插件：{connection_label}", file=sys.stderr)
    if not extension_connected:
        print(
            "拒绝提交：插件当前未连接，Native 无法确认当前套餐权限。请先启动 Chrome 并保持插件在线。",
            file=sys.stderr,
        )
        raise SystemExit(1)
    elif workspace_matched is not True:
        print(
            "拒绝提交：插件与 Native 的工作区身份不一致，或插件仍是旧版本。请重新加载最新插件，并让 Dashboard 与 Native 选择同一个目录。",
            file=sys.stderr,
        )
        raise SystemExit(1)
    elif not native_authorized:
        print(
            "拒绝提交：当前插件授权不包含 Native 本地发布能力；此入口仅支持 Plus / Pro。",
            file=sys.stderr,
        )
        raise SystemExit(1)

    body = (
        sys.stdin.buffer.read()
        if args.job_file == "-"
        else Path(args.job_file).expanduser().resolve().read_bytes()
    )
    request = urllib.request.Request(
        f"{base_url}/v1/jobs",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status_code = response.status
            result = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(f"发送失败 HTTP {error.code}: {detail}", file=sys.stderr)
        raise SystemExit(1) from error
    except urllib.error.URLError as error:
        print(f"无法连接 PubFlow Native：{error.reason}", file=sys.stderr)
        raise SystemExit(1) from error

    if status_code == 200:
        print(
            "提示：requestId 已存在，本次返回的是历史任务，没有新建 Project 或重新发布。",
            file=sys.stderr,
        )
    elif status_code == 201:
        print("已创建新任务。", file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("status") in {"failed", "cancelled"}:
        print(f"任务当前状态为 {result['status']}：{result.get('error') or '无错误详情'}", file=sys.stderr)
        raise SystemExit(2)


def get_health(base_url: str) -> dict[str, object]:
    request = urllib.request.Request(f"{base_url}/health", method="GET")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)
    except (urllib.error.URLError, json.JSONDecodeError) as error:
        print(f"无法读取 PubFlow Native 健康状态：{error}", file=sys.stderr)
        raise SystemExit(1) from error


def read_token(path: Path) -> str:
    try:
        return path.expanduser().read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def read_root_agent_env() -> dict[str, str]:
    env_name = (
        os.getenv("PUBFLOW_ENV")
        or os.getenv("ENV")
        or os.getenv("APP_ENV")
        or "development"
    )
    path = Path(__file__).resolve().parent.parent / f".env.{env_name}"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}

    values: dict[str, str] = {}
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key not in AGENT_ENV_KEYS:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = os.path.expandvars(value)
    return values


def config_value(root_env: dict[str, str], key: str) -> str | None:
    return os.getenv(key) or root_env.get(key)


def parse_port(value: str) -> int:
    try:
        port = int(value)
    except ValueError as error:
        raise SystemExit(f"PUBFLOW_AGENT_PORT 格式无效：{value}") from error
    if not 1 <= port <= 65535:
        raise SystemExit("PUBFLOW_AGENT_PORT 必须在 1..65535 之间")
    return port


def read_persisted_port(data_dir: Path) -> int | None:
    try:
        config = json.loads((data_dir / "config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    value = config.get("port")
    return parse_port(str(value)) if value is not None else None


if __name__ == "__main__":
    main()
