from __future__ import annotations

import argparse
import ipaddress
import json
import socket
import subprocess
from pathlib import Path
from typing import Any

from . import manifests, paths, schema_tools
from .interactive import choose_many, choose_one, prompt_bool, prompt_value
from .request_files import apply_request_overrides, load_request_file, require_argument_values
from .stage import load_config_dir
from .utils import deep_copy_json


DEFAULT_LOCAL_WEBRTC_HOST_CANDIDATE_IP = "127.0.0.1"


def detect_local_edge_hosts() -> list[str]:
    hosts: list[str] = []

    def add(candidate: str) -> None:
        if is_public_edge_host(candidate) and candidate not in hosts:
            hosts.append(candidate)

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp_socket:
            udp_socket.connect(("8.8.8.8", 80))
            add(udp_socket.getsockname()[0])
    except OSError:
        pass

    hostname = socket.gethostname().strip()
    if hostname:
        try:
            for _family, _socktype, _proto, _canonname, sockaddr in socket.getaddrinfo(hostname, None, family=socket.AF_INET):
                add(sockaddr[0])
        except socket.gaierror:
            pass

    for command in (["ip", "-4", "-o", "addr", "show"], ["ifconfig"]):
        try:
            result = subprocess.run(command, check=False, capture_output=True, text=True)
        except OSError:
            continue
        if result.returncode != 0:
            continue
        for line in result.stdout.splitlines():
            stripped = line.strip()
            if stripped.startswith("inet "):
                add(stripped.split()[1].split("/", 1)[0])
                continue
            parts = stripped.split()
            if "inet" in parts:
                inet_index = parts.index("inet")
                if inet_index + 1 < len(parts):
                    add(parts[inet_index + 1].split("/", 1)[0])
    return hosts


def is_public_edge_host(host: str) -> bool:
    try:
        candidate = ipaddress.ip_address(host.strip())
    except ValueError:
        return False
    return (
        candidate.version == 4
        and not candidate.is_loopback
        and not candidate.is_link_local
        and not candidate.is_multicast
        and not candidate.is_unspecified
    )


def parse_host_candidate_ip(value: str | None) -> str:
    if value is None:
        return ""
    candidates = [part.strip() for part in value.split(",") if part.strip()]
    if len(candidates) > 1:
        raise SystemExit("--webrtc-host-candidate-ip accepts only one IP")
    if not candidates:
        return ""
    host = candidates[0]
    try:
        parsed = ipaddress.ip_address(host)
    except ValueError as exc:
        raise SystemExit(f"invalid --webrtc-host-candidate-ip entry: {host}") from exc
    if parsed.version != 4:
        raise SystemExit("only IPv4 WebRTC host candidate IPs are currently supported")
    return host


def default_webrtc_host_candidate_ip() -> str:
    detected = detect_local_edge_hosts()
    return detected[0] if detected else DEFAULT_LOCAL_WEBRTC_HOST_CANDIDATE_IP


def apply_overlay_dir(config_map: dict[str, dict[str, Any]], overlay_dir: Path) -> dict[str, dict[str, Any]]:
    if not overlay_dir.exists():
        return config_map
    for config_name in manifests.config_names():
        path = overlay_dir / config_name
        if path.exists():
            config_map[config_name] = json.loads(path.read_text(encoding="utf-8"))
    return config_map


def clone_camera_entries(camera_config: dict[str, Any], camera_count: int) -> None:
    cameras = camera_config.get("cameras")
    if not isinstance(cameras, list) or not cameras:
        return
    template = deep_copy_json(cameras[0])
    cloned: list[dict[str, Any]] = []
    for index in range(camera_count):
        payload = deep_copy_json(template)
        payload["id"] = index + 1
        payload["name"] = f"Camera-{index + 1}"
        payload["enabled"] = True
        cloned.append(payload)
    camera_config["cameras"] = cloned


def merge_schema_defaults(defaults: Any, override: Any) -> Any:
    if isinstance(defaults, dict) and isinstance(override, dict):
        merged = deep_copy_json(defaults)
        for key, value in override.items():
            merged[key] = merge_schema_defaults(merged.get(key), value)
        return merged
    if override is None:
        return deep_copy_json(defaults)
    return deep_copy_json(override)


