from __future__ import annotations

import argparse
import json
import os
import shlex
import tempfile
import urllib.parse
from pathlib import Path
from typing import Any

from . import manifests, paths
from .build import resolve_local_artifacts
from .interactive import choose_one
from .packages import CLOUD_API_PACKAGE_DOWNLOAD_PATH
from .python_support import iter_python_runtime_support_files
from .request_files import apply_request_overrides, load_request_file, require_argument_values
from .runtime_client import RuntimeWsClient
from .runtime_ssh_client import SSHRuntimeClient, SSHRuntimeConnection
from .service_configs import build_service_config_payload, relevant_config_names
from .service_definitions import (
    build_service_definition,
    definition_from_message,
    envelope_payload,
    runtime_layout_from_messages,
    service_snapshots_by_name,
    desired_enabled,
)
from .service_targets import (
    copy_artifact_to_local_runtime,
    copy_artifact_to_ssh_runtime,
    download_release_artifact_to_local,
    publish_dev_artifact,
    resolve_release_artifact_reference,
    run_control_plane_update_in_emulator,
)
from .ssh_transport import ExpectSSHClient, SSHConnectionInfo


DEFAULT_RUNTIME_URL = "ws://127.0.0.1:18080/ws"
DEFAULT_SSH_RUNTIME_URL = "ws://127.0.0.1:8080/ws"


def response_type(message: dict[str, Any]) -> str:
    envelope = message.get("envelope")
    if not isinstance(envelope, dict):
        return ""
    return str(envelope.get("type", "")).strip()


def require_success(message: dict[str, Any]) -> dict[str, Any]:
    payload = envelope_payload(message)
    if response_type(message) == "runtime-manager-error":
        raise SystemExit(str(payload.get("error", "runtime-manager request failed")).strip() or "runtime-manager request failed")
    return payload


def optional_definition(client: Any, service_name: str) -> dict[str, Any] | None:
    message = client.get_service_definition(service_name)
    if response_type(message) == "runtime-manager-error":
        payload = envelope_payload(message)
        error = str(payload.get("error", "")).strip()
        if "not configured" in error:
            return None
        raise SystemExit(error or f"failed to load definition for {service_name}")
    return definition_from_message(message)


def fetch_existing_configs(client: Any, service_name: str) -> dict[str, dict[str, Any]]:
    config_map: dict[str, dict[str, Any]] = {}
    for config_name in relevant_config_names(service_name):
        message = client.get_config(config_name)
        if response_type(message) == "runtime-manager-error":
            payload = envelope_payload(message)
            error = str(payload.get("error", "")).strip()
            if "does not exist" in error:
                continue
            raise SystemExit(error or f"failed to load {config_name}")
        payload = require_success(message)
        content = payload.get("content")
        if isinstance(content, dict):
            config_map[config_name] = content
    return config_map


def resolve_cloud_api_base_url(args: argparse.Namespace, existing_configs: dict[str, dict[str, Any]]) -> str:
    if str(args.cloud_api_base_url).strip():
        return normalize_host_cloud_api_base_url(str(args.cloud_api_base_url).strip().rstrip("/"))
    cloud_transfer = existing_configs.get("cloud-transfer.json", {})
    cloud_api = cloud_transfer.get("cloud_api") if isinstance(cloud_transfer.get("cloud_api"), dict) else {}
    return normalize_host_cloud_api_base_url(str(cloud_api.get("base_url", "")).strip().rstrip("/"))


def resolve_cloud_api_token(args: argparse.Namespace, existing_configs: dict[str, dict[str, Any]]) -> str:
    if str(args.cloud_api_token).strip():
        return str(args.cloud_api_token)
    cloud_transfer = existing_configs.get("cloud-transfer.json", {})
    cloud_api = cloud_transfer.get("cloud_api") if isinstance(cloud_transfer.get("cloud_api"), dict) else {}
    return str(cloud_api.get("access_token", "")).strip()


def resolve_device_id(args: argparse.Namespace, existing_configs: dict[str, dict[str, Any]]) -> str:
    if str(args.device_id).strip():
        return str(args.device_id).strip()
    cloud_transfer = existing_configs.get("cloud-transfer.json", {})
    cloud_comm = existing_configs.get("cloud-comm.json", {})
    return str(cloud_transfer.get("device_id") or cloud_comm.get("device_id") or paths.DEFAULT_LOCAL_DEVICE_ID).strip()


