#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEVICE_ROOT = REPO_ROOT / "device"
WEB_DEVICE_APP_ROOT = REPO_ROOT / "web" / "apps" / "trakrai-device"
DEFAULT_AI_INFERENCE_VERSION = os.environ.get("AI_INFERENCE_VERSION", "0.1.0")
GO_LDFLAGS = os.environ.get("GO_LDFLAGS", "")
DEFAULT_ARM64_PLATFORM = "linux/arm64"
DEFAULT_LOCAL_PLATFORM = {
    "aarch64": "linux/arm64",
    "arm64": "linux/arm64",
    "x86_64": "linux/amd64",
    "amd64": "linux/amd64",
}.get(platform.machine().lower(), "linux/amd64")

SERVICE_BUILD_TARGETS: tuple[tuple[str, str, str], ...] = (
    ("audio-alert", "Dockerfile", "./cmd/audio-alert"),
    ("cloud-comm", "Dockerfile", "./cmd/cloud-comm"),
    ("live-feed", "Dockerfile.gstreamer", "./cmd/live-feed"),
    ("ptz-control", "Dockerfile", "./cmd/ptz-control"),
    ("rtsp-feeder", "Dockerfile.gstreamer", "./cmd/rtsp-feeder"),
    ("runtime-manager", "Dockerfile", "./cmd/runtime-manager"),
    ("transfer-manager", "Dockerfile", "./cmd/transfer-manager"),
    ("workflow-engine", "Dockerfile", "./cmd/workflow-engine"),
)

CONFIG_NAMES: tuple[str, ...] = (
    "audio-alert.json",
    "cloud-comm.json",
    "live-feed.json",
    "ptz-control.json",
    "rtsp-feeder.json",
    "transfer-manager.json",
    "workflow-engine.json",
    "ai-inference.json",
)

DEFAULT_UI_DEV_ORIGINS: tuple[str, ...] = tuple(
    origin
    for port in range(3000, 3006)
    for origin in (f"http://127.0.0.1:{port}", f"http://localhost:{port}")
)


@dataclass(frozen=True)
class StageOptions:
    runtime_root: str
    runtime_user: str
    runtime_group: str
    unit_directory: str
    cloud_bridge_url: str
    transport_mode: str
    http_port: int
    start_mode: str
    edge_host: str
    public_http_port: int | None = None


def load_local_config_dir(config_dir: Path, *, require_cloud_comm: bool = True) -> dict[str, dict[str, Any]]:
    configs: dict[str, dict[str, Any]] = {}
    for name in CONFIG_NAMES:
        path = config_dir / name
        if path.exists():
            configs[name] = json.loads(path.read_text(encoding="utf-8"))

    if require_cloud_comm and "cloud-comm.json" not in configs:
        raise SystemExit(f"cloud-comm.json is required in {config_dir}")

    return configs


def ensure_local_artifacts(
    *,
    skip_build: bool,
    platform: str,
    include_ai_wheel: bool,
    require_ui: bool,
    build_ui_if_missing: bool,
) -> dict[str, Path]:
    artifacts = {
        service_name: DEVICE_ROOT / "out" / service_name / service_name
        for service_name, _dockerfile, _cmd_path in SERVICE_BUILD_TARGETS
    }

    if include_ai_wheel:
        artifacts["ai-wheel"] = find_single_file(DEVICE_ROOT / "out" / "ai-inference-wheel", "*.whl")

    if not skip_build:
        build_device_artifacts(platform=platform, include_ai_wheel=include_ai_wheel)
        if include_ai_wheel:
            artifacts["ai-wheel"] = find_single_file(DEVICE_ROOT / "out" / "ai-inference-wheel", "*.whl")

    missing = [name for name, path in artifacts.items() if path is None or not Path(path).exists()]
    if missing:
        raise SystemExit(
            "Missing local artifacts: "
            + ", ".join(missing)
            + ". Build them before deploying. Expected under device/out/."
        )

    ensure_device_ui_export(build_if_missing=build_ui_if_missing, require_ui=require_ui)

    return {key: Path(value) for key, value in artifacts.items()}


