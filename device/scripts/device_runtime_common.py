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
WEB_ROOT = REPO_ROOT / "web"
DEVICE_ROOT = REPO_ROOT / "device"
DEVICE_PYTHON_ROOT = DEVICE_ROOT / "python"
WEB_DEVICE_APP_ROOT = WEB_ROOT / "apps" / "trakrai-device"
SHARED_PYTHON_PACKAGE_NAME = "trakrai_service_runtime"
SHARED_PYTHON_PACKAGE_SOURCE_DIR = DEVICE_PYTHON_ROOT / SHARED_PYTHON_PACKAGE_NAME
DEFAULT_AI_INFERENCE_VERSION = os.environ.get("AI_INFERENCE_VERSION", "0.1.0")
DEFAULT_AUDIO_MANAGER_VERSION = os.environ.get("AUDIO_MANAGER_VERSION", "0.1.0")
DEFAULT_WORKFLOW_ENGINE_VERSION = os.environ.get("WORKFLOW_ENGINE_VERSION", "0.1.0")
GO_LDFLAGS = os.environ.get("GO_LDFLAGS", "")
DOCKER_CACHE_FROM = os.environ.get("TRAKRAI_DOCKER_CACHE_FROM", "").strip()
DOCKER_CACHE_TO = os.environ.get("TRAKRAI_DOCKER_CACHE_TO", "").strip()
DEFAULT_ARM64_PLATFORM = "linux/arm64"
def _detect_local_platform() -> str:
    machine = (platform.machine() or "").lower()
    return {
        "aarch64": "linux/arm64",
        "arm64": "linux/arm64",
        "x86_64": "linux/amd64",
        "amd64": "linux/amd64",
        "x64": "linux/amd64",
    }.get(machine, "linux/amd64")


DEFAULT_LOCAL_PLATFORM = _detect_local_platform()

SERVICE_BUILD_TARGETS: tuple[tuple[str, str, str], ...] = (
    ("cloud-comm", "Dockerfile", "./cmd/cloud-comm"),
    ("cloud-transfer", "Dockerfile", "./cmd/cloud-transfer"),
    ("live-feed", "Dockerfile.gstreamer", "./cmd/live-feed"),
    ("ptz-control", "Dockerfile", "./cmd/ptz-control"),
    ("roi-config", "Dockerfile", "./cmd/roi-config"),
    ("rtsp-feeder", "Dockerfile.gstreamer", "./cmd/rtsp-feeder"),
    ("runtime-manager", "Dockerfile", "./cmd/runtime-manager"),
    ("video-recorder", "Dockerfile", "./cmd/video-recorder"),
)

CONFIG_NAMES: tuple[str, ...] = (
    "audio-manager.json",
    "cloud-comm.json",
    "cloud-transfer.json",
    "live-feed.json",
    "ptz-control.json",
    "roi-config.json",
    "rtsp-feeder.json",
    "video-recorder.json",
    "ai-inference.json",
    "workflow-engine.json",
)

DEFAULT_UI_DEV_ORIGINS: tuple[str, ...] = tuple(
    origin
    for port in range(3000, 3006)
    for origin in (f"http://127.0.0.1:{port}", f"http://localhost:{port}")
)