def normalize_host_cloud_api_base_url(base_url: str) -> str:
    normalized = str(base_url).strip().rstrip("/")
    if not normalized:
        return ""
    parsed = urllib.parse.urlparse(normalized)
    hostname = (parsed.hostname or "").strip().lower()
    if hostname not in {"host.docker.internal", "cloud-api"}:
        return normalized
    scheme = parsed.scheme or "http"
    port = parsed.port or (443 if scheme == "https" else 80)
    path = parsed.path.rstrip("/")
    return urllib.parse.urlunparse((scheme, f"127.0.0.1:{port}", path, "", "", ""))


def resolve_runtime_url(target: str, raw_url: str) -> str:
    url = str(raw_url).strip()
    if url:
        return url
    if target == "ssh":
        return DEFAULT_SSH_RUNTIME_URL
    return DEFAULT_RUNTIME_URL


def open_target_runtime(
    args: argparse.Namespace,
    *,
    runtime_url: str,
) -> tuple[Any, ExpectSSHClient | None]:
    if args.target == "ssh":
        require_argument_values(args, {"host": "--host", "user": "--user", "password": "--password"})
        ssh_runtime = SSHRuntimeClient(
            SSHRuntimeConnection(
                host=args.host,
                user=args.user,
                password=args.password,
                port=args.port,
                url=runtime_url,
                device_id=args.device_id,
                timeout_sec=args.timeout_sec,
            )
        )
        return ssh_runtime, ssh_runtime.ssh
    return RuntimeWsClient(runtime_url, device_id=args.device_id, timeout_sec=args.timeout_sec), None


def final_service_snapshot(client: Any, service_name: str, *, timeout_sec: float) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    status_message = client.get_status(timeout_sec=timeout_sec)
    status_payload = require_success(status_message)
    snapshots = service_snapshots_by_name(status_message)
    snapshot = snapshots.get(service_name)
    if isinstance(snapshot, dict):
        return snapshot, status_payload
    return None, status_payload


def resolve_local_artifact(service: manifests.ServiceManifest, args: argparse.Namespace) -> Path:
    artifacts = resolve_local_artifacts(
        service_names=[service.name],
        skip_build=args.skip_build,
        platform=args.platform,
        require_ui=True,
        build_ui_if_missing=not args.skip_ui_build,
    )
    return artifacts[service.name]


def build_control_plane_metadata(
    service: manifests.ServiceManifest,
    *,
    platform: str,
    remote_path: str,
    artifact_sha256: str,
    artifact_name: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "updatedAt": "",
        "packages": {
            service.package_name: {
                "artifacts": {
                    platform: {
                        "fileName": artifact_name,
                        "remotePath": remote_path,
                        "sha256": artifact_sha256,
                    }
                },
                "history": [],
                "kind": service.kind,
                "serviceName": service.name,
                "sourceHash": "",
                "sourceInputs": [],
                "targetType": service.kind,
                "version": "dev",
            }
        },
    }


