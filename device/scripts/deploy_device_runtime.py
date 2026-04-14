#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

import paramiko


REPO_ROOT = Path(__file__).resolve().parents[2]
DEVICE_ROOT = REPO_ROOT / "device"
WEB_DEVICE_APP_ROOT = REPO_ROOT / "web" / "apps" / "trakrai-device"
DEFAULT_AI_INFERENCE_VERSION = os.environ.get("AI_INFERENCE_VERSION", "0.1.0")
GO_LDFLAGS = os.environ.get("GO_LDFLAGS", "")


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy the controller-managed TrakrAI runtime to a device.")
    parser.add_argument("--host", required=True, help="device hostname or IP")
    parser.add_argument("--user", required=True, help="ssh username")
    parser.add_argument("--password", required=True, help="ssh password / sudo password")
    parser.add_argument("--runtime-root", default="/home/hacklab/trakrai-device-runtime")
    parser.add_argument("--runtime-user", default="hacklab")
    parser.add_argument("--runtime-group", default="hacklab")
    parser.add_argument("--unit-directory", default="/etc/systemd/system")
    parser.add_argument("--config-dir", help="optional local directory containing device JSON configs")
    parser.add_argument("--cloud-bridge-url", default="ws://10.8.0.51:8090/ws")
    parser.add_argument("--transport-mode", default="edge", choices=["edge", "cloud"])
    parser.add_argument("--http-port", type=int, default=8080)
    parser.add_argument("--start-mode", default="all", choices=["core", "all"])
    parser.add_argument("--remote-stage-dir", help="remote temporary staging directory")
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="reuse existing device/out artifacts instead of rebuilding via docker buildx",
    )
    parser.add_argument("--keep-stage", action="store_true")
    args = parser.parse_args()

    artifact_paths = ensure_local_artifacts(skip_build=args.skip_build)
    remote_stage_dir = args.remote_stage_dir or f"/tmp/trakrai-bootstrap-{int(time.time())}"

    with tempfile.TemporaryDirectory(prefix="trakrai-device-stage-") as temp_dir_name:
        stage_dir = Path(temp_dir_name)
        stage_paths = prepare_stage(stage_dir, artifact_paths, args)
        upload_and_deploy(stage_dir, stage_paths, args, remote_stage_dir)

    return 0


def ensure_local_artifacts(*, skip_build: bool) -> dict[str, Path]:
    artifacts = {
        "cloud-comm": DEVICE_ROOT / "out" / "cloud-comm" / "cloud-comm",
        "live-feed": DEVICE_ROOT / "out" / "live-feed" / "live-feed",
        "ptz-control": DEVICE_ROOT / "out" / "ptz-control" / "ptz-control",
        "rtsp-feeder": DEVICE_ROOT / "out" / "rtsp-feeder" / "rtsp-feeder",
        "runtime-manager": DEVICE_ROOT / "out" / "runtime-manager" / "runtime-manager",
        "ai-wheel": find_single_file(DEVICE_ROOT / "out" / "ai-inference-wheel", "*.whl"),
    }

    if not skip_build:
        build_device_artifacts()
        artifacts["ai-wheel"] = find_single_file(DEVICE_ROOT / "out" / "ai-inference-wheel", "*.whl")

    missing = [name for name, path in artifacts.items() if path is None or not Path(path).exists()]
    if missing:
        raise SystemExit(
            "Missing local artifacts: "
            + ", ".join(missing)
            + ". Build them before deploying. Expected under device/out/."
        )

    static_out = WEB_DEVICE_APP_ROOT / "out"
    if not static_out.exists():
        raise SystemExit(
            f"Missing static device UI export at {static_out}. Run `pnpm --filter trakrai-device build` first."
        )

    return {key: Path(value) for key, value in artifacts.items()}


