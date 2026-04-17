from __future__ import annotations

import argparse
import json
import shlex
import tempfile
from pathlib import Path
from typing import Any

from . import manifests, paths
from .build import resolve_local_artifacts
from .packages import CLOUD_API_PACKAGE_DOWNLOAD_PATH, download_release_artifacts
from .request_files import apply_request_overrides, load_request_file
from .ssh_transport import ExpectSSHClient, SSHConnectionInfo
from .stage import StageOptions, load_config_dir, prepare_stage


def _connection(args: argparse.Namespace) -> ExpectSSHClient:
    return ExpectSSHClient(SSHConnectionInfo(host=args.host, user=args.user, password=args.password, port=args.port))


def load_remote_configs(args: argparse.Namespace) -> dict[str, dict[str, Any]]:
    client = _connection(args)
    configs: dict[str, dict[str, Any]] = {}
    for config_name in manifests.config_names():
        for remote_path in (
            f"{args.runtime_root}/configs/{config_name}",
            f"{args.runtime_root}/{config_name}",
        ):
            try:
                payload = client.read_text(remote_path, timeout_sec=30)
                configs[config_name] = json.loads(payload)
                break
            except Exception:
                continue
    if "cloud-comm.json" not in configs:
        raise SystemExit(f"unable to fetch {args.runtime_root}/configs/cloud-comm.json from {args.host}")
    return configs


def resolve_artifacts(args: argparse.Namespace, config_map: dict[str, dict[str, Any]]) -> dict[str, Path]:
    selected_services = [service.name for service in manifests.services_for_config_map(config_map)]
    if args.artifact_source == "cloud":
        cloud_transfer = config_map.get("cloud-transfer.json", {})
        cloud_api = cloud_transfer.get("cloud_api", {}) if isinstance(cloud_transfer, dict) else {}
        cloud_api_base_url = args.cloud_api_base_url.strip() or str(cloud_api.get("base_url", "")).strip()
        cloud_api_token = args.cloud_api_token or str(cloud_api.get("access_token", "")).strip()
        device_id = args.device_id.strip() or str(cloud_transfer.get("device_id", "")).strip()
        package_download_path = (
            args.package_download_path.strip()
            or str(cloud_api.get("package_download_presign_path", "")).strip()
            or CLOUD_API_PACKAGE_DOWNLOAD_PATH
        )
        return download_release_artifacts(
            metadata_path=Path(args.package_metadata).resolve(),
            package_names=selected_services,
            platform=args.artifact_platform,
            cloud_api_base_url=cloud_api_base_url,
            cloud_api_token=cloud_api_token,
            device_id=device_id,
            package_download_path=package_download_path,
            output_root=Path(args.artifact_download_root).resolve() if args.artifact_download_root else None,
        )
    return resolve_local_artifacts(
        service_names=selected_services,
        skip_build=args.skip_build,
        platform=args.artifact_platform,
        require_ui=True,
        build_ui_if_missing=False,
    )


def verify_remote_state(client: ExpectSSHClient, args: argparse.Namespace) -> None:
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
        "echo '--- state ---'; "
        f"ls -la {shlex.quote(args.runtime_root + '/state')}; "
        "echo '--- versions ---'; "
        f"ls -la {shlex.quote(args.runtime_root + '/versions')}"
    )
    client.run(f"echo {shlex.quote(args.password)} | sudo -S -p '' bash -lc {shlex.quote(command)}", timeout_sec=120)


def cmd_ssh(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(
        args,
        request,
        [
            "host",
            "port",
            "user",
            "password",
            "runtime_root",
            "runtime_user",
            "runtime_group",
            "unit_directory",
            "config_dir",
            "cloud_bridge_url",
            "transport_mode",
            "http_port",
            "start_mode",
            "remote_stage_dir",
            "artifact_source",
            "artifact_platform",
            "artifact_download_root",
            "package_metadata",
            "cloud_api_base_url",
            "cloud_api_token",
            "device_id",
            "package_download_path",
            "skip_build",
            "keep_stage",
        ],
    )
    config_map = load_config_dir(Path(args.config_dir).expanduser().resolve()) if args.config_dir else load_remote_configs(args)
    artifacts = resolve_artifacts(args, config_map)
    remote_stage_dir = args.remote_stage_dir or f"/tmp/trakrai-bootstrap-{args.user}"
    options = StageOptions(
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
    client = _connection(args)
    with tempfile.TemporaryDirectory(prefix="trakrai-device-stage-") as temp_dir_name:
        stage_dir = Path(temp_dir_name)
        prepare_stage(stage_dir, artifacts, config_map, options)
        client.upload_tree(stage_dir, remote_stage_dir, timeout_sec=300)
        client.upload_file(
            paths.DEVTOOL_RUNTIME_ASSETS_ROOT / "bootstrap_device_runtime.py",
            f"{remote_stage_dir}/bootstrap_device_runtime.py",
            timeout_sec=120,
        )
        client.run(
            "echo {password} | sudo -S -p '' python3 {script} --stage-dir {stage}".format(
                password=shlex.quote(args.password),
                script=shlex.quote(f"{remote_stage_dir}/bootstrap_device_runtime.py"),
                stage=shlex.quote(remote_stage_dir),
            ),
            timeout_sec=300,
        )
        verify_remote_state(client, args)
        if not args.keep_stage:
            client.run(f"rm -rf {shlex.quote(remote_stage_dir)}", timeout_sec=60)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Stage and deploy the device runtime to a remote SSH target.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    ssh_parser = subparsers.add_parser("ssh", help="deploy the staged runtime to a remote SSH device")
    ssh_parser.add_argument("--request", default="")
    ssh_parser.add_argument("--host", required=True)
    ssh_parser.add_argument("--port", type=int, default=22)
    ssh_parser.add_argument("--user", required=True)
    ssh_parser.add_argument("--password", required=True)
    ssh_parser.add_argument("--runtime-root", default=paths.DEFAULT_RUNTIME_ROOT)
    ssh_parser.add_argument("--runtime-user", default=paths.DEFAULT_RUNTIME_USER)
    ssh_parser.add_argument("--runtime-group", default=paths.DEFAULT_RUNTIME_GROUP)
    ssh_parser.add_argument("--unit-directory", default="/etc/systemd/system")
    ssh_parser.add_argument("--config-dir", default="")
    ssh_parser.add_argument("--cloud-bridge-url", default="")
    ssh_parser.add_argument("--transport-mode", default="edge", choices=["edge", "cloud"])
    ssh_parser.add_argument("--http-port", type=int, default=8080)
    ssh_parser.add_argument("--start-mode", default="all", choices=["core", "all"])
    ssh_parser.add_argument("--remote-stage-dir", default="")
    ssh_parser.add_argument("--artifact-source", choices=["local", "cloud"], default="local")
    ssh_parser.add_argument("--artifact-platform", default=paths.DEFAULT_ARM64_PLATFORM)
    ssh_parser.add_argument("--artifact-download-root", default="")
    ssh_parser.add_argument("--package-metadata", default=str(paths.PACKAGE_METADATA_PATH))
    ssh_parser.add_argument("--cloud-api-base-url", default="")
    ssh_parser.add_argument("--cloud-api-token", default="")
    ssh_parser.add_argument("--device-id", default="")
    ssh_parser.add_argument("--package-download-path", default="")
    ssh_parser.add_argument("--skip-build", action="store_true")
    ssh_parser.add_argument("--keep-stage", action="store_true")
    ssh_parser.set_defaults(func=cmd_ssh)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