def ensure_device_ui_export(*, build_if_missing: bool, require_ui: bool) -> None:
    static_out = WEB_DEVICE_APP_ROOT / "out"
    if static_out.exists() or not require_ui:
        return

    if build_if_missing:
        run_local(["pnpm", "--filter", "trakrai-device", "build"], cwd=REPO_ROOT / "web")
        if static_out.exists():
            return

    raise SystemExit(
        f"Missing static device UI export at {static_out}. Run `pnpm --filter trakrai-device build` first."
    )


def build_device_artifacts(*, platform: str, include_ai_wheel: bool) -> None:
    for service_name, dockerfile, cmd_path in SERVICE_BUILD_TARGETS:
        docker_buildx(
            output_dir=DEVICE_ROOT / "out" / service_name,
            dockerfile=dockerfile,
            build_args={
                "CMD_PATH": cmd_path,
                "BINARY_NAME": service_name,
                "GO_LDFLAGS": GO_LDFLAGS,
            },
            context_dir=DEVICE_ROOT,
            platform=platform,
        )

    if include_ai_wheel:
        docker_buildx(
            output_dir=DEVICE_ROOT / "out" / "ai-inference-wheel",
            dockerfile="Dockerfile.wheel",
            build_args={
                "PACKAGE_VERSION": DEFAULT_AI_INFERENCE_VERSION,
            },
            context_dir=DEVICE_ROOT / "python" / "ai_inference",
            platform=platform,
        )


def docker_buildx(
    *,
    output_dir: Path,
    dockerfile: str,
    build_args: dict[str, str],
    context_dir: Path,
    platform: str,
) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    command = [
        "docker",
        "buildx",
        "build",
        "--platform",
        platform,
        "--output",
        f"type=local,dest={output_dir}",
        "-f",
        dockerfile,
    ]
    for key, value in build_args.items():
        command.extend(["--build-arg", f"{key}={value}"])
    command.append(str(context_dir))
    run_local(command, cwd=context_dir)


def prepare_stage(
    stage_dir: Path,
    artifact_paths: dict[str, Path],
    config_map: dict[str, dict[str, Any]],
    options: StageOptions,
) -> dict[str, Path]:
    binaries_dir = stage_dir / "binaries"
    configs_dir = stage_dir / "configs"
    ui_dir = stage_dir / "ui"
    wheels_dir = stage_dir / "wheels"
    binaries_dir.mkdir(parents=True, exist_ok=True)
    configs_dir.mkdir(parents=True, exist_ok=True)
    ui_dir.mkdir(parents=True, exist_ok=True)
    wheels_dir.mkdir(parents=True, exist_ok=True)

    config_map = {name: json.loads(json.dumps(payload)) for name, payload in config_map.items()}
    patch_cloud_comm_config(config_map["cloud-comm.json"], options)

    for service_name in [service_name for service_name, _dockerfile, _cmd_path in SERVICE_BUILD_TARGETS]:
        if service_name == "audio-alert" and "audio-alert.json" not in config_map:
            continue
        if service_name == "workflow-engine" and "workflow-engine.json" not in config_map:
            continue
        if service_name in {"live-feed", "ptz-control", "rtsp-feeder"} and f"{service_name}.json" not in config_map:
            continue
        shutil.copy2(artifact_paths[service_name], binaries_dir / service_name)

    wheel_name = ""
    if "ai-inference.json" in config_map:
        wheel_path = artifact_paths.get("ai-wheel")
        if wheel_path is None:
            raise SystemExit("ai-inference.json requires a built wheel artifact under device/out/ai-inference-wheel")
        shutil.copy2(wheel_path, wheels_dir / wheel_path.name)
        wheel_name = wheel_path.name

    ui_zip_path = ui_dir / "trakrai-device-ui.zip"
    create_ui_zip(WEB_DEVICE_APP_ROOT / "out", ui_zip_path)

    runtime_manager_config = build_runtime_manager_config(options, set(config_map))
    config_map["runtime-manager.json"] = runtime_manager_config
    config_map["managed-services.json"] = {
        "services": runtime_manager_config["services"],
    }

    for name, payload in config_map.items():
        (configs_dir / name).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    manifest = build_manifest(options, set(config_map), wheel_name)
    manifest_path = stage_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    return {
        "manifest": manifest_path,
        "stage_dir": stage_dir,
    }