def build_device_artifacts() -> None:
    docker_buildx(
        output_dir=DEVICE_ROOT / "out" / "cloud-comm",
        dockerfile="Dockerfile",
        build_args={
            "CMD_PATH": "./cmd/cloud-comm",
            "BINARY_NAME": "cloud-comm",
            "GO_LDFLAGS": GO_LDFLAGS,
        },
        context_dir=DEVICE_ROOT,
    )
    docker_buildx(
        output_dir=DEVICE_ROOT / "out" / "live-feed",
        dockerfile="Dockerfile.gstreamer",
        build_args={
            "CMD_PATH": "./cmd/live-feed",
            "BINARY_NAME": "live-feed",
            "GO_LDFLAGS": GO_LDFLAGS,
        },
        context_dir=DEVICE_ROOT,
    )
    docker_buildx(
        output_dir=DEVICE_ROOT / "out" / "ptz-control",
        dockerfile="Dockerfile",
        build_args={
            "CMD_PATH": "./cmd/ptz-control",
            "BINARY_NAME": "ptz-control",
            "GO_LDFLAGS": GO_LDFLAGS,
        },
        context_dir=DEVICE_ROOT,
    )
    docker_buildx(
        output_dir=DEVICE_ROOT / "out" / "rtsp-feeder",
        dockerfile="Dockerfile.gstreamer",
        build_args={
            "CMD_PATH": "./cmd/rtsp-feeder",
            "BINARY_NAME": "rtsp-feeder",
            "GO_LDFLAGS": GO_LDFLAGS,
        },
        context_dir=DEVICE_ROOT,
    )
    docker_buildx(
        output_dir=DEVICE_ROOT / "out" / "runtime-manager",
        dockerfile="Dockerfile",
        build_args={
            "CMD_PATH": "./cmd/runtime-manager",
            "BINARY_NAME": "runtime-manager",
            "GO_LDFLAGS": GO_LDFLAGS,
        },
        context_dir=DEVICE_ROOT,
    )
    docker_buildx(
        output_dir=DEVICE_ROOT / "out" / "ai-inference-wheel",
        dockerfile="Dockerfile.wheel",
        build_args={
            "PACKAGE_VERSION": DEFAULT_AI_INFERENCE_VERSION,
        },
        context_dir=DEVICE_ROOT / "python" / "ai_inference",
    )


def docker_buildx(
    *,
    output_dir: Path,
    dockerfile: str,
    build_args: dict[str, str],
    context_dir: Path,
) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    command = [
        "docker",
        "buildx",
        "build",
        "--output",
        f"type=local,dest={output_dir}",
        "-f",
        dockerfile,
    ]
    for key, value in build_args.items():
        command.extend(["--build-arg", f"{key}={value}"])
    command.append(str(context_dir))
    run_local(command, cwd=context_dir)


def run_local(command: list[str], *, cwd: Path) -> None:
    print("+", " ".join(command))
    result = subprocess.run(command, cwd=cwd, check=False)
    if result.returncode != 0:
        raise SystemExit(f"Local command failed ({result.returncode}): {' '.join(command)}")


def prepare_stage(stage_dir: Path, artifact_paths: dict[str, Path], args: argparse.Namespace) -> dict[str, Path]:
    binaries_dir = stage_dir / "binaries"
    configs_dir = stage_dir / "configs"
    ui_dir = stage_dir / "ui"
    wheels_dir = stage_dir / "wheels"
    binaries_dir.mkdir(parents=True, exist_ok=True)
    configs_dir.mkdir(parents=True, exist_ok=True)
    ui_dir.mkdir(parents=True, exist_ok=True)
    wheels_dir.mkdir(parents=True, exist_ok=True)

    config_map = load_device_configs(args)
    patch_cloud_comm_config(config_map["cloud-comm.json"], args)

    for service_name in ["cloud-comm", "live-feed", "ptz-control", "rtsp-feeder", "runtime-manager"]:
        shutil.copy2(artifact_paths[service_name], binaries_dir / service_name)

    wheel_path = artifact_paths["ai-wheel"]
    shutil.copy2(wheel_path, wheels_dir / wheel_path.name)

    ui_zip_path = ui_dir / "trakrai-device-ui.zip"
    create_ui_zip(WEB_DEVICE_APP_ROOT / "out", ui_zip_path)

    runtime_manager_config = build_runtime_manager_config(args, set(config_map))
    config_map["runtime-manager.json"] = runtime_manager_config
    config_map["managed-services.json"] = {
        "services": runtime_manager_config["services"],
    }

    for name, payload in config_map.items():
        (configs_dir / name).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    manifest = build_manifest(args, set(config_map), wheel_path.name)
    manifest_path = stage_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    return {
        "manifest": manifest_path,
        "stage_dir": stage_dir,
    }