def push_control_plane_service(service: manifests.ServiceManifest, args: argparse.Namespace) -> int:
    if args.target not in {"emulator", "ssh"}:
        raise SystemExit(f"{service.name} updates require target emulator or ssh")

    if args.artifact_source == "local":
        if not str(args.cloud_api_base_url).strip():
            raise SystemExit(f"{service.name} local updates require --cloud-api-base-url to publish the artifact")
        artifact_path = resolve_local_artifact(service, args)
        remote = publish_dev_artifact(
            service,
            artifact_path,
            publish_target=args.publish_target,
            platform=args.platform,
            cloud_api_base_url=args.cloud_api_base_url,
            cloud_api_token=args.cloud_api_token,
            package_prefix=args.package_prefix,
            s3_bucket=args.s3_bucket,
            s3_region=args.s3_region,
        )
        metadata = build_control_plane_metadata(
            service,
            platform=args.platform,
            remote_path=remote.remote_path,
            artifact_sha256=remote.sha256,
            artifact_name=artifact_path.name,
        )
    else:
        remote = resolve_release_artifact_reference(
            service,
            metadata_path=Path(args.metadata).resolve(),
            platform=args.platform,
            version=args.version,
        )
        artifact_name = Path(remote.remote_path).name
        metadata = build_control_plane_metadata(
            service,
            platform=args.platform,
            remote_path=remote.remote_path,
            artifact_sha256=remote.sha256,
            artifact_name=artifact_name,
        )

    with tempfile.TemporaryDirectory(prefix="trakrai-control-plane-") as tmp_dir_name:
        metadata_path = Path(tmp_dir_name) / "package-versions.json"
        metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if args.target == "emulator":
            run_control_plane_update_in_emulator(
                package=service.package_name,
                metadata_path=metadata_path,
                platform=args.platform,
            )
        else:
            require_argument_values(args, {"host": "--host", "user": "--user", "password": "--password"})
            ssh = ExpectSSHClient(SSHConnectionInfo(host=args.host, user=args.user, password=args.password, port=args.port))
            remote_metadata = f"/tmp/trakrai-{service.package_name}-package-versions.json"
            remote_script = f"/tmp/trakrai-update-control-plane-{service.package_name}.py"
            ssh.upload_file(metadata_path, remote_metadata, timeout_sec=120)
            ssh.upload_file(paths.DEVTOOL_RUNTIME_ASSETS_ROOT / "update_control_plane.py", remote_script, timeout_sec=120)
            command = (
                f"sudo python3 {shlex.quote(remote_script)} "
                f"--runtime-root {shlex.quote(args.runtime_root)} "
                f"--packages {shlex.quote(service.package_name)} "
                f"--platform {shlex.quote(args.platform)} "
                f"--metadata-path {shlex.quote(remote_metadata)}"
            )
            if str(args.cloud_api_base_url).strip():
                command += f" --cloud-api-base-url {shlex.quote(args.cloud_api_base_url)}"
            if str(args.cloud_api_token).strip():
                command += f" --cloud-api-token {shlex.quote(args.cloud_api_token)}"
            if str(args.device_id).strip():
                command += f" --device-id {shlex.quote(args.device_id)}"
            ssh.run(command, timeout_sec=600)
    print(json.dumps({"service": service.name, "target": args.target, "mode": "control-plane-update"}, indent=2))
    return 0


