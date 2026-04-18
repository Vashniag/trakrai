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
        response = client.get_status(timeout_sec=args.timeout_sec)
    print(json.dumps(response, indent=2))
    return 0


def cmd_service_action(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec", "service_name", "action"])
    require_argument_values(args, {"service_name": "--service-name"})
    with _client(args) as client:
        response = client.service_action(args.action, args.service_name, timeout_sec=args.timeout_sec)
    print(json.dumps(response, indent=2))
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec", "service_name", "lines"])
    require_argument_values(args, {"service_name": "--service-name"})
    with _client(args) as client:
        response = client.get_service_log(args.service_name, lines=args.lines, timeout_sec=args.timeout_sec)
    print(json.dumps(response, indent=2))
    return 0


def cmd_definition(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec", "service_name"])
    require_argument_values(args, {"service_name": "--service-name"})
    with _client(args) as client:
        response = client.get_service_definition(args.service_name, timeout_sec=args.timeout_sec)
    print(json.dumps(response, indent=2))
    return 0


def cmd_config_list(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec"])
    with _client(args) as client:
        response = client.list_configs(timeout_sec=args.timeout_sec)
    print(json.dumps(response, indent=2))
    return 0


def cmd_config_get(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec", "config_name", "output"])
    require_argument_values(args, {"config_name": "--config-name"})
    with _client(args) as client:
        response = client.get_config(args.config_name, timeout_sec=args.timeout_sec)
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
        ["url", "device_id", "timeout_sec", "config_name", "content_file", "restart_service", "create_if_missing"],
    )
    require_argument_values(args, {"config_name": "--config-name", "content_file": "--content-file"})
    content = json.loads(Path(args.content_file).expanduser().resolve().read_text(encoding="utf-8"))
    with _client(args) as client:
        response = client.put_config(
            args.config_name,
            content,
            restart_services=list(args.restart_service or []),
            create_if_missing=args.create_if_missing,
            timeout_sec=args.timeout_sec,
        )
    print(json.dumps(response, indent=2))
    return 0


def cmd_update_service(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(
        args,
        request,
        ["url", "device_id", "timeout_sec", "service_name", "remote_path", "local_path", "artifact_sha256"],
    )
    require_argument_values(args, {"service_name": "--service-name"})
    if not str(args.remote_path).strip() and not str(args.local_path).strip():
        raise SystemExit("runtime update-service requires --remote-path or --local-path")
    with _client(args) as client:
        response = client.update_service(
            args.service_name,
            remote_path=args.remote_path,
            local_path=args.local_path,
            artifact_sha256=args.artifact_sha256,
            timeout_sec=args.timeout_sec,
        )
    print(json.dumps(response, indent=2))
    return 0


def cmd_put_file(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec", "path", "content_file", "mode"])
    require_argument_values(args, {"path": "--path", "content_file": "--content-file"})
    content = Path(args.content_file).expanduser().resolve().read_text(encoding="utf-8")
    with _client(args) as client:
        response = client.put_runtime_file(args.path, content, mode=args.mode, timeout_sec=args.timeout_sec)
    print(json.dumps(response, indent=2))
    return 0


def cmd_upsert_service(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec", "definition_file"])
    require_argument_values(args, {"definition_file": "--definition-file"})
    definition = json.loads(Path(args.definition_file).expanduser().resolve().read_text(encoding="utf-8"))
    if not isinstance(definition, dict):
        raise SystemExit("definition file must contain a JSON object")
    with _client(args) as client:
        response = client.upsert_service(definition, timeout_sec=args.timeout_sec)
    print(json.dumps(response, indent=2))
    return 0


def cmd_remove_service(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["url", "device_id", "timeout_sec", "service_name", "purge_files"])
    require_argument_values(args, {"service_name": "--service-name"})
    with _client(args) as client:
        response = client.remove_service(args.service_name, purge_files=args.purge_files, timeout_sec=args.timeout_sec)
    print(json.dumps(response, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m device.devtool runtime",
        description="Manage a running device runtime over the edge websocket API.",
    )
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
    config_set_parser.add_argument("--create-if-missing", action="store_true")
    config_set_parser.set_defaults(func=cmd_config_set)

    update_parser = subparsers.add_parser("update-service", parents=[common_parent], help="update a managed service artifact")
    update_parser.add_argument("--service-name", default="")
    update_parser.add_argument("--remote-path", default="")
    update_parser.add_argument("--local-path", default="")
    update_parser.add_argument("--artifact-sha256", default="")
    update_parser.set_defaults(func=cmd_update_service)

    put_file_parser = subparsers.add_parser("put-file", parents=[common_parent], help="write a text runtime file under the managed runtime root")
    put_file_parser.add_argument("--path", default="")
    put_file_parser.add_argument("--content-file", default="")
    put_file_parser.add_argument("--mode", type=lambda value: int(str(value), 8), default=0o644)
    put_file_parser.set_defaults(func=cmd_put_file)

    upsert_parser = subparsers.add_parser("upsert-service", parents=[common_parent], help="upsert a managed service definition")
    upsert_parser.add_argument("--definition-file", default="")
    upsert_parser.set_defaults(func=cmd_upsert_service)

    remove_parser = subparsers.add_parser("remove-service", parents=[common_parent], help="remove a managed service definition")
    remove_parser.add_argument("--service-name", default="")
    remove_parser.add_argument("--purge-files", action="store_true")
    remove_parser.set_defaults(func=cmd_remove_service)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