def patch_cloud_comm_config(config: dict[str, Any], options: StageOptions) -> None:
    edge = config.setdefault("edge", {})
    edge["enabled"] = True
    edge.setdefault("listen_addr", f":{options.http_port}")
    edge.setdefault("path", "/ws")

    public_http_port = options.public_http_port or options.http_port
    expected_origins = [
        f"http://{options.edge_host}:{public_http_port}",
        f"http://127.0.0.1:{public_http_port}",
        f"http://localhost:{public_http_port}",
        f"http://{options.edge_host}:8088",
        "http://127.0.0.1:8088",
        "http://localhost:8088",
    ]
    if public_http_port != options.http_port:
        expected_origins.extend(
            [
                f"http://{options.edge_host}:{options.http_port}",
                f"http://127.0.0.1:{options.http_port}",
                f"http://localhost:{options.http_port}",
            ]
        )
    expected_origins.extend(read_ui_dev_origins())
    existing_origins = edge.get("allowed_origins", [])
    edge["allowed_origins"] = dedupe(existing_origins + expected_origins)

    ui = edge.get("ui", {})
    ui["enabled"] = True
    ui["static_dir"] = f"{options.runtime_root}/ui"
    ui["diagnostics_enabled"] = True
    ui["transport_mode"] = options.transport_mode
    ui["cloud_bridge_url"] = options.cloud_bridge_url
    ui["management_service"] = "runtime-manager"
    edge["ui"] = ui


def build_runtime_manager_config(options: StageOptions, available_configs: set[str]) -> dict[str, Any]:
    runtime_root = options.runtime_root
    services: list[dict[str, Any]] = [
        build_binary_service(
            "cloud-comm",
            "Cloud comm",
            "MQTT bridge and edge HTTP host.",
            True,
            runtime_root,
            user=options.runtime_user,
            group=options.runtime_group,
        ),
        build_binary_service(
            "runtime-manager",
            "Runtime manager",
            "Central runtime controller.",
            True,
            runtime_root,
            allow_control=False,
            allow_update=False,
            user="root",
            group="root",
        ),
        {
            "name": "edge-ui",
            "display_name": "Edge UI",
            "description": "Static device UI served by cloud-comm.",
            "kind": "zip",
            "core": True,
            "allow_control": False,
            "allow_update": True,
            "enabled": False,
            "install_path": f"{runtime_root}/ui",
        },
    ]

    for service_name, display_name, description in [
        ("audio-alert", "Audio alert", "Speaker alert and future talkback service."),
        ("live-feed", "Live feed", "On-device WebRTC streaming service."),
        ("ptz-control", "PTZ control", "PTZ command service."),
        ("rtsp-feeder", "RTSP feeder", "Camera ingest service."),
        ("transfer-manager", "Transfer manager", "Durable signed URL and HTTP transfer worker."),
        ("workflow-engine", "Workflow engine", "Redis-queue-driven edge workflow worker."),
    ]:
        if f"{service_name}.json" not in available_configs:
            continue
        services.append(
            build_binary_service(
                service_name,
                display_name,
                description,
                False,
                runtime_root,
                user=options.runtime_user,
                group=options.runtime_group,
            )
        )

    if "ai-inference.json" in available_configs:
        services.append(
            {
                "name": "trakrai-ai-inference",
                "display_name": "AI inference",
                "description": "Wheel-installed Redis-driven AI inference worker.",
                "kind": "wheel",
                "allow_control": True,
                "allow_update": True,
                "enabled": True,
                "exec_start": [
                    "python3",
                    "-m",
                    "ai_inference",
                    "--config",
                    f"{runtime_root}/ai-inference.json",
                ],
                "setup_command": [
                    "python3",
                    "-m",
                    "pip",
                    "install",
                    "--no-deps",
                    "--force-reinstall",
                    "{{artifact_path}}",
                ],
                "version_command": [
                    "python3",
                    "-m",
                    "ai_inference",
                    "--version",
                ],
                "systemd_unit": "trakrai-ai-inference.service",
                "user": options.runtime_user,
                "group": options.runtime_group,
                "environment": {
                    "HOME": f"/home/{options.runtime_user}",
                    "PYTHONUNBUFFERED": "1",
                },
                "working_directory": runtime_root,
            }
        )

    return {
        "log_level": "info",
        "ipc": {
            "socket_path": "/tmp/trakrai-cloud-comm.sock",
        },
        "systemd": {
            "bin": "systemctl",
            "shell": "/bin/bash",
            "unit_directory": options.unit_directory,
        },
        "runtime": {
            "root_dir": runtime_root,
            "binary_dir": f"{runtime_root}/bin",
            "download_dir": f"{runtime_root}/downloads",
            "log_dir": f"{runtime_root}/logs",
            "script_dir": f"{runtime_root}/scripts",
            "state_file": f"{runtime_root}/managed-services.json",
            "version_dir": f"{runtime_root}/versions",
        },
        "http": {
            "download_timeout_sec": 300,
            "user_agent": "trakrai-runtime-manager/1.0",
        },
        "services": services,
    }


