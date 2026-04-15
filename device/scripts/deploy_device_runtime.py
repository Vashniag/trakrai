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

    config_map = load_device_configs(args)
    artifact_paths = common.ensure_local_artifacts(
        skip_build=args.skip_build,
        platform=common.DEFAULT_ARM64_PLATFORM,
        include_python_wheels={
            target.config_name for target in common.PYTHON_WHEEL_TARGETS if target.config_name in config_map
        },
        require_ui=True,
        build_ui_if_missing=False,
    )
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


def load_device_configs(args: argparse.Namespace) -> dict[str, dict[str, Any]]:
    if args.config_dir:
        return common.load_local_config_dir(Path(args.config_dir))

    ssh_client = connect_ssh(args.host, args.user, args.password)
    try:
        sftp = ssh_client.open_sftp()
        configs = {}
        for name in common.CONFIG_NAMES:
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