def load_device_configs(args: argparse.Namespace) -> dict[str, dict[str, Any]]:
    names = [
        "cloud-comm.json",
        "live-feed.json",
        "ptz-control.json",
        "rtsp-feeder.json",
        "ai-inference.json",
    ]

    if args.config_dir:
        config_dir = Path(args.config_dir)
        configs: dict[str, dict[str, Any]] = {}
        for name in names:
            path = config_dir / name
            if path.exists():
                configs[name] = json.loads(path.read_text(encoding="utf-8"))
        if "cloud-comm.json" not in configs:
            raise SystemExit(f"cloud-comm.json is required in {config_dir}")
        return configs

    ssh_client = connect_ssh(args.host, args.user, args.password)
    try:
        sftp = ssh_client.open_sftp()
        configs = {}
        for name in names:
            remote_path = PurePosixPath(args.runtime_root) / name
            try:
                with sftp.open(str(remote_path), "r") as remote_file:
                    configs[name] = json.loads(remote_file.read().decode("utf-8"))
            except IOError:
                continue
        if "cloud-comm.json" not in configs:
            raise SystemExit(f"Unable to fetch {args.runtime_root}/cloud-comm.json from {args.host}")
        return configs
    finally:
        ssh_client.close()


def patch_cloud_comm_config(config: dict[str, Any], args: argparse.Namespace) -> None:
    edge = config.setdefault("edge", {})
    edge["enabled"] = True
    edge.setdefault("listen_addr", f":{args.http_port}")
    edge.setdefault("path", "/ws")

    expected_origins = [
        f"http://{args.host}:{args.http_port}",
        f"http://127.0.0.1:{args.http_port}",
        f"http://localhost:{args.http_port}",
        f"http://{args.host}:8088",
        "http://127.0.0.1:8088",
        "http://localhost:8088",
    ]
    existing_origins = edge.get("allowed_origins", [])
    edge["allowed_origins"] = dedupe(existing_origins + expected_origins)

    ui = edge.get("ui", {})
    ui["enabled"] = True
    ui["static_dir"] = f"{args.runtime_root}/ui"
    ui["diagnostics_enabled"] = True
    ui["transport_mode"] = args.transport_mode
    ui["cloud_bridge_url"] = args.cloud_bridge_url
    ui["management_service"] = "runtime-manager"
    edge["ui"] = ui


