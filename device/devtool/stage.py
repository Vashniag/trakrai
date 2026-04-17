from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import manifests, paths
from .utils import deep_copy_json


@dataclass(frozen=True)
class StageOptions:
    runtime_root: str = paths.DEFAULT_RUNTIME_ROOT
    runtime_user: str = paths.DEFAULT_RUNTIME_USER
    runtime_group: str = paths.DEFAULT_RUNTIME_GROUP
    unit_directory: str = paths.DEFAULT_UNIT_DIRECTORY
    cloud_bridge_url: str = ""
    transport_mode: str = "edge"
    http_port: int = 8080
    public_http_port: int | None = None
    start_mode: str = "all"
    edge_host: str = "127.0.0.1"
    edge_origin_hosts: tuple[str, ...] = ()


def runtime_configs_dir(runtime_root: str) -> str:
    return f"{runtime_root}/configs"


def runtime_config_path(runtime_root: str, file_name: str) -> str:
    return f"{runtime_configs_dir(runtime_root)}/{file_name}"


def runtime_state_dir(runtime_root: str) -> str:
    return f"{runtime_root}/state"


def runtime_state_path(runtime_root: str, file_name: str) -> str:
    return f"{runtime_state_dir(runtime_root)}/{file_name}"


def load_config_dir(config_dir: Path, *, require_cloud_comm: bool = True) -> dict[str, dict[str, Any]]:
    configs: dict[str, dict[str, Any]] = {}
    for config_name in manifests.config_names():
        path = config_dir / config_name
        if path.exists():
            configs[config_name] = json.loads(path.read_text(encoding="utf-8"))
    if require_cloud_comm and "cloud-comm.json" not in configs:
        raise SystemExit(f"cloud-comm.json is required in {config_dir}")
    return configs


def patch_cloud_comm_config(config: dict[str, Any], options: StageOptions) -> None:
    edge = config.setdefault("edge", {})
    edge["enabled"] = True
    edge.setdefault("listen_addr", f":{options.http_port}")
    edge.setdefault("path", "/ws")

    public_http_port = options.public_http_port or options.http_port
    edge_hosts = [*options.edge_origin_hosts, options.edge_host]
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
    existing_origins = list(edge.get("allowed_origins", []))
    edge["allowed_origins"] = sorted({*existing_origins, *expected_origins})

    ui = dict(edge.get("ui") or {})
    ui["enabled"] = True
    ui["static_dir"] = f"{options.runtime_root}/ui"
    ui["diagnostics_enabled"] = True
    ui["transport_mode"] = options.transport_mode
    ui["management_service"] = "runtime-manager"
    if options.cloud_bridge_url:
        ui["cloud_bridge_url"] = options.cloud_bridge_url
    else:
        ui["cloud_bridge_url"] = f"ws://{options.edge_host}:{options.http_port}{edge.get('path', '/ws')}"
    edge["ui"] = ui


def _replace_runtime_tokens(values: tuple[str, ...], *, install_path: str, options: StageOptions, config_name: str | None) -> list[str]:
    config_dir = runtime_configs_dir(options.runtime_root)
    resolved: list[str] = []
    for value in values:
        resolved.append(
            value.replace("{{installPath}}", "{{install_path}}")
            .replace("{{artifactPath}}", "{{artifact_path}}")
            .replace("{{configDir}}", config_dir)
            .replace("{{runtimeRoot}}", options.runtime_root)
            .replace("{{runtimeUser}}", options.runtime_user)
            .replace("{{runtimeGroup}}", options.runtime_group)
            .replace("{{configName}}", config_name or "")
            .replace("{{install_path}}", "{{install_path}}")
        )
    return resolved


