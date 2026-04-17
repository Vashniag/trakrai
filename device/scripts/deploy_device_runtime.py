#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shlex
import sys
import tempfile
import time
from pathlib import Path, PurePosixPath
from typing import Any

import paramiko

import device_runtime_common as common
import manage_device_packages as package_manager


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
    parser.add_argument(
        "--cloud-bridge-url",
        default="",
        help="cloud bridge websocket URL for the edge UI; when empty, falls back to the existing runtime-config value and otherwise ws://<host>:<http-port>/ws",
    )
    parser.add_argument("--transport-mode", default="edge", choices=["edge", "cloud"])
    parser.add_argument("--http-port", type=int, default=8080)
    parser.add_argument("--start-mode", default="all", choices=["core", "all"])
    parser.add_argument("--remote-stage-dir", help="remote temporary staging directory")
    parser.add_argument(
        "--artifact-source",
        choices=["local", "cloud"],
        default="local",
        help="use locally built artifacts or download published artifacts from the cloud package repo",
    )
    parser.add_argument("--artifact-platform", default=common.DEFAULT_ARM64_PLATFORM)
    parser.add_argument("--artifact-download-root", default="")
    parser.add_argument("--package-metadata", default=str(package_manager.PACKAGE_METADATA_PATH))
    parser.add_argument("--cloud-api-base-url", default="")
    parser.add_argument("--cloud-api-token", default="")
    parser.add_argument("--device-id", default="")
    parser.add_argument("--package-download-path", default="")
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="reuse existing device/out artifacts instead of rebuilding via docker buildx",
    )
    parser.add_argument("--keep-stage", action="store_true")
    args = parser.parse_args()

    config_map = load_device_configs(args)
    artifact_paths = resolve_artifact_paths(args, config_map)
    remote_stage_dir = args.remote_stage_dir or f"/tmp/trakrai-bootstrap-{int(time.time())}"

    options = common.StageOptions(
        runtime_root=args.runtime_root,
        runtime_user=args.runtime_user,
        runtime_group=args.runtime_group,
        unit_directory=args.unit_directory,
        cloud_bridge_url=args.cloud_bridge_url,
        transport_mode=args.transport_mode,
        http_port=args.http_port,
        start_mode=args.start_mode,
        edge_host=args.host,
    )

    with tempfile.TemporaryDirectory(prefix="trakrai-device-stage-") as temp_dir_name:
        stage_dir = Path(temp_dir_name)
        common.prepare_stage(stage_dir, artifact_paths, config_map, options)
        upload_and_deploy(stage_dir, args, remote_stage_dir)

    return 0


def resolve_artifact_paths(args: argparse.Namespace, config_map: dict[str, dict[str, Any]]) -> dict[str, Path]:
    if args.artifact_source == "cloud":
        return download_cloud_artifacts(args, config_map)
    return common.ensure_local_artifacts(
        skip_build=args.skip_build,
        platform=args.artifact_platform,
        include_python_wheels={
            target.config_name for target in common.PYTHON_WHEEL_TARGETS if target.config_name in config_map
        },
        require_ui=True,
        build_ui_if_missing=False,
    )


def required_package_names(config_map: dict[str, dict[str, Any]]) -> list[str]:
    package_names = {"cloud-comm", "runtime-manager", "edge-ui"}
    for service_name in ["cloud-transfer", "live-feed", "ptz-control", "roi-config", "rtsp-feeder", "video-recorder"]:
        if f"{service_name}.json" in config_map:
            package_names.add(service_name)
    for target in common.PYTHON_WHEEL_TARGETS:
        if target.config_name in config_map:
            package_names.add(target.service_name)
    return sorted(package_names)