def build_runtime_manager_config(args: argparse.Namespace, available_configs: set[str]) -> dict[str, Any]:
    runtime_root = args.runtime_root
    services: list[dict[str, Any]] = [
        build_binary_service(
            "cloud-comm",
            "Cloud comm",
            "MQTT bridge and edge HTTP host.",
            True,
            runtime_root,
            user=args.runtime_user,
            group=args.runtime_group,
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

    if "live-feed.json" in available_configs:
        services.append(
            build_binary_service(
                "live-feed",
                "Live feed",
                "On-device WebRTC streaming service.",
                False,
                runtime_root,
                user=args.runtime_user,
                group=args.runtime_group,
            )
        )
    if "ptz-control.json" in available_configs:
        services.append(
            build_binary_service(
                "ptz-control",
                "PTZ control",
                "PTZ command service.",
                False,
                runtime_root,
                user=args.runtime_user,
                group=args.runtime_group,
            )
        )
    if "rtsp-feeder.json" in available_configs:
        services.append(
            build_binary_service(
                "rtsp-feeder",
                "RTSP feeder",
                "Camera ingest service.",
                False,
                runtime_root,
                user=args.runtime_user,
                group=args.runtime_group,
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
                "user": args.runtime_user,
                "group": args.runtime_group,
                "environment": {
                    "HOME": f"/home/{args.runtime_user}",
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
            "unit_directory": args.unit_directory,
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


def build_manifest(args: argparse.Namespace, available_configs: set[str], wheel_name: str) -> dict[str, Any]:
    runtime_root = args.runtime_root
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

    if "live-feed.json" in available_configs:
        configs.append({"source": "configs/live-feed.json", "target": "live-feed.json"})
        binaries.append({"source": "binaries/live-feed", "target": "bin/live-feed", "mode": "0755"})
        dynamic_units.append("trakrai-live-feed.service")
    if "ptz-control.json" in available_configs:
        configs.append({"source": "configs/ptz-control.json", "target": "ptz-control.json"})
        binaries.append({"source": "binaries/ptz-control", "target": "bin/ptz-control", "mode": "0755"})
        dynamic_units.append("trakrai-ptz-control.service")
    if "rtsp-feeder.json" in available_configs:
        configs.append({"source": "configs/rtsp-feeder.json", "target": "rtsp-feeder.json"})
        binaries.append({"source": "binaries/rtsp-feeder", "target": "bin/rtsp-feeder", "mode": "0755"})
        dynamic_units.append("trakrai-rtsp-feeder.service")
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

    if args.start_mode == "core":
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
        "runtime_user": args.runtime_user,
        "runtime_group": args.runtime_group,
        "unit_directory": args.unit_directory,
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
            "live-feed",
            "ptz-control",
            "rtsp-feeder",
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
            f"{runtime_root}/live-feed",
            f"{runtime_root}/ptz-control",
            f"{runtime_root}/rtsp-feeder",
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


def upload_and_deploy(
    stage_dir: Path,
    stage_paths: dict[str, Path],
    args: argparse.Namespace,
    remote_stage_dir: str,
) -> None:
    ssh_client = connect_ssh(args.host, args.user, args.password)
    try:
        remote_stage = PurePosixPath(remote_stage_dir)
        run_remote(ssh_client, f"rm -rf {shlex.quote(str(remote_stage))} && mkdir -p {shlex.quote(str(remote_stage))}")
        sftp = ssh_client.open_sftp()
        upload_tree(sftp, stage_dir, remote_stage)
        upload_file(
            sftp,
            DEVICE_ROOT / "scripts" / "bootstrap_device_runtime.py",
            remote_stage / "bootstrap_device_runtime.py",
        )
        run_remote(
            ssh_client,
            "echo {password} | sudo -S -p '' python3 {script} --stage-dir {stage}".format(
                password=shlex.quote(args.password),
                script=shlex.quote(str(remote_stage / "bootstrap_device_runtime.py")),
                stage=shlex.quote(str(remote_stage)),
            ),
            timeout=180,
        )
        verify_remote_state(ssh_client, args)
        if not args.keep_stage:
            run_remote(ssh_client, f"rm -rf {shlex.quote(str(remote_stage))}")
    finally:
        ssh_client.close()


def verify_remote_state(ssh_client: paramiko.SSHClient, args: argparse.Namespace) -> None:
    command = (
        "set -e; "
        "echo '--- active trakrai units ---'; "
        "systemctl list-units --type=service | grep trakrai || true; "
        "echo '--- runtime root ---'; "
        f"ls -la {shlex.quote(args.runtime_root)}; "
        "echo '--- bin ---'; "
        f"ls -la {shlex.quote(args.runtime_root + '/bin')}; "
        "echo '--- logs ---'; "
        f"ls -la {shlex.quote(args.runtime_root + '/logs')}; "
        "echo '--- versions ---'; "
        f"ls -la {shlex.quote(args.runtime_root + '/versions')}; "
        "echo '--- generated units ---'; "
        "ls -la /etc/systemd/system | grep trakrai || true"
    )
    run_remote(ssh_client, f"echo {shlex.quote(args.password)} | sudo -S -p '' bash -lc {shlex.quote(command)}", timeout=120)


def connect_ssh(host: str, user: str, password: str) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=host,
        username=user,
        password=password,
        timeout=20,
        look_for_keys=False,
        allow_agent=False,
    )
    return client


def upload_tree(sftp: paramiko.SFTPClient, local_root: Path, remote_root: PurePosixPath) -> None:
    mkdir_p(sftp, remote_root)
    for path in sorted(local_root.rglob("*")):
        relative = path.relative_to(local_root)
        remote_path = remote_root / relative.as_posix()
        if path.is_dir():
            mkdir_p(sftp, remote_path)
            continue
        mkdir_p(sftp, remote_path.parent)
        upload_file(sftp, path, remote_path)


def upload_file(sftp: paramiko.SFTPClient, local_path: Path, remote_path: PurePosixPath) -> None:
    print(f"+ upload {local_path} -> {remote_path}")
    sftp.put(str(local_path), str(remote_path))


def mkdir_p(sftp: paramiko.SFTPClient, remote_path: PurePosixPath) -> None:
    current = PurePosixPath("/")
    for part in remote_path.parts[1:]:
        current = current / part
        try:
            sftp.stat(str(current))
        except IOError:
            sftp.mkdir(str(current))


def run_remote(
    ssh_client: paramiko.SSHClient,
    command: str,
    *,
    timeout: int = 60,
) -> None:
    print("+ ssh", command)
    stdin, stdout, stderr = ssh_client.exec_command(command, timeout=timeout, get_pty=True)
    stdout_text = stdout.read().decode("utf-8", errors="replace")
    stderr_text = stderr.read().decode("utf-8", errors="replace")
    exit_status = stdout.channel.recv_exit_status()
    if stdout_text:
        safe_write(stdout_text)
    if stderr_text:
        safe_write(stderr_text)
    if exit_status != 0:
        raise SystemExit(f"Remote command failed ({exit_status}): {command}")


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


def safe_write(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
    if not text.endswith("\n"):
        sys.stdout.buffer.write(b"\n")
    sys.stdout.flush()


if __name__ == "__main__":
    raise SystemExit(main())