DEVICE_UI_BUILD_INPUTS: tuple[Path, ...] = (
    WEB_DEVICE_APP_ROOT / "src",
    WEB_DEVICE_APP_ROOT / "package.json",
    WEB_DEVICE_APP_ROOT / "next.config.ts",
    WEB_DEVICE_APP_ROOT / "postcss.config.mjs",
    WEB_DEVICE_APP_ROOT / "tsconfig.json",
    WEB_DEVICE_APP_ROOT / "eslint.config.mjs",
    WEB_ROOT / "package.json",
    WEB_ROOT / "pnpm-lock.yaml",
    WEB_ROOT / "pnpm-workspace.yaml",
    WEB_ROOT / "turbo.json",
    WEB_ROOT / "packages",
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
    edge_origin_hosts: tuple[str, ...] = ()


@dataclass(frozen=True)
class PythonWheelTarget:
    artifact_key: str
    config_name: str
    context_dir: Path
    package_dir: str
    build_wheelhouse: bool
    default_version: str
    description: str
    display_name: str
    module_name: str
    service_name: str


PYTHON_WHEEL_TARGETS: tuple[PythonWheelTarget, ...] = (
    PythonWheelTarget(
        artifact_key="audio-manager-wheel",
        config_name="audio-manager.json",
        context_dir=DEVICE_PYTHON_ROOT,
        package_dir="audio_manager",
        build_wheelhouse=True,
        default_version=DEFAULT_AUDIO_MANAGER_VERSION,
        description="Queued audio generation, local playback, and network-speaker delivery service.",
        display_name="Audio manager",
        module_name="audio_manager",
        service_name="audio-manager",
    ),
    PythonWheelTarget(
        artifact_key="ai-wheel",
        config_name="ai-inference.json",
        context_dir=DEVICE_PYTHON_ROOT,
        package_dir="ai_inference",
        build_wheelhouse=False,
        default_version=DEFAULT_AI_INFERENCE_VERSION,
        description="Wheel-installed Redis-driven AI inference worker.",
        display_name="AI inference",
        module_name="ai_inference",
        service_name="trakrai-ai-inference",
    ),
    PythonWheelTarget(
        artifact_key="workflow-engine-wheel",
        config_name="workflow-engine.json",
        context_dir=DEVICE_PYTHON_ROOT,
        package_dir="workflow_engine",
        build_wheelhouse=False,
        default_version=DEFAULT_WORKFLOW_ENGINE_VERSION,
        description="Queued workflow execution service with hot-reloaded workflow JSON.",
        display_name="Workflow engine",
        module_name="workflow_engine",
        service_name="workflow-engine",
    ),
)


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
    include_python_wheels: set[str],
    require_ui: bool,
    build_ui_if_missing: bool,
) -> dict[str, Path]:
    artifacts = {
        service_name: DEVICE_ROOT / "out" / service_name / service_name
        for service_name, _dockerfile, _cmd_path in SERVICE_BUILD_TARGETS
    }

    for target in PYTHON_WHEEL_TARGETS:
        if target.config_name in include_python_wheels:
            artifacts[target.artifact_key] = find_single_file(
                DEVICE_ROOT / "out" / target.artifact_key,
                "*.whl",
            )

    if not skip_build:
        build_device_artifacts(platform=platform, include_python_wheels=include_python_wheels)
        for target in PYTHON_WHEEL_TARGETS:
            if target.config_name in include_python_wheels:
                artifacts[target.artifact_key] = find_single_file(
                    DEVICE_ROOT / "out" / target.artifact_key,
                    "*.whl",
                )

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
    if not require_ui:
        return

    export_missing = not static_out.exists()
    export_stale = not export_missing and device_ui_export_is_stale(static_out)
    if not export_missing and not export_stale:
        return

    if build_if_missing:
        reason = "missing" if export_missing else "stale"
        print(f"Device UI export is {reason}; rebuilding {static_out}")
        run_local(["pnpm", "--filter", "trakrai-device", "build"], cwd=REPO_ROOT / "web")
        if static_out.exists() and not device_ui_export_is_stale(static_out):
            return

    if export_missing:
        raise SystemExit(
            f"Missing static device UI export at {static_out}. Run `pnpm --filter trakrai-device build` first."
        )
    raise SystemExit(
        f"Stale static device UI export at {static_out}. Rebuild it with `pnpm --filter trakrai-device build`."
    )


def device_ui_export_is_stale(static_out: Path) -> bool:
    if not static_out.exists():
        return True
    output_mtime = latest_tree_mtime(static_out)
    input_mtime = max(latest_tree_mtime(path) for path in DEVICE_UI_BUILD_INPUTS)
    return input_mtime > output_mtime


def latest_tree_mtime(path: Path) -> float:
    if not path.exists():
        return 0.0
    latest_mtime = path.stat().st_mtime
    if path.is_file():
        return latest_mtime
    for child in path.rglob("*"):
        try:
            child_mtime = child.stat().st_mtime
        except FileNotFoundError:
            continue
        if child_mtime > latest_mtime:
            latest_mtime = child_mtime
    return latest_mtime