def build_runtime_manager_config(options: StageOptions, selected_services: list[manifests.ServiceManifest]) -> dict[str, Any]:
    services: list[dict[str, Any]] = []
    for service in selected_services:
        if service.is_ui_bundle:
            services.append(
                {
                    "name": service.name,
                    "display_name": service.display_name,
                    "description": service.description,
                    "kind": "zip",
                    "core": service.runtime.core,
                    "allow_control": service.runtime.allow_control,
                    "allow_update": service.runtime.allow_update,
                    "enabled": False,
                    "install_path": f"{options.runtime_root}/ui",
                }
            )
            continue
        install_path = (
            f"{options.runtime_root}/bin/{service.name}"
            if service.is_go_binary
            else f"{options.runtime_root}/wheels/{service.name}"
        )
        runtime_user = options.runtime_user
        runtime_group = options.runtime_group
        if service.runtime.run_as == "root":
            runtime_user = "root"
            runtime_group = "root"
        services.append(
            {
                "name": service.name,
                "display_name": service.display_name,
                "description": service.description,
                "kind": "wheel" if service.is_python else "binary",
                "core": service.runtime.core,
                "allow_control": service.runtime.allow_control,
                "allow_update": service.runtime.allow_update,
                "enabled": True,
                "environment": {
                    key: value.replace("{{runtimeRoot}}", options.runtime_root)
                    .replace("{{runtimeUser}}", options.runtime_user)
                    .replace("{{runtimeGroup}}", options.runtime_group)
                    for key, value in service.runtime.environment.items()
                },
                "exec_start": _replace_runtime_tokens(
                    service.runtime.exec_start,
                    install_path=install_path,
                    options=options,
                    config_name=service.config_name,
                ),
                "group": runtime_group,
                "install_path": install_path,
                "setup_command": _replace_runtime_tokens(
                    service.runtime.setup_command,
                    install_path=install_path,
                    options=options,
                    config_name=service.config_name,
                ),
                "systemd_unit": f"trakrai-{service.name}.service",
                "user": runtime_user,
                "version_command": _replace_runtime_tokens(
                    service.runtime.version_command,
                    install_path=install_path,
                    options=options,
                    config_name=service.config_name,
                ),
            }
        )

    return {
        "log_level": "info",
        "ipc": {"socket_path": "/tmp/trakrai-cloud-comm.sock"},
        "systemd": {
            "bin": "systemctl",
            "shell": "/bin/bash",
            "unit_directory": options.unit_directory,
        },
        "runtime": {
            "root_dir": options.runtime_root,
            "binary_dir": f"{options.runtime_root}/bin",
            "config_dir": runtime_configs_dir(options.runtime_root),
            "download_dir": f"{options.runtime_root}/downloads",
            "log_dir": f"{options.runtime_root}/logs",
            "shared_dir": f"{options.runtime_root}/shared",
            "script_dir": f"{options.runtime_root}/scripts",
            "state_file": runtime_state_path(options.runtime_root, "managed-services.json"),
            "version_dir": f"{options.runtime_root}/versions",
        },
        "http": {"download_timeout_sec": 300},
        "updates": {"download_service": "cloud-transfer", "poll_interval_ms": 1000, "wait_timeout_sec": 900},
        "services": services,
    }