def patch_config_map(
    config_map: dict[str, dict[str, Any]],
    *,
    mqtt_host: str,
    mqtt_port: int,
    cloud_api_base_url: str,
    cloud_api_access_token: str,
    device_id: str,
    camera_count: int,
    webrtc_host_candidate_ip: str,
    webrtc_udp_port_min: int,
    webrtc_udp_port_max: int,
    enable_host_audio_playback: bool,
    host_audio_port: int,
) -> dict[str, dict[str, Any]]:
    patched = deep_copy_json(config_map)
    cloud_comm = patched.get("cloud-comm.json")
    if isinstance(cloud_comm, dict):
        mqtt = cloud_comm.setdefault("mqtt", {})
        mqtt["broker_url"] = f"tcp://{mqtt_host}:{mqtt_port}"
        mqtt["client_id"] = device_id
        cloud_comm["device_id"] = device_id

    cloud_transfer = patched.get("cloud-transfer.json")
    if isinstance(cloud_transfer, dict):
        cloud_transfer["device_id"] = device_id
        cloud_api = cloud_transfer.setdefault("cloud_api", {})
        if cloud_api_base_url:
            cloud_api["base_url"] = cloud_api_base_url.rstrip("/")
        cloud_api["access_token"] = cloud_api_access_token

    workflow_engine = patched.get("workflow-engine.json")
    if isinstance(workflow_engine, dict):
        workflow_engine["device_id"] = device_id

    audio_manager = patched.get("audio-manager.json")
    if isinstance(audio_manager, dict):
        audio_manager["device_id"] = device_id
        playback = audio_manager.setdefault("playback", {})
        if isinstance(playback, dict):
            if enable_host_audio_playback:
                playback["backend"] = "command"
                playback["timeout_sec"] = max(int(playback.get("timeout_sec", 60) or 60), 60)
                playback["command_template"] = [
                    "curl",
                    "--fail",
                    "--silent",
                    "--show-error",
                    "-X",
                    "POST",
                    "--data-binary",
                    "@{audio_path}",
                    "-H",
                    "Content-Type: {audio_content_type}",
                    f"http://host.docker.internal:{host_audio_port}/play",
                ]
            else:
                playback["backend"] = "mock"
                playback.pop("command_template", None)

    live_feed = patched.get("live-feed.json")
    if isinstance(live_feed, dict):
        webrtc = live_feed.setdefault("webrtc", {})
        webrtc["host_candidate_ips"] = [webrtc_host_candidate_ip] if webrtc_host_candidate_ip else []
        webrtc["udp_port_range"] = {"min": webrtc_udp_port_min, "max": webrtc_udp_port_max}

    rtsp_feeder = patched.get("rtsp-feeder.json")
    if isinstance(rtsp_feeder, dict):
        clone_camera_entries(rtsp_feeder, camera_count)
        cameras = rtsp_feeder.get("cameras")
        if isinstance(cameras, list):
            for camera in cameras:
                if not isinstance(camera, dict):
                    continue
                camera["rtsp_url"] = "rtsp://fake-camera:8554/stream"
    return patched


def generate_profile_config_map(
    *,
    profile_name: str,
    camera_count: int,
    cloud_mode: str,
    device_id: str,
    mqtt_host: str,
    mqtt_port: int,
    cloud_api_base_url: str,
    cloud_api_access_token: str,
    webrtc_host_candidate_ip: str,
    webrtc_udp_port_min: int,
    webrtc_udp_port_max: int,
    enable_host_audio_playback: bool,
    host_audio_port: int,
) -> dict[str, dict[str, Any]]:
    profile = manifests.require_profile(profile_name)
    config_map = load_config_dir(profile.base_config_path)
    for overlay_path in profile.overlay_paths:
        config_map = apply_overlay_dir(config_map, overlay_path)
    allowed_config_names = {
        service.config_name
        for service_name in profile.services
        for service in [manifests.require_service(service_name)]
        if service.config_name
    }
    config_map = {name: payload for name, payload in config_map.items() if name in allowed_config_names}
    for service_name in profile.services:
        service = manifests.require_service(service_name)
        if not service.config_name or service.schema_file is None:
            continue
        defaults = schema_tools.generate_defaults(schema_tools.load_schema(service.name))
        config_map[service.config_name] = merge_schema_defaults(defaults, config_map.get(service.config_name, {}))
    if cloud_mode == "local" and not cloud_api_base_url:
        cloud_api_base_url = "http://host.docker.internal:3000"
    return patch_config_map(
        config_map,
        mqtt_host=mqtt_host,
        mqtt_port=mqtt_port,
        cloud_api_base_url=cloud_api_base_url,
        cloud_api_access_token=cloud_api_access_token,
        device_id=device_id,
        camera_count=camera_count,
        webrtc_host_candidate_ip=webrtc_host_candidate_ip,
        webrtc_udp_port_min=webrtc_udp_port_min,
        webrtc_udp_port_max=webrtc_udp_port_max,
        enable_host_audio_playback=enable_host_audio_playback,
        host_audio_port=host_audio_port,
    )