def build_binary_service(
    name: str,
    display_name: str,
    description: str,
    core: bool,
    runtime_root: str,
    *,
    allow_control: bool = True,
    allow_update: bool = True,
    user: str | None = None,
    group: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": name,
        "display_name": display_name,
        "description": description,
        "kind": "binary",
        "core": core,
        "allow_control": allow_control,
        "allow_update": allow_update,
        "enabled": True,
        "install_path": f"{runtime_root}/bin/{name}",
        "exec_start": [
            "{{install_path}}",
            "-config",
            f"{runtime_root}/{name}.json",
        ],
        "version_command": [
            "{{install_path}}",
            "--version",
        ],
        "systemd_unit": f"trakrai-{name}.service",
    }
    if user:
        payload["user"] = user
    if group:
        payload["group"] = group
    return payload


def build_manifest(options: StageOptions, available_configs: set[str], wheel_name: str) -> dict[str, Any]:
    runtime_root = options.runtime_root
    directories = ["bin", "downloads", "logs", "scripts", "ui", "versions"]
    stop_units = [
        "trakrai-runtime-manager.service",
        "trakrai-cloud-comm.service",
    ]
    wait_for_units = ["trakrai-cloud-comm.service"]
    configs = [
        {"source": "configs/cloud-comm.json", "target": "cloud-comm.json"},
        {"source": "configs/runtime-manager.json", "target": "runtime-manager.json"},
        {"source": "configs/managed-services.json", "target": "managed-services.json"},
    ]
    binaries = [
        {"source": "binaries/cloud-comm", "target": "bin/cloud-comm", "mode": "0755"},
        {"source": "binaries/runtime-manager", "target": "bin/runtime-manager", "mode": "0755"},
    ]
    wheels: list[dict[str, Any]] = []
    dynamic_units: list[str] = []

    for service_name in ["audio-alert", "live-feed", "ptz-control", "rtsp-feeder", "transfer-manager", "workflow-engine"]:
        if f"{service_name}.json" not in available_configs:
            continue
        configs.append({"source": f"configs/{service_name}.json", "target": f"{service_name}.json"})
        binaries.append({"source": f"binaries/{service_name}", "target": f"bin/{service_name}", "mode": "0755"})
        dynamic_units.append(f"trakrai-{service_name}.service")

    if "ai-inference.json" in available_configs:
        configs.append({"source": "configs/ai-inference.json", "target": "ai-inference.json"})
        wheels.append(
            {
                "source": f"wheels/{wheel_name}",
                "download_target": f"downloads/{wheel_name}",
                "install_command": [
                    "python3",
                    "-m",
                    "pip",
                    "install",
                    "--no-deps",
                    "--force-reinstall",
                    "{{wheel_path}}",
                ],
            }
        )
        dynamic_units.append("trakrai-ai-inference.service")

    stop_units.extend(dynamic_units)
    wait_for_units.extend(dynamic_units)

    if options.start_mode == "core":
        start_units = [
            "trakrai-cloud-comm.service",
        ]
        verify_units = [
            "trakrai-runtime-manager.service",
            "trakrai-cloud-comm.service",
        ]
    else:
        start_units = ["trakrai-cloud-comm.service", *dynamic_units]
        verify_units = ["trakrai-runtime-manager.service", *start_units]

    return {
        "runtime_root": runtime_root,
        "runtime_user": options.runtime_user,
        "runtime_group": options.runtime_group,
        "unit_directory": options.unit_directory,
        "directories": directories,
        "configs": configs,
        "binaries": binaries,
        "ui_bundle": {
            "source": "ui/trakrai-device-ui.zip",
            "target_dir": "ui",
        },
        "wheels": wheels,
        "runtime_manager": {
            "binary_path": "bin/runtime-manager",
            "config_path": "runtime-manager.json",
            "group": "root",
            "log_path": "logs/runtime-manager.log",
            "script_path": "scripts/start-runtime-manager.sh",
            "unit_name": "trakrai-runtime-manager.service",
            "user": "root",
            "version_file": "versions/runtime-manager.txt",
        },
        "legacy_backup_names": [
            "cloud-comm",
            "audio-alert",
            "live-feed",
            "ptz-control",
            "rtsp-feeder",
            "transfer-manager",
            "workflow-engine",
            "workflow-comm",
            "serve-device-ui.sh",
            "trakrai-device-ui-current.zip",
            "ui",
            "ai_inference",
            "managed-services.json",
            "*.log",
        ],
        "manual_process_patterns": [
            f"{runtime_root}/cloud-comm",
            f"{runtime_root}/audio-alert",
            f"{runtime_root}/live-feed",
            f"{runtime_root}/ptz-control",
            f"{runtime_root}/rtsp-feeder",
            f"{runtime_root}/transfer-manager",
            f"{runtime_root}/workflow-engine",
            f"{runtime_root}/workflow-comm",
            f"{runtime_root}/serve-device-ui.sh",
            f"{runtime_root}/ai-inference.json",
        ],
        "stop_units": stop_units,
        "wait_for_units": wait_for_units,
        "start_units": start_units,
        "verify_units": verify_units,
    }


def create_ui_zip(source_dir: Path, output_path: Path) -> None:
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source_dir.rglob("*")):
            if path.is_dir():
                continue
            archive.write(path, path.relative_to(source_dir))


def run_local(command: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> None:
    print("+", " ".join(command))
    result = subprocess.run(command, cwd=cwd, env=env, check=False)
    if result.returncode != 0:
        raise SystemExit(f"Local command failed ({result.returncode}): {' '.join(command)}")


def find_single_file(directory: Path, pattern: str) -> Path | None:
    matches = sorted(directory.glob(pattern))
    if not matches:
        return None
    return matches[-1]


def dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def read_ui_dev_origins() -> list[str]:
    configured_origins = os.environ.get("TRAKRAI_UI_DEV_ORIGINS", "")
    if configured_origins.strip() == "":
        return list(DEFAULT_UI_DEV_ORIGINS)

    return [origin.strip() for origin in configured_origins.split(",") if origin.strip() != ""]