def build_stage_manifest(
    options: StageOptions,
    selected_services: list[manifests.ServiceManifest],
    artifact_paths: dict[str, Path],
) -> dict[str, Any]:
    runtime_root = options.runtime_root
    directories = ["bin", "configs", "downloads", "logs", "python", "scripts", "shared", "state", "ui", "versions"]
    configs = [
        {"source": "configs/cloud-comm.json", "target": "configs/cloud-comm.json"},
        {"source": "configs/runtime-manager.json", "target": "configs/runtime-manager.json"},
        {"source": "configs/managed-services.json", "target": "state/managed-services.json"},
    ]
    binaries: list[dict[str, Any]] = []
    wheels: list[dict[str, Any]] = []
    stop_units = ["trakrai-runtime-manager.service", "trakrai-cloud-comm.service"]
    wait_for_units = ["trakrai-cloud-comm.service"]
    dynamic_units: list[str] = []
    selected_python_services = [service for service in selected_services if service.is_python]
    for service in selected_services:
        if service.is_ui_bundle:
            continue
        if service.config_name:
            configs.append({"source": f"configs/{service.config_name}", "target": f"configs/{service.config_name}"})
        if service.is_go_binary:
            binaries.append(
                {
                    "source": f"artifacts/{service.name}",
                    "target": f"bin/{service.name}",
                    "mode": "0755",
                }
            )
        elif service.is_python:
            artifact = artifact_paths.get(service.name)
            if artifact is None:
                raise SystemExit(f"missing artifact for {service.name}")
            dependency_sources: list[str] = []
            wheelhouse_dir = artifact.parent / "wheelhouse"
            if wheelhouse_dir.exists():
                dependency_sources = [f"artifacts/{dependency.name}" for dependency in sorted(wheelhouse_dir.glob("*.whl"))]
            wheels.append(
                {
                    "source": f"artifacts/{artifact.name}",
                    "download_target": f"downloads/{artifact.name}",
                    "dependency_sources": dependency_sources,
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
        dynamic_units.append(f"trakrai-{service.name}.service")
    stop_units.extend(dynamic_units)
    wait_for_units.extend(dynamic_units)
    if options.start_mode == "core":
        start_units = ["trakrai-cloud-comm.service"]
        verify_units = ["trakrai-runtime-manager.service", "trakrai-cloud-comm.service"]
    else:
        start_units = [unit for unit in dynamic_units if not unit.endswith("edge-ui.service")]
        verify_units = ["trakrai-runtime-manager.service", *start_units]
    python_packages: list[dict[str, str]] = []
    python_path_entries: list[str] = []
    if selected_python_services:
        python_packages = [
            {
                "source": "python/trakrai_service_runtime",
                "target_dir": "python/trakrai_service_runtime",
            },
            {
                "source": "python/generated_configs",
                "target_dir": "python/generated_configs",
            },
        ]
        python_path_entries = [f"{runtime_root}/python"]
    return {
        "runtime_root": runtime_root,
        "runtime_user": options.runtime_user,
        "runtime_group": options.runtime_group,
        "unit_directory": options.unit_directory,
        "directories": directories,
        "configs": configs,
        "binaries": binaries,
        "tools": [
            {"source": "tools/update_control_plane.py", "target": "scripts/update_control_plane.py", "mode": "0755"},
            {"source": "tools/package-versions.json", "target": "state/package-versions.json", "mode": "0644", "optional": True},
        ],
        "ui_bundle": {"source": "ui/trakrai-device-ui.zip", "target_dir": "ui"},
        "python_packages": python_packages,
        "python_path_entries": python_path_entries,
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
            service.name for service in selected_services if not service.is_ui_bundle
        ]
        + [
            "python",
            "configs",
            "state",
            "runtime-manager.json",
            "managed-services.json",
            "*.log",
        ],
        "manual_process_patterns": [f"{runtime_root}/{service.name}" for service in selected_services if not service.is_ui_bundle],
        "stop_units": stop_units,
        "wait_for_units": wait_for_units,
        "start_units": start_units,
        "verify_units": verify_units,
    }


def copy_selected_python_support(selected_services: list[manifests.ServiceManifest], python_dir: Path) -> None:
    selected_python_services = [service for service in selected_services if service.is_python]
    if not selected_python_services:
        return

    shutil.copytree(
        paths.DEVICE_PYTHON_ROOT / "trakrai_service_runtime",
        python_dir / "trakrai_service_runtime",
        dirs_exist_ok=True,
    )

    generated_dir = python_dir / "generated_configs"
    generated_dir.mkdir(parents=True, exist_ok=True)
    for support_file in ("__init__.py", "_runtime.py"):
        shutil.copy2(paths.PYTHON_GENERATED_CONFIG_ROOT / support_file, generated_dir / support_file)
    for service in selected_python_services:
        generated_path = service.generated_python_config_file
        if generated_path is None:
            continue
        shutil.copy2(generated_path, generated_dir / generated_path.name)


def prepare_stage(
    stage_dir: Path,
    artifact_paths: dict[str, Path],
    config_map: dict[str, dict[str, Any]],
    options: StageOptions,
) -> dict[str, Path]:
    artifacts_dir = stage_dir / "artifacts"
    configs_dir = stage_dir / "configs"
    python_dir = stage_dir / "python"
    tools_dir = stage_dir / "tools"
    ui_dir = stage_dir / "ui"
    for directory in (artifacts_dir, configs_dir, python_dir, tools_dir, ui_dir):
        directory.mkdir(parents=True, exist_ok=True)

    copied_config_map = deep_copy_json(config_map)
    patch_cloud_comm_config(copied_config_map["cloud-comm.json"], options)
    selected_services = manifests.services_for_config_map(copied_config_map)
    runtime_manager_config = build_runtime_manager_config(options, selected_services)
    copied_config_map["runtime-manager.json"] = runtime_manager_config
    copied_config_map["managed-services.json"] = {"services": runtime_manager_config["services"]}

    for name, payload in copied_config_map.items():
        (configs_dir / name).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    for service in selected_services:
        artifact = artifact_paths.get(service.name)
        if artifact is None:
            raise SystemExit(f"missing artifact for {service.name}")
        if service.is_ui_bundle:
            shutil.copy2(artifact, ui_dir / "trakrai-device-ui.zip")
        elif service.is_python:
            shutil.copy2(artifact, artifacts_dir / artifact.name)
            wheelhouse_dir = artifact.parent / "wheelhouse"
            if wheelhouse_dir.exists():
                for dependency in sorted(wheelhouse_dir.glob("*.whl")):
                    shutil.copy2(dependency, artifacts_dir / dependency.name)
        else:
            shutil.copy2(artifact, artifacts_dir / service.name)

    copy_selected_python_support(selected_services, python_dir)
    shutil.copy2(paths.DEVTOOL_RUNTIME_ASSETS_ROOT / "update_control_plane.py", tools_dir / "update_control_plane.py")
    if paths.PACKAGE_METADATA_PATH.exists():
        shutil.copy2(paths.PACKAGE_METADATA_PATH, tools_dir / "package-versions.json")
    manifest = build_stage_manifest(options, selected_services, artifact_paths)
    manifest_path = stage_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {"manifest": manifest_path, "stage_dir": stage_dir}