def download_cloud_artifacts(args: argparse.Namespace, config_map: dict[str, dict[str, Any]]) -> dict[str, Path]:
    cloud_transfer_config = config_map.get("cloud-transfer.json", {})
    cloud_api = cloud_transfer_config.get("cloud_api", {}) if isinstance(cloud_transfer_config, dict) else {}
    cloud_api_base_url = args.cloud_api_base_url.strip() or str(cloud_api.get("base_url", "")).strip()
    cloud_api_token = args.cloud_api_token if args.cloud_api_token != "" else str(cloud_api.get("access_token", "")).strip()
    device_id = args.device_id.strip() or str(cloud_transfer_config.get("device_id", "")).strip()
    package_download_path = (
        args.package_download_path.strip()
        or str(cloud_api.get("package_download_presign_path", "")).strip()
        or package_manager.CLOUD_API_PACKAGE_DOWNLOAD_PATH
    )

    if cloud_api_base_url == "":
        raise SystemExit(
            "cloud artifact downloads require cloud_api.base_url in cloud-transfer.json or --cloud-api-base-url",
        )
    if device_id == "":
        raise SystemExit("cloud artifact downloads require device_id in cloud-transfer.json or --device-id")

    downloaded = package_manager.download_release_artifacts(
        metadata_path=Path(args.package_metadata).resolve(),
        package_names=required_package_names(config_map),
        platform=args.artifact_platform,
        cloud_api_base_url=cloud_api_base_url,
        cloud_api_token=cloud_api_token,
        device_id=device_id,
        package_download_path=package_download_path,
        output_root=Path(args.artifact_download_root).resolve() if args.artifact_download_root else None,
    )
    # `downloaded` is keyed by package name (PackageTarget.name) — which for wheels is the service
    # name (e.g. "audio-manager"). prepare_stage, however, looks wheels up by the
    # PythonWheelTarget.artifact_key (e.g. "audio-manager-wheel"). Mirror those entries so the
    # cloud path matches the locally-built path returned by ensure_local_artifacts.
    for wheel_target in common.PYTHON_WHEEL_TARGETS:
        if wheel_target.service_name in downloaded:
            downloaded[wheel_target.artifact_key] = downloaded[wheel_target.service_name]
    return downloaded


def load_device_configs(args: argparse.Namespace) -> dict[str, dict[str, Any]]:
    if args.config_dir:
        return common.load_local_config_dir(Path(args.config_dir))

    ssh_client = connect_ssh(args.host, args.user, args.password)
    try:
        sftp = ssh_client.open_sftp()
        configs = {}
        for name in common.CONFIG_NAMES:
            candidate_paths = [
                PurePosixPath(args.runtime_root) / "configs" / name,
                PurePosixPath(args.runtime_root) / name,
            ]
            for remote_path in candidate_paths:
                try:
                    with sftp.open(str(remote_path), "r") as remote_file:
                        configs[name] = json.loads(remote_file.read().decode("utf-8"))
                    break
                except IOError:
                    continue
        if "cloud-comm.json" not in configs:
            raise SystemExit(f"Unable to fetch {args.runtime_root}/configs/cloud-comm.json from {args.host}")
        return configs
    finally:
        ssh_client.close()


def upload_and_deploy(
    stage_dir: Path,
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
            common.DEVICE_ROOT / "scripts" / "bootstrap_device_runtime.py",
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
        "echo '--- configs ---'; "
        f"ls -la {shlex.quote(args.runtime_root + '/configs')}; "
        "echo '--- logs ---'; "
        f"ls -la {shlex.quote(args.runtime_root + '/logs')}; "
        "echo '--- state ---'; "
        f"ls -la {shlex.quote(args.runtime_root + '/state')}; "
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
    _stdin, stdout, stderr = ssh_client.exec_command(command, timeout=timeout, get_pty=True)
    stdout_text = stdout.read().decode("utf-8", errors="replace")
    stderr_text = stderr.read().decode("utf-8", errors="replace")
    exit_status = stdout.channel.recv_exit_status()
    if stdout_text:
        safe_write(stdout_text)
    if stderr_text:
        safe_write(stderr_text)
    if exit_status != 0:
        raise SystemExit(f"Remote command failed ({exit_status}): {command}")


def safe_write(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
    if not text.endswith("\n"):
        sys.stdout.buffer.write(b"\n")
    sys.stdout.flush()


if __name__ == "__main__":
    raise SystemExit(main())