def write_config_map(config_map: dict[str, dict[str, Any]], output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for config_name, payload in config_map.items():
        path = output_dir / config_name
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        written.append(path)
    return written


def validate_config_map(config_map: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    issues: dict[str, list[str]] = {}
    for config_name, payload in config_map.items():
        service = manifests.services_by_config_name().get(config_name)
        if service is None:
            continue
        if service.schema_file is None or not service.schema_file.exists():
            continue
        validation_issues = schema_tools.validate_service_config(service.name, payload)
        if validation_issues:
            issues[config_name] = [f"{issue.path}: {issue.message}" for issue in validation_issues]
    return issues


def cmd_generate(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(
        args,
        request,
        [
            "profile",
            "camera_count",
            "cloud_mode",
            "device_id",
            "mqtt_host",
            "mqtt_port",
            "cloud_api_base_url",
            "cloud_api_access_token",
            "webrtc_host_candidate_ip",
            "webrtc_udp_port_min",
            "webrtc_udp_port_max",
            "enable_host_audio_playback",
            "host_audio_port",
            "output_dir",
        ],
    )
    if not args.profile:
        args.profile = choose_one("Select config profile", [profile.name for profile in manifests.load_profiles()])
    if args.interactive:
        args.camera_count = int(prompt_value("Camera count", str(args.camera_count)))
        args.cloud_mode = prompt_value("Cloud mode", args.cloud_mode)
        args.device_id = prompt_value("Device ID", args.device_id)
        if not args.cloud_api_base_url:
            args.cloud_api_base_url = prompt_value("Cloud API base URL", args.cloud_api_base_url)
        args.enable_host_audio_playback = prompt_bool("Enable host audio playback", args.enable_host_audio_playback)
    config_map = generate_profile_config_map(
        profile_name=args.profile,
        camera_count=args.camera_count,
        cloud_mode=args.cloud_mode,
        device_id=args.device_id,
        mqtt_host=args.mqtt_host,
        mqtt_port=args.mqtt_port,
        cloud_api_base_url=args.cloud_api_base_url,
        cloud_api_access_token=args.cloud_api_access_token,
        webrtc_host_candidate_ip=parse_host_candidate_ip(args.webrtc_host_candidate_ip) if args.webrtc_host_candidate_ip is not None else default_webrtc_host_candidate_ip(),
        webrtc_udp_port_min=args.webrtc_udp_port_min,
        webrtc_udp_port_max=args.webrtc_udp_port_max,
        enable_host_audio_playback=args.enable_host_audio_playback,
        host_audio_port=args.host_audio_port,
    )
    issues = validate_config_map(config_map)
    if issues:
        print(json.dumps({"validationErrors": issues}, indent=2))
        raise SystemExit("generated config map failed schema validation")
    output_dir = Path(args.output_dir).expanduser().resolve()
    written = write_config_map(config_map, output_dir)
    print(json.dumps({"outputDir": str(output_dir), "written": [str(path) for path in written]}, indent=2))
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["config_dir"])
    require_argument_values(args, {"config_dir": "--config-dir"})
    config_dir = Path(args.config_dir).expanduser().resolve()
    if not config_dir.exists():
        raise SystemExit(f"config directory does not exist: {config_dir}")
    if not config_dir.is_dir():
        raise SystemExit(f"config path is not a directory: {config_dir}")
    config_map = load_config_dir(config_dir, require_cloud_comm=False)
    if not config_map:
        raise SystemExit(f"no known config files found in {config_dir}")
    issues = validate_config_map(config_map)
    print(json.dumps({"configDir": str(config_dir), "issues": issues}, indent=2))
    return 1 if issues else 0


def cmd_scaffold_schemas(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["service", "force"])
    selected = list(args.service or [])
    if args.interactive and not selected:
        selected = choose_many("Select services to scaffold schemas for", [service.name for service in manifests.load_services()])
    written = schema_tools.scaffold_all_schemas(services=selected or None, force=args.force)
    print(json.dumps({"written": [str(path) for path in written]}, indent=2))
    return 0


def cmd_codegen(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["service", "go", "python"])
    selected = list(args.service or [])
    if args.interactive and not selected:
        selected = choose_many("Select services to generate config code for", [service.name for service in manifests.load_services() if service.schema_path])
    if not selected:
        selected = [service.name for service in manifests.load_services() if service.schema_path]
    selected_services = [manifests.require_service(name) for name in selected]

    explicit_targets = set()
    if args.go:
        explicit_targets.add("go")
    if args.python:
        explicit_targets.add("python")

    if explicit_targets:
        go_services = [service.name for service in selected_services if "go" in explicit_targets and "go" in service.config_languages]
        python_services = [
            service.name for service in selected_services if "python" in explicit_targets and "python" in service.config_languages
        ]
    else:
        go_services = [service.name for service in selected_services if "go" in service.config_languages]
        python_services = [service.name for service in selected_services if "python" in service.config_languages]

    declared_go_services = [service.name for service in manifests.load_services() if "go" in service.config_languages]
    declared_python_services = [service.name for service in manifests.load_services() if "python" in service.config_languages]
    written, deleted = schema_tools.write_codegen(
        go_services=go_services,
        python_services=python_services,
        declared_go_services=declared_go_services,
        declared_python_services=declared_python_services,
    )
    print(
        json.dumps(
            {
                "written": [str(path) for path in written],
                "deleted": [str(path) for path in deleted],
            },
            indent=2,
        )
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate, validate, and scaffold device configs.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate_parser = subparsers.add_parser("generate", help="generate config files from a profile and schema defaults")
    generate_parser.add_argument("--request", default="")
    generate_parser.add_argument("--profile", default="local-emulator-all")
    generate_parser.add_argument("--output-dir", default=str(paths.LOCALDEV_GENERATED_CONFIG_ROOT / "local-emulator-all"))
    generate_parser.add_argument("--camera-count", type=int, default=1)
    generate_parser.add_argument("--cloud-mode", default="local", choices=["local", "live"])
    generate_parser.add_argument("--device-id", default=paths.DEFAULT_LOCAL_DEVICE_ID)
    generate_parser.add_argument("--mqtt-host", default="host.docker.internal")
    generate_parser.add_argument("--mqtt-port", type=int, default=1883)
    generate_parser.add_argument("--cloud-api-base-url", default="")
    generate_parser.add_argument("--cloud-api-access-token", default="")
    generate_parser.add_argument("--webrtc-host-candidate-ip", default=None)
    generate_parser.add_argument("--webrtc-udp-port-min", type=int, default=paths.DEFAULT_WEBRTC_UDP_PORT_MIN)
    generate_parser.add_argument("--webrtc-udp-port-max", type=int, default=paths.DEFAULT_WEBRTC_UDP_PORT_MAX)
    generate_parser.add_argument("--enable-host-audio-playback", action="store_true")
    generate_parser.add_argument("--host-audio-port", type=int, default=paths.DEFAULT_LOCAL_AUDIO_PORT)
    generate_parser.add_argument("--interactive", action="store_true")
    generate_parser.set_defaults(func=cmd_generate)

    validate_parser = subparsers.add_parser("validate", help="validate a config directory against service schemas")
    validate_parser.add_argument("--request", default="")
    validate_parser.add_argument("--config-dir", default="")
    validate_parser.set_defaults(func=cmd_validate)

    scaffold_parser = subparsers.add_parser("scaffold-schemas", help="generate schema files from sample configs")
    scaffold_parser.add_argument("--request", default="")
    scaffold_parser.add_argument("--service", action="append")
    scaffold_parser.add_argument("--force", action="store_true")
    scaffold_parser.add_argument("--interactive", action="store_true")
    scaffold_parser.set_defaults(func=cmd_scaffold_schemas)

    codegen_parser = subparsers.add_parser("codegen", help="generate Go/Python config bindings from JSON Schemas")
    codegen_parser.add_argument("--request", default="")
    codegen_parser.add_argument("--service", action="append")
    codegen_parser.add_argument("--go", action="store_true")
    codegen_parser.add_argument("--python", action="store_true")
    codegen_parser.add_argument("--interactive", action="store_true")
    codegen_parser.set_defaults(func=cmd_codegen)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