def cmd_push(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(
        args,
        request,
        [
            "service",
            "target",
            "url",
            "device_id",
            "timeout_sec",
            "artifact_source",
            "platform",
            "skip_build",
            "skip_ui_build",
            "metadata",
            "version",
            "cloud_api_base_url",
            "cloud_api_token",
            "package_download_path",
            "publish_target",
            "package_prefix",
            "s3_bucket",
            "s3_region",
            "config_source",
            "config_file",
            "profile",
            "enable",
            "disable",
            "host",
            "port",
            "user",
            "password",
            "runtime_root",
        ],
    )
    if args.interactive and not args.service:
        args.service = choose_one("Select service to push", [service.name for service in manifests.load_services()])
    require_argument_values(args, {"service": "--service"})
    service = manifests.require_service(args.service)
    runtime_url = resolve_runtime_url(args.target, args.url)

    if service.name in {"runtime-manager", "cloud-comm"}:
        return push_control_plane_service(service, args)

    runtime_client, ssh_client = open_target_runtime(args, runtime_url=runtime_url)

    try:
        status_message = runtime_client.get_status(timeout_sec=args.timeout_sec)
        status_payload = require_success(status_message)
        snapshots = service_snapshots_by_name(status_message)
        cloud_comm_definition = require_success(runtime_client.get_service_definition("cloud-comm", timeout_sec=args.timeout_sec))
        layout = runtime_layout_from_messages(status_message, cloud_comm_definition=cloud_comm_definition["definition"])
        existing_definition = optional_definition(runtime_client, service.name)
        existing_configs = fetch_existing_configs(runtime_client, service.name)

        config_payload = build_service_config_payload(
            service.name,
            config_source=args.config_source,
            config_file=args.config_file,
            profile_name=args.profile,
            existing_configs=existing_configs,
        )
        if service.config_name and config_payload is not None:
            existing_config = existing_configs.get(service.config_name)
            if existing_config != config_payload:
                require_success(
                    runtime_client.put_config(
                        service.config_name,
                        config_payload,
                        create_if_missing=service.config_name not in existing_configs,
                        restart_services=[],
                        timeout_sec=args.timeout_sec,
                    )
                )

        enabled = desired_enabled(service, existing_definition=existing_definition, force_enable=args.enable, force_disable=args.disable)

        if service.name not in snapshots:
            seed_enabled = False if enabled and not service.is_ui_bundle else enabled
            require_success(
                runtime_client.upsert_service(
                    build_service_definition(service.name, layout, enabled=seed_enabled),
                    timeout_sec=args.timeout_sec,
                )
            )
        else:
            require_success(
                runtime_client.upsert_service(
                    build_service_definition(service.name, layout, enabled=enabled),
                    timeout_sec=args.timeout_sec,
                )
            )

        if service.is_python:
            for support_file in iter_python_runtime_support_files(service, layout):
                require_success(
                    runtime_client.put_runtime_file(
                        support_file.target_path,
                        support_file.source_path.read_text(encoding="utf-8"),
                        mode=support_file.mode,
                        timeout_sec=args.timeout_sec,
                    )
                )

        if args.artifact_source == "local":
            artifact_path = resolve_local_artifact(service, args)
            if args.target == "runtime":
                cloud_api_base_url = resolve_cloud_api_base_url(args, existing_configs)
                if not cloud_api_base_url:
                    raise SystemExit("runtime target local updates require --cloud-api-base-url or cloud-transfer.json cloud_api.base_url on the target")
                remote = publish_dev_artifact(
                    service,
                    artifact_path,
                    publish_target=args.publish_target,
                    platform=args.platform,
                    cloud_api_base_url=cloud_api_base_url,
                    cloud_api_token=resolve_cloud_api_token(args, existing_configs),
                    package_prefix=args.package_prefix,
                    s3_bucket=args.s3_bucket,
                    s3_region=args.s3_region,
                )
                update_response = runtime_client.update_service(
                    service.name,
                    remote_path=remote.remote_path,
                    artifact_sha256=remote.sha256,
                    timeout_sec=args.timeout_sec,
                )
            elif args.target == "emulator":
                local_ref = copy_artifact_to_local_runtime(service.name, artifact_path, runtime_root=layout.runtime_root)
                update_response = runtime_client.update_service(
                    service.name,
                    local_path=str(local_ref.local_path),
                    artifact_sha256=local_ref.sha256,
                    timeout_sec=args.timeout_sec,
                )
            else:
                assert ssh_client is not None
                local_ref = copy_artifact_to_ssh_runtime(
                    ssh_client,
                    service.name,
                    artifact_path,
                    runtime_root=args.runtime_root,
                )
                update_response = runtime_client.update_service(
                    service.name,
                    local_path=str(local_ref.local_path),
                    artifact_sha256=local_ref.sha256,
                    timeout_sec=args.timeout_sec,
                )
        else:
            metadata_path = Path(args.metadata).resolve()
            if args.target == "runtime":
                remote = resolve_release_artifact_reference(
                    service,
                    metadata_path=metadata_path,
                    platform=args.platform,
                    version=args.version,
                )
                update_response = runtime_client.update_service(
                    service.name,
                    remote_path=remote.remote_path,
                    artifact_sha256=remote.sha256,
                    timeout_sec=args.timeout_sec,
                )
            else:
                cloud_api_base_url = resolve_cloud_api_base_url(args, existing_configs)
                if not cloud_api_base_url:
                    raise SystemExit("release artifact updates require --cloud-api-base-url or cloud-transfer.json cloud_api.base_url on the target")
                artifact_path = download_release_artifact_to_local(
                    service,
                    metadata_path=metadata_path,
                    platform=args.platform,
                    cloud_api_base_url=cloud_api_base_url,
                    cloud_api_token=resolve_cloud_api_token(args, existing_configs),
                    device_id=resolve_device_id(args, existing_configs),
                    output_root=paths.DEVICE_ROOT / "out" / "service-push-downloads",
                    version=args.version,
                    package_download_path=args.package_download_path,
                )
                if args.target == "emulator":
                    local_ref = copy_artifact_to_local_runtime(service.name, artifact_path, runtime_root=layout.runtime_root)
                else:
                    assert ssh_client is not None
                    local_ref = copy_artifact_to_ssh_runtime(
                        ssh_client,
                        service.name,
                        artifact_path,
                        runtime_root=args.runtime_root,
                    )
                update_response = runtime_client.update_service(
                    service.name,
                    local_path=str(local_ref.local_path),
                    artifact_sha256=local_ref.sha256,
                    timeout_sec=args.timeout_sec,
                )

        update_payload = require_success(update_response)

        if service.name not in snapshots and enabled and not service.is_ui_bundle:
            require_success(
                runtime_client.upsert_service(
                    build_service_definition(service.name, layout, enabled=True),
                    timeout_sec=args.timeout_sec,
                )
            )

        start_payload: dict[str, Any] | None = None
        update_service_snapshot = update_payload.get("service") if isinstance(update_payload.get("service"), dict) else {}
        update_state = str(update_service_snapshot.get("state", "")).strip().lower()
        if enabled and service.runtime.allow_control and update_state != "running":
            start_payload = require_success(runtime_client.service_action("start", service.name, timeout_sec=args.timeout_sec))

        final_snapshot, final_status_payload = final_service_snapshot(runtime_client, service.name, timeout_sec=args.timeout_sec)
        if final_snapshot is None and isinstance(start_payload, dict):
            fallback_snapshot = start_payload.get("service")
            if isinstance(fallback_snapshot, dict):
                final_snapshot = fallback_snapshot
        if final_snapshot is None and isinstance(update_service_snapshot, dict):
            final_snapshot = update_service_snapshot

        print(
            json.dumps(
                {
                    "service": service.name,
                    "target": args.target,
                    "url": runtime_url,
                    "artifactSource": args.artifact_source,
                    "configApplied": bool(service.config_name and config_payload is not None),
                    "definitionSynced": True,
                    "pythonSupportSynced": service.is_python,
                    "serviceSnapshot": final_snapshot,
                    "update": update_payload,
                    "startAction": start_payload,
                    "statusGeneratedAt": final_status_payload.get("generatedAt", status_payload.get("generatedAt", "")),
                },
                indent=2,
            )
        )
        return 0
    finally:
        close = getattr(runtime_client, "close", None)
        if callable(close):
            close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m device.devtool service",
        description="Push a single service across emulator/runtime/ssh targets.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    push_parser = subparsers.add_parser("push", help="build, sync config/definition, and update one service")
    push_parser.add_argument("--request", default="")
    push_parser.add_argument("--service", default="")
    push_parser.add_argument("--target", choices=["emulator", "runtime", "ssh"], default="emulator")
    push_parser.add_argument("--url", default="")
    push_parser.add_argument("--device-id", default="")
    push_parser.add_argument("--timeout-sec", type=float, default=30.0)
    push_parser.add_argument("--artifact-source", choices=["local", "release"], default="local")
    push_parser.add_argument("--platform", default=paths.DEFAULT_ARM64_PLATFORM)
    push_parser.add_argument("--skip-build", action="store_true")
    push_parser.add_argument("--skip-ui-build", action="store_true")
    push_parser.add_argument("--metadata", default=str(paths.PACKAGE_METADATA_PATH))
    push_parser.add_argument("--version", default="")
    push_parser.add_argument("--cloud-api-base-url", default="")
    push_parser.add_argument("--cloud-api-token", default="")
    push_parser.add_argument("--package-download-path", default=CLOUD_API_PACKAGE_DOWNLOAD_PATH)
    push_parser.add_argument("--publish-target", choices=["cloud-api", "s3"], default="cloud-api")
    push_parser.add_argument("--package-prefix", default=paths.DEFAULT_PACKAGE_PREFIX)
    push_parser.add_argument("--s3-bucket", default=os.environ.get("TRAKRAI_PACKAGE_S3_BUCKET", ""))
    push_parser.add_argument("--s3-region", default=os.environ.get("AWS_REGION", ""))
    push_parser.add_argument(
        "--config-source",
        choices=["auto", "current", "profile", "sample", "schema", "file", "skip"],
        default="auto",
    )
    push_parser.add_argument("--config-file", default="")
    push_parser.add_argument("--profile", default="")
    push_parser.add_argument("--enable", action="store_true")
    push_parser.add_argument("--disable", action="store_true")
    push_parser.add_argument("--interactive", action="store_true")
    push_parser.add_argument("--host", default="")
    push_parser.add_argument("--port", type=int, default=22)
    push_parser.add_argument("--user", default="")
    push_parser.add_argument("--password", default="")
    push_parser.add_argument("--runtime-root", default=paths.DEFAULT_RUNTIME_ROOT)
    push_parser.set_defaults(func=cmd_push)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