def build_device_artifacts(*, platform: str, include_python_wheels: set[str]) -> None:
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

    for target in PYTHON_WHEEL_TARGETS:
        if target.config_name not in include_python_wheels:
            continue
        docker_buildx(
            output_dir=DEVICE_ROOT / "out" / target.artifact_key,
            dockerfile="Dockerfile.wheel",
            build_args={
                "PACKAGE_DIR": target.package_dir,
                "BUILD_WHEELHOUSE": "1" if target.build_wheelhouse else "0",
                "PACKAGE_VERSION": target.default_version,
            },
            context_dir=target.context_dir,
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
    if DOCKER_CACHE_FROM:
        command.extend(["--cache-from", DOCKER_CACHE_FROM])
    if DOCKER_CACHE_TO:
        command.extend(["--cache-to", DOCKER_CACHE_TO])
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
    python_dir = stage_dir / "python"
    ui_dir = stage_dir / "ui"
    wheels_dir = stage_dir / "wheels"
    binaries_dir.mkdir(parents=True, exist_ok=True)
    configs_dir.mkdir(parents=True, exist_ok=True)
    python_dir.mkdir(parents=True, exist_ok=True)
    ui_dir.mkdir(parents=True, exist_ok=True)
    wheels_dir.mkdir(parents=True, exist_ok=True)

    config_map = {name: json.loads(json.dumps(payload)) for name, payload in config_map.items()}
    patch_cloud_comm_config(config_map["cloud-comm.json"], options)

    for service_name in [service_name for service_name, _dockerfile, _cmd_path in SERVICE_BUILD_TARGETS]:
        if service_name in {"live-feed", "ptz-control", "roi-config", "rtsp-feeder"} and f"{service_name}.json" not in config_map:
            continue
        shutil.copy2(artifact_paths[service_name], binaries_dir / service_name)

    wheel_names: dict[str, str] = {}
    wheel_dependency_names: dict[str, list[str]] = {}
    for target in PYTHON_WHEEL_TARGETS:
        if target.config_name not in config_map:
            continue
        wheel_path = artifact_paths.get(target.artifact_key)
        if wheel_path is None:
            raise SystemExit(
                f"{target.config_name} requires a built wheel artifact under device/out/{target.artifact_key}"
            )
        shutil.copy2(wheel_path, wheels_dir / wheel_path.name)
        wheel_names[target.config_name] = wheel_path.name
        dependency_names: list[str] = []
        wheelhouse_dir = wheel_path.parent / "wheelhouse"
        if wheelhouse_dir.exists():
            for dependency_wheel in sorted(wheelhouse_dir.glob("*.whl")):
                shutil.copy2(dependency_wheel, wheels_dir / dependency_wheel.name)
                dependency_names.append(dependency_wheel.name)
        wheel_dependency_names[target.config_name] = dependency_names

    shutil.copytree(
        SHARED_PYTHON_PACKAGE_SOURCE_DIR,
        python_dir / SHARED_PYTHON_PACKAGE_NAME,
        dirs_exist_ok=True,
    )

    # Stage device-side maintenance scripts and the package manifest they read
    # from. These get copied into the runtime root (not /usr/local) so they
    # travel with the deployment and can be re-read by operators over SSH.
    tools_dir = stage_dir / "tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(DEVICE_ROOT / "scripts" / "update_control_plane.py", tools_dir / "update_control_plane.py")
    package_metadata_path = DEVICE_ROOT / "package-versions.json"
    if package_metadata_path.exists():
        shutil.copy2(package_metadata_path, tools_dir / "package-versions.json")

    ui_zip_path = ui_dir / "trakrai-device-ui.zip"
    edge_ui_artifact = artifact_paths.get("edge-ui")
    if edge_ui_artifact is not None:
        shutil.copy2(edge_ui_artifact, ui_zip_path)
    else:
        create_ui_zip(WEB_DEVICE_APP_ROOT / "out", ui_zip_path)

    runtime_manager_config = build_runtime_manager_config(options, set(config_map))
    config_map["runtime-manager.json"] = runtime_manager_config
    config_map["managed-services.json"] = {
        "services": runtime_manager_config["services"],
    }

    for name, payload in config_map.items():
        (configs_dir / name).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    manifest = build_manifest(options, set(config_map), wheel_names, wheel_dependency_names)
    manifest_path = stage_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    return {
        "manifest": manifest_path,
        "stage_dir": stage_dir,
    }


def runtime_configs_dir(runtime_root: str) -> str:
    return f"{runtime_root}/configs"


def runtime_config_path(runtime_root: str, file_name: str) -> str:
    return f"{runtime_configs_dir(runtime_root)}/{file_name}"


def runtime_state_dir(runtime_root: str) -> str:
    return f"{runtime_root}/state"


def runtime_state_path(runtime_root: str, file_name: str) -> str:
    return f"{runtime_state_dir(runtime_root)}/{file_name}"


def patch_cloud_comm_config(config: dict[str, Any], options: StageOptions) -> None:
    edge = config.setdefault("edge", {})
    edge["enabled"] = True
    edge.setdefault("listen_addr", f":{options.http_port}")
    edge.setdefault("path", "/ws")

    public_http_port = options.public_http_port or options.http_port
    edge_hosts = dedupe([*list(options.edge_origin_hosts), options.edge_host])
    expected_origins = [
        origin
        for host in edge_hosts
        for origin in (
            f"http://{host}:{public_http_port}",
            f"http://{host}:8088",
        )
    ]
    expected_origins.extend(
        [
            f"http://127.0.0.1:{public_http_port}",
            f"http://localhost:{public_http_port}",
            "http://127.0.0.1:8088",
            "http://localhost:8088",
        ]
    )
    if public_http_port != options.http_port:
        expected_origins.extend(
            [
                *[f"http://{host}:{options.http_port}" for host in edge_hosts],
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
    if options.cloud_bridge_url:
        ui["cloud_bridge_url"] = options.cloud_bridge_url
    else:
        ui.setdefault(
            "cloud_bridge_url",
            f"ws://{options.edge_host}:{options.http_port}{edge.get('path', '/ws')}",
        )
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
        ("cloud-transfer", "Cloud transfer", "Queued upload/download worker backed by SQLite."),
        ("live-feed", "Live feed", "On-device WebRTC streaming service."),
        ("ptz-control", "PTZ control", "PTZ command service."),
        ("roi-config", "ROI config", "Per-camera PTZ base-location and ROI document service."),
        ("rtsp-feeder", "RTSP feeder", "Camera ingest service."),
        ("video-recorder", "Video recorder", "Rolling JPEG frame buffer, photo capture, clip recording, and upload orchestration."),
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

    for target in PYTHON_WHEEL_TARGETS:
        if target.config_name in available_configs:
            services.append(build_wheel_service(target, options))

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
            "config_dir": runtime_configs_dir(runtime_root),
            "download_dir": f"{runtime_root}/downloads",
            "log_dir": f"{runtime_root}/logs",
            "shared_dir": f"{runtime_root}/shared",
            "script_dir": f"{runtime_root}/scripts",
            "state_file": runtime_state_path(runtime_root, "managed-services.json"),
            "version_dir": f"{runtime_root}/versions",
        },
        "http": {
            "download_timeout_sec": 300,
            "user_agent": "trakrai-runtime-manager/1.0",
        },
        "updates": {
            "download_service": "cloud-transfer",
            "poll_interval_ms": 1000,
            "wait_timeout_sec": 900,
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
            runtime_config_path(runtime_root, f"{name}.json"),
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


def build_manifest(
    options: StageOptions,
    available_configs: set[str],
    wheel_names: dict[str, str],
    wheel_dependency_names: dict[str, list[str]],
) -> dict[str, Any]:
    runtime_root = options.runtime_root
    directories = ["bin", "configs", "downloads", "logs", "python", "scripts", "shared", "state", "ui", "versions"]
    stop_units = [
        "trakrai-runtime-manager.service",
        "trakrai-cloud-comm.service",
    ]
    wait_for_units = ["trakrai-cloud-comm.service"]
    configs = [
        {"source": "configs/cloud-comm.json", "target": "configs/cloud-comm.json"},
        {"source": "configs/runtime-manager.json", "target": "configs/runtime-manager.json"},
        {"source": "configs/managed-services.json", "target": "state/managed-services.json"},
    ]
    binaries = [
        {"source": "binaries/cloud-comm", "target": "bin/cloud-comm", "mode": "0755"},
        {"source": "binaries/runtime-manager", "target": "bin/runtime-manager", "mode": "0755"},
    ]
    wheels: list[dict[str, Any]] = []
    python_packages = [
        {
            "source": f"python/{SHARED_PYTHON_PACKAGE_NAME}",
            "target_dir": f"python/{SHARED_PYTHON_PACKAGE_NAME}",
        }
    ]
    dynamic_units: list[str] = []

    for service_name in ["cloud-transfer", "live-feed", "ptz-control", "roi-config", "rtsp-feeder", "video-recorder"]:
        if f"{service_name}.json" not in available_configs:
            continue
        configs.append({"source": f"configs/{service_name}.json", "target": f"configs/{service_name}.json"})
        binaries.append({"source": f"binaries/{service_name}", "target": f"bin/{service_name}", "mode": "0755"})
        dynamic_units.append(f"trakrai-{service_name}.service")

    for target in PYTHON_WHEEL_TARGETS:
        if target.config_name not in available_configs:
            continue
        wheel_name = wheel_names.get(target.config_name, "")
        if not wheel_name:
            raise SystemExit(f"missing wheel artifact name for {target.config_name}")
        configs.append({"source": f"configs/{target.config_name}", "target": f"configs/{target.config_name}"})
        wheels.append(
            {
                "source": f"wheels/{wheel_name}",
                "dependency_sources": [
                    f"wheels/{dependency_name}" for dependency_name in wheel_dependency_names.get(target.config_name, [])
                ],
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
        dynamic_units.append(wheel_systemd_unit(target))

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

    tools = [
        {
            "source": "tools/update_control_plane.py",
            "target": "scripts/update_control_plane.py",
            "mode": "0755",
        },
        {
            "source": "tools/package-versions.json",
            "target": "state/package-versions.json",
            "mode": "0644",
            "optional": True,
        },
    ]

    return {
        "runtime_root": runtime_root,
        "runtime_user": options.runtime_user,
        "runtime_group": options.runtime_group,
        "unit_directory": options.unit_directory,
        "directories": directories,
        "configs": configs,
        "binaries": binaries,
        "tools": tools,
        "ui_bundle": {
            "source": "ui/trakrai-device-ui.zip",
            "target_dir": "ui",
        },
        "python_packages": python_packages,
        "python_path_entries": [f"{runtime_root}/python"],
        "wheels": wheels,
        "runtime_manager": {
            "binary_path": "bin/runtime-manager",
            "config_path": "configs/runtime-manager.json",
            "group": "root",
            "log_path": "logs/runtime-manager.log",
            "script_path": "scripts/start-runtime-manager.sh",
            "unit_name": "trakrai-runtime-manager.service",
            "user": "root",
            "version_file": "versions/runtime-manager.txt",
        },
        "legacy_backup_names": [
            "cloud-comm",
            "cloud-transfer",
            "live-feed",
            "ptz-control",
            "roi-config",
            "rtsp-feeder",
            "video-recorder",
            "serve-device-ui.sh",
            "trakrai-device-ui-current.zip",
            "ui",
            "audio-manager",
            "ai_inference",
            "workflow-engine",
            "python",
            "configs",
            "state",
            *CONFIG_NAMES,
            "runtime-manager.json",
            "managed-services.json",
            "*.log",
        ],
        "manual_process_patterns": [
            f"{runtime_root}/cloud-comm",
            f"{runtime_root}/cloud-transfer",
            f"{runtime_root}/live-feed",
            f"{runtime_root}/ptz-control",
            f"{runtime_root}/roi-config",
            f"{runtime_root}/rtsp-feeder",
            f"{runtime_root}/video-recorder",
            f"{runtime_root}/serve-device-ui.sh",
            runtime_config_path(runtime_root, "audio-manager.json"),
            runtime_config_path(runtime_root, "ai-inference.json"),
            runtime_config_path(runtime_root, "workflow-engine.json"),
            runtime_config_path(runtime_root, "video-recorder.json"),
        ],
        "stop_units": stop_units,
        "wait_for_units": wait_for_units,
        "start_units": start_units,
        "verify_units": verify_units,
    }


def build_wheel_service(target: PythonWheelTarget, options: StageOptions) -> dict[str, Any]:
    runtime_root = options.runtime_root
    return {
        "name": target.service_name,
        "display_name": target.display_name,
        "description": target.description,
        "kind": "wheel",
        "allow_control": True,
        "allow_update": True,
        "enabled": True,
        "exec_start": [
            "python3",
            "-m",
            target.module_name,
            "--config",
            runtime_config_path(runtime_root, target.config_name),
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
            target.module_name,
            "--version",
        ],
        "systemd_unit": wheel_systemd_unit(target),
        "user": options.runtime_user,
        "group": options.runtime_group,
        "environment": {
            "HOME": f"/home/{options.runtime_user}",
            "PYTHONPATH": f"{runtime_root}/python",
            "PYTHONUNBUFFERED": "1",
        },
        "working_directory": runtime_root,
    }


def wheel_systemd_unit(target: PythonWheelTarget) -> str:
    if target.service_name.startswith("trakrai-"):
        return f"{target.service_name}.service"
    return f"trakrai-{target.service_name}.service"


def create_ui_zip(source_dir: Path, output_path: Path) -> None:
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source_dir.rglob("*")):
            if path.is_dir():
                continue
            archive.write(path, path.relative_to(source_dir))


def resolve_local_command(command: str) -> str:
    candidates = [command]
    if os.name == "nt" and Path(command).suffix == "":
        candidates.extend([f"{command}.cmd", f"{command}.exe", f"{command}.bat"])
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return command


def run_local(command: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> None:
    resolved_command = [resolve_local_command(command[0]), *command[1:]]
    print("+", " ".join(resolved_command))
    result = subprocess.run(resolved_command, cwd=cwd, env=env, check=False)
    if result.returncode != 0:
        raise SystemExit(f"Local command failed ({result.returncode}): {' '.join(resolved_command)}")


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
