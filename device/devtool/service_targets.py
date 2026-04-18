from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
import shlex

from . import manifests, paths
from .local import compose_env, run_compose
from .packages import (
    CLOUD_API_PACKAGE_DOWNLOAD_PATH,
    artifact_record_for_package,
    compute_sha256,
    download_release_artifacts,
    load_metadata,
    publish_artifact,
)
from .ssh_transport import ExpectSSHClient
from .utils import DEFAULT_LOCAL_PLATFORM


@dataclass(frozen=True)
class LocalArtifactReference:
    local_path: Path
    sha256: str


@dataclass(frozen=True)
class RemoteArtifactReference:
    remote_path: str
    sha256: str


def copy_artifact_to_local_runtime(service_name: str, artifact_path: Path, *, runtime_root: str) -> LocalArtifactReference:
    destination = paths.LOCALDEV_SHARED_ROOT / "package-downloads" / service_name / artifact_path.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(artifact_path.read_bytes())
    target_path = Path(runtime_root) / "shared" / "package-downloads" / service_name / artifact_path.name
    return LocalArtifactReference(local_path=target_path, sha256=compute_sha256(destination))


def copy_artifact_to_ssh_runtime(
    ssh: ExpectSSHClient,
    service_name: str,
    artifact_path: Path,
    *,
    runtime_root: str,
) -> LocalArtifactReference:
    remote_directory = f"{runtime_root}/shared/package-downloads/{service_name}"
    ssh.run(f"mkdir -p {shlex.quote(remote_directory)}", timeout_sec=60)
    remote_path = f"{remote_directory}/{artifact_path.name}"
    ssh.upload_file(artifact_path, remote_path, timeout_sec=300)
    return LocalArtifactReference(local_path=Path(remote_path), sha256=compute_sha256(artifact_path))


def publish_dev_artifact(
    service: manifests.ServiceManifest,
    artifact_path: Path,
    *,
    publish_target: str,
    platform: str,
    cloud_api_base_url: str,
    cloud_api_token: str,
    package_prefix: str,
    s3_bucket: str,
    s3_region: str,
) -> RemoteArtifactReference:
    remote_path = (
        f"dev-service-updates/{service.package_name}/"
        f"{int(time.time())}-{compute_sha256(artifact_path)[:12]}/"
        f"{platform.replace('/', '-')}/{artifact_path.name}"
    )
    publish_artifact(
        publish_target,
        remote_path,
        artifact_path,
        cloud_api_base_url=cloud_api_base_url,
        cloud_api_token=cloud_api_token,
        package_prefix=package_prefix,
        s3_bucket=s3_bucket,
        s3_region=s3_region,
    )
    return RemoteArtifactReference(remote_path=remote_path, sha256=compute_sha256(artifact_path))


def resolve_release_artifact_reference(
    service: manifests.ServiceManifest,
    *,
    metadata_path: Path,
    platform: str,
    version: str,
) -> RemoteArtifactReference:
    metadata = load_metadata(metadata_path)
    _service, _package_record, artifact = artifact_record_for_package(metadata, service.package_name, platform, version=version)
    return RemoteArtifactReference(remote_path=str(artifact["remotePath"]), sha256=str(artifact.get("sha256", "")))


def download_release_artifact_to_local(
    service: manifests.ServiceManifest,
    *,
    metadata_path: Path,
    platform: str,
    cloud_api_base_url: str,
    cloud_api_token: str,
    device_id: str,
    output_root: Path,
    version: str,
    package_download_path: str = CLOUD_API_PACKAGE_DOWNLOAD_PATH,
) -> Path:
    downloaded = download_release_artifacts(
        metadata_path=metadata_path,
        package_names=[service.package_name],
        platform=platform,
        cloud_api_base_url=cloud_api_base_url,
        cloud_api_token=cloud_api_token,
        device_id=device_id,
        package_download_path=package_download_path,
        output_root=output_root,
        version=version,
    )
    return downloaded[service.package_name]


def run_control_plane_update_in_emulator(*, package: str, metadata_path: Path, platform: str) -> None:
    env = compose_env("trakrai-local-device", DEFAULT_LOCAL_PLATFORM)
    target_metadata = paths.LOCALDEV_SHARED_ROOT / "control-plane-updates" / metadata_path.name
    target_metadata.parent.mkdir(parents=True, exist_ok=True)
    target_metadata.write_text(metadata_path.read_text(encoding="utf-8"), encoding="utf-8")
    remote_metadata = f"{paths.DEFAULT_RUNTIME_ROOT}/shared/control-plane-updates/{metadata_path.name}"
    run_compose(
        [
            "exec",
            "-T",
            "device-emulator",
            "python3",
            f"{paths.DEFAULT_RUNTIME_ROOT}/scripts/update_control_plane.py",
            "--packages",
            package,
            "--platform",
            platform,
            "--metadata-path",
            remote_metadata,
        ],
        env=env,
    )
