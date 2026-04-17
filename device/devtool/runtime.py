from __future__ import annotations

import argparse
import json
from pathlib import Path

from .request_files import apply_request_overrides, load_request_file, require_argument_values
from .runtime_client import RuntimeWsClient


DEFAULT_RUNTIME_URL = "ws://127.0.0.1:18080/ws"


def _client(args: argparse.Namespace) -> RuntimeWsClient:
    return RuntimeWsClient(args.url, device_id=args.device_id, timeout_sec=args.timeout_sec)


def cmd_status(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec"])
    with _client(args) as client:
        response = client.request(
            service="runtime-manager",
            message_type="get-status",
            payload={},
            expected_types={"runtime-manager-status"},
            timeout_sec=args.timeout_sec,
        )
    print(json.dumps(response, indent=2))
    return 0


def cmd_service_action(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec", "service_name", "action"])
    require_argument_values(args, {"service_name": "--service-name"})
    with _client(args) as client:
        response = client.request(
            service="runtime-manager",
            message_type=f"{args.action}-service",
            payload={"serviceName": args.service_name},
            expected_types={"runtime-manager-service-action", "runtime-manager-error"},
            timeout_sec=args.timeout_sec,
        )
    print(json.dumps(response, indent=2))
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec", "service_name", "lines"])
    require_argument_values(args, {"service_name": "--service-name"})
    with _client(args) as client:
        response = client.request(
            service="runtime-manager",
            message_type="get-service-log",
            payload={"serviceName": args.service_name, "lines": args.lines},
            expected_types={"runtime-manager-log", "runtime-manager-error"},
            timeout_sec=args.timeout_sec,
        )
    print(json.dumps(response, indent=2))
    return 0


def cmd_definition(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec", "service_name"])
    require_argument_values(args, {"service_name": "--service-name"})
    with _client(args) as client:
        response = client.request(
            service="runtime-manager",
            message_type="get-service-definition",
            payload={"serviceName": args.service_name},
            expected_types={"runtime-manager-service-definition", "runtime-manager-error"},
            timeout_sec=args.timeout_sec,
        )
    print(json.dumps(response, indent=2))
    return 0


def cmd_config_list(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec"])
    with _client(args) as client:
        response = client.request(
            service="runtime-manager",
            message_type="list-configs",
            payload={},
            expected_types={"runtime-manager-config-list", "runtime-manager-error"},
            timeout_sec=args.timeout_sec,
        )
    print(json.dumps(response, indent=2))
    return 0


def cmd_config_get(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec", "config_name", "output"])
    require_argument_values(args, {"config_name": "--config-name"})
    with _client(args) as client:
        response = client.request(
            service="runtime-manager",
            message_type="get-config",
            payload={"configName": args.config_name},
            expected_types={"runtime-manager-config", "runtime-manager-error"},
            timeout_sec=args.timeout_sec,
        )
    if args.output:
        payload = response.get("envelope", {}).get("payload", {})
        Path(args.output).expanduser().resolve().write_text(
            json.dumps(payload.get("content"), indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(response, indent=2))
    return 0


def cmd_config_set(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(
        args,
        request,
        ["url", "device_id", "timeout_sec", "config_name", "content_file", "restart_service"],
    )
    require_argument_values(args, {"config_name": "--config-name", "content_file": "--content-file"})
    content = json.loads(Path(args.content_file).expanduser().resolve().read_text(encoding="utf-8"))
    with _client(args) as client:
        response = client.request(
            service="runtime-manager",
            message_type="put-config",
            payload={
                "configName": args.config_name,
                "content": content,
                "restartServices": list(args.restart_service or []),
            },
            expected_types={"runtime-manager-config", "runtime-manager-error"},
            timeout_sec=args.timeout_sec,
        )
    print(json.dumps(response, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage a running device runtime over the edge websocket API.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    common_parent = argparse.ArgumentParser(add_help=False)
    common_parent.add_argument("--request", default="")
    common_parent.add_argument("--url", default=DEFAULT_RUNTIME_URL)
    common_parent.add_argument("--device-id", default="")
    common_parent.add_argument("--timeout-sec", type=float, default=15)

    status_parser = subparsers.add_parser("status", parents=[common_parent], help="fetch runtime-manager status")
    status_parser.set_defaults(func=cmd_status)

    for action in ("start", "stop", "restart"):
        action_parser = subparsers.add_parser(action, parents=[common_parent], help=f"{action} a managed service")
        action_parser.add_argument("--service-name", default="")
        action_parser.set_defaults(func=cmd_service_action, action=action)

    logs_parser = subparsers.add_parser("logs", parents=[common_parent], help="tail a managed service log")
    logs_parser.add_argument("--service-name", default="")
    logs_parser.add_argument("--lines", type=int, default=120)
    logs_parser.set_defaults(func=cmd_logs)

    definition_parser = subparsers.add_parser("definition", parents=[common_parent], help="load a managed service definition")
    definition_parser.add_argument("--service-name", default="")
    definition_parser.set_defaults(func=cmd_definition)

    config_parser = subparsers.add_parser("config-list", parents=[common_parent], help="list managed config files")
    config_parser.set_defaults(func=cmd_config_list)

    config_get_parser = subparsers.add_parser("config-get", parents=[common_parent], help="fetch a managed config file")
    config_get_parser.add_argument("--config-name", default="")
    config_get_parser.add_argument("--output", default="")
    config_get_parser.set_defaults(func=cmd_config_get)

    config_set_parser = subparsers.add_parser("config-set", parents=[common_parent], help="update a managed config file")
    config_set_parser.add_argument("--config-name", default="")
    config_set_parser.add_argument("--content-file", default="")
    config_set_parser.add_argument("--restart-service", action="append")
    config_set_parser.set_defaults(func=cmd_config_set)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
