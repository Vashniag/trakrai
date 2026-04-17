from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import manifests, paths
from .build import build_service_artifact
from .interactive import choose_many, choose_one
from .request_files import apply_request_overrides, load_request_file, require_argument_values
from .utils import find_single_file


METADATA_SCHEMA_VERSION = 2
INITIAL_VERSION = "0.1.0"
CLOUD_API_PACKAGE_DOWNLOAD_PATH = "/api/external/storage/packages/download-session"
CLOUD_API_PACKAGE_UPLOAD_PATH = "/api/external/storage/packages/upload-session"
SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
PACKAGE_FILE_FIELDS = (
    "GoFiles",
    "CgoFiles",
    "CFiles",
    "CXXFiles",
    "MFiles",
    "HFiles",
    "FFiles",
    "SFiles",
    "SwigFiles",
    "SwigCXXFiles",
    "SysoFiles",
    "EmbedFiles",
)
HASH_IGNORE_DIRS = {
    ".git",
    ".next",
    ".turbo",
    ".venv",
    ".pytest_cache",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
}
HASH_IGNORE_SUFFIXES = {".log", ".pyc", ".pyo", ".swp", ".tmp", ".whl"}


@dataclass(frozen=True)
class PackageTarget:
    service: manifests.ServiceManifest

    @property
    def name(self) -> str:
        return self.service.package_name

    @property
    def platform_strategy(self) -> str:
        return self.service.build.platform_strategy

    @property
    def target_type(self) -> str:
        return self.service.kind


TARGETS_BY_NAME = {service.package_name: PackageTarget(service) for service in manifests.load_services()}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_semver(value: str | None) -> tuple[int, int, int]:
    if not value:
        return (0, 0, 0)
    match = SEMVER_RE.match(value.strip())
    if not match:
        raise ValueError(f"invalid semantic version: {value}")
    return tuple(int(group) for group in match.groups())


def bump_patch(value: str | None) -> str:
    if not value:
        return INITIAL_VERSION
    major, minor, patch = parse_semver(value)
    return f"{major}.{minor}.{patch + 1}"


def normalize_platform_tag(platform: str, strategy: str) -> str:
    if strategy == "universal":
        return "universal"
    return platform.replace("/", "-")


def load_metadata(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": METADATA_SCHEMA_VERSION, "updatedAt": "", "packages": {}}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"expected a JSON object in {path}")
    payload.setdefault("schemaVersion", METADATA_SCHEMA_VERSION)
    payload.setdefault("updatedAt", "")
    payload.setdefault("packages", {})
    return payload


def write_metadata(path: Path, metadata: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def decode_json_stream(payload: str) -> list[dict[str, Any]]:
    decoder = json.JSONDecoder()
    index = 0
    objects: list[dict[str, Any]] = []
    while index < len(payload):
        while index < len(payload) and payload[index].isspace():
            index += 1
        if index >= len(payload):
            break
        obj, index = decoder.raw_decode(payload, index)
        if isinstance(obj, dict):
            objects.append(obj)
    return objects


def run_go_list_json(cmd_path: str) -> list[dict[str, Any]]:
    env = os.environ.copy()
    env.setdefault("GOOS", "linux")
    env.setdefault("GOARCH", "arm64")
    proc = subprocess.run(
        ["go", "list", "-deps", "-json", cmd_path],
        cwd=paths.DEVICE_ROOT,
        env=env,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return decode_json_stream(proc.stdout)


def collect_package_files(pkg: dict[str, Any]) -> set[Path]:
    files: set[Path] = set()
    pkg_dir = pkg.get("Dir")
    if not pkg_dir:
        return files
    dir_path = Path(pkg_dir).resolve()
    try:
        dir_path.relative_to(paths.DEVICE_ROOT)
    except ValueError:
        return files
    for field in PACKAGE_FILE_FIELDS:
        for name in pkg.get(field, []) or []:
            files.add((dir_path / name).resolve())
    return files


def compute_go_source_hash(service: manifests.ServiceManifest) -> tuple[str, list[str]]:
    files: set[Path] = set()
    for pkg in run_go_list_json(service.build.cmd_path):
        files.update(collect_package_files(pkg))
    files.add((paths.DEVICE_ROOT / "go.mod").resolve())
    files.add((paths.DEVICE_ROOT / "go.sum").resolve())
    files.add((paths.DEVICE_ROOT / service.build.dockerfile).resolve())
    return hash_paths(files, paths.REPO_ROOT)


def iter_files_for_hash(root: Path) -> list[Path]:
    if root.is_file():
        return [root.resolve()]
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if path.is_dir():
            continue
        if any(part in HASH_IGNORE_DIRS for part in path.parts):
            continue
        if path.suffix in HASH_IGNORE_SUFFIXES:
            continue
        files.append(path.resolve())
    return files


def hash_paths(paths_to_hash: set[Path], relative_root: Path) -> tuple[str, list[str]]:
    rel_paths = sorted(str(path.relative_to(relative_root)).replace("\\", "/") for path in paths_to_hash)
    hasher = hashlib.sha256()
    for rel_path in rel_paths:
        hasher.update(rel_path.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update((relative_root / rel_path).read_bytes())
    return f"sha256:{hasher.hexdigest()}", rel_paths


def compute_recursive_source_hash(service: manifests.ServiceManifest) -> tuple[str, list[str]]:
    files: set[Path] = set()
    if service.is_python:
        files.update(iter_files_for_hash(paths.DEVICE_PYTHON_ROOT / service.build.package_dir))
        shared_runtime = paths.DEVICE_PYTHON_ROOT / "trakrai_service_runtime"
        if shared_runtime.exists():
            files.update(iter_files_for_hash(shared_runtime))
        if paths.PYTHON_GENERATED_CONFIG_ROOT.exists():
            for support_name in ("__init__.py", "_runtime.py"):
                support_path = paths.PYTHON_GENERATED_CONFIG_ROOT / support_name
                if support_path.exists():
                    files.add(support_path.resolve())
            generated_config = service.generated_python_config_file
            if generated_config is not None and generated_config.exists():
                files.add(generated_config.resolve())
        files.add((paths.DEVICE_PYTHON_ROOT / service.build.dockerfile).resolve())
    elif service.is_ui_bundle:
        for root in (
            paths.WEB_DEVICE_APP_ROOT / "src",
            paths.WEB_ROOT / "packages",
            paths.WEB_ROOT / "package.json",
            paths.WEB_ROOT / "pnpm-lock.yaml",
            paths.WEB_ROOT / "pnpm-workspace.yaml",
            paths.WEB_ROOT / "turbo.json",
            paths.WEB_ROOT / service.build.dockerfile,
        ):
            files.update(iter_files_for_hash(root))
    else:
        files.update(iter_files_for_hash(service.build.context_path))
    return hash_paths(files, paths.REPO_ROOT)


def compute_source_hash(service: manifests.ServiceManifest) -> tuple[str, list[str]]:
    if service.is_go_binary:
        return compute_go_source_hash(service)
    return compute_recursive_source_hash(service)


def compute_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def artifact_output_root(platform_tag: str) -> Path:
    return paths.DEVICE_ROOT / "out" / "package-release" / platform_tag


def current_git_commit() -> str:
    proc = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=paths.REPO_ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return proc.stdout.strip() or "unknown"


def build_artifact(service: manifests.ServiceManifest, version: str, platform: str, built_at: str) -> Path:
    del built_at
    artifact = build_service_artifact(service, platform=platform)
    platform_tag = normalize_platform_tag(platform, service.build.platform_strategy)
    output_dir = artifact_output_root(platform_tag) / service.package_name
    output_dir.mkdir(parents=True, exist_ok=True)
    if service.is_go_binary:
        artifact_name = f"{service.package_name}-{platform_tag}-v{version}"
    elif service.is_python:
        artifact_name = artifact.name
    else:
        artifact_name = f"{service.package_name}-v{version}.zip"
    destination = output_dir / artifact_name
    shutil.copy2(artifact, destination)
    if service.is_python:
        wheelhouse_dir = artifact.parent / "wheelhouse"
        if wheelhouse_dir.exists():
            target_wheelhouse = output_dir / "wheelhouse"
            if target_wheelhouse.exists():
                shutil.rmtree(target_wheelhouse)
            shutil.copytree(wheelhouse_dir, target_wheelhouse)
    return destination


def guess_content_type(artifact_path: Path) -> str:
    if artifact_path.suffix == ".zip":
        return "application/zip"
    return "application/octet-stream"


def cloud_api_request_json(base_url: str, request_path: str, payload: dict[str, Any], *, auth_token: str) -> dict[str, Any]:
    request = urllib.request.Request(
        urllib.parse.urljoin(base_url.rstrip("/") + "/", request_path.lstrip("/")),
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    if auth_token.strip():
        request.add_header("Authorization", f"Bearer {auth_token.strip()}")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"cloud API request failed for {request_path}: HTTP {exc.code}: {detail}") from exc


def publish_via_cloud_api(base_url: str, remote_path: str, artifact_path: Path, *, auth_token: str) -> None:
    presigned = cloud_api_request_json(
        base_url,
        CLOUD_API_PACKAGE_UPLOAD_PATH,
        {"contentType": guess_content_type(artifact_path), "path": remote_path},
        auth_token=auth_token,
    )
    request = urllib.request.Request(
        presigned["url"],
        data=artifact_path.read_bytes(),
        method=str(presigned.get("method", "PUT")).upper(),
        headers={**presigned.get("headers", {}), "Content-Type": guess_content_type(artifact_path)},
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        if response.status >= 300:
            raise SystemExit(f"cloud package upload failed for {remote_path}: HTTP {response.status}")


def download_via_cloud_api(
    base_url: str,
    remote_path: str,
    destination_path: Path,
    *,
    auth_token: str,
    device_id: str,
    request_path: str = CLOUD_API_PACKAGE_DOWNLOAD_PATH,
    expected_sha256: str = "",
) -> Path:
    presigned = cloud_api_request_json(
        base_url,
        request_path,
        {"deviceId": device_id, "path": remote_path},
        auth_token=auth_token,
    )
    request = urllib.request.Request(
        presigned["url"],
        method=str(presigned.get("method", "GET")).upper(),
        headers=presigned.get("headers", {}),
    )
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(request, timeout=300) as response:
        with destination_path.open("wb") as handle:
            shutil.copyfileobj(response, handle)
    if expected_sha256:
        actual = compute_sha256(destination_path)
        if actual.lower() != expected_sha256.strip().lower():
            destination_path.unlink(missing_ok=True)
            raise SystemExit(f"cloud package download SHA-256 mismatch for {remote_path}")
    return destination_path


def upload_s3_object(bucket: str, key: str, artifact_path: Path, region: str) -> None:
    if importlib.util.find_spec("boto3") is None:
        raise SystemExit("publish-target s3 requires boto3 in the current Python environment")
    import boto3  # type: ignore

    client = boto3.client("s3", region_name=region or None)
    client.upload_file(str(artifact_path), bucket, key)


def publish_artifact(
    publish_target: str,
    remote_path: str,
    artifact_path: Path,
    *,
    cloud_api_base_url: str,
    cloud_api_token: str,
    package_prefix: str,
    s3_bucket: str,
    s3_region: str,
) -> None:
    if publish_target == "none":
        return
    if publish_target == "cloud-api":
        publish_via_cloud_api(cloud_api_base_url, remote_path, artifact_path, auth_token=cloud_api_token)
        return
    if publish_target == "s3":
        if not s3_bucket.strip():
            raise SystemExit("--s3-bucket is required for publish-target s3")
        key = f"{package_prefix.strip('/')}/{remote_path}".strip("/")
        upload_s3_object(s3_bucket, key, artifact_path, s3_region)
        return
    raise SystemExit(f"unsupported publish target: {publish_target}")


def target_names_from_args(package_names: list[str]) -> list[str]:
    if not package_names:
        return sorted(TARGETS_BY_NAME)
    unknown = sorted(name for name in package_names if name not in TARGETS_BY_NAME)
    if unknown:
        raise SystemExit(f"unknown package(s): {', '.join(unknown)}")
    return package_names


def plan_targets(metadata: dict[str, Any], package_names: list[str], forced_names: set[str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    planned: list[dict[str, Any]] = []
    next_metadata = json.loads(json.dumps(metadata))
    next_packages = next_metadata.setdefault("packages", {})
    metadata_changed = False
    for name in target_names_from_args(package_names):
        target = TARGETS_BY_NAME[name]
        source_hash, source_inputs = compute_source_hash(target.service)
        existing = next_packages.get(name, {}) if isinstance(next_packages.get(name), dict) else {}
        previous_hash = str(existing.get("sourceHash", "")).strip()
        previous_version = str(existing.get("version", "")).strip()
        hash_changed = source_hash != previous_hash
        forced = name in forced_names
        version = previous_version or INITIAL_VERSION
        if hash_changed:
            version = bump_patch(previous_version)
        next_entry = {
            "artifacts": existing.get("artifacts", {}) if isinstance(existing.get("artifacts"), dict) else {},
            "buildTarget": target.target_type,
            "history": existing.get("history", []) if isinstance(existing.get("history"), list) else [],
            "kind": target.service.kind,
            "serviceName": target.service.name,
            "sourceHash": source_hash,
            "sourceInputs": source_inputs,
            "targetType": target.target_type,
            "version": version,
        }
        if hash_changed:
            next_entry["artifacts"] = {}
        next_packages[name] = next_entry
        if existing != next_entry:
            metadata_changed = True
        if hash_changed or forced:
            planned.append(
                {
                    "forced": forced,
                    "hashChanged": hash_changed,
                    "name": name,
                    "platformStrategy": target.platform_strategy,
                    "previousVersion": previous_version,
                    "serviceName": target.service.name,
                    "sourceHash": source_hash,
                    "targetType": target.target_type,
                    "version": version,
                }
            )
    if metadata_changed:
        next_metadata["updatedAt"] = utc_now_iso()
    return planned, next_metadata


def _history_entries_for(metadata: dict[str, Any], package_name: str, platform: str) -> list[dict[str, Any]]:
    package_record = metadata.get("packages", {}).get(package_name)
    if not isinstance(package_record, dict):
        return []
    entries = package_record.get("history", [])
    if not isinstance(entries, list):
        return []
    filtered = [entry for entry in entries if isinstance(entry, dict) and entry.get("platform") == platform]
    filtered.sort(key=lambda item: str(item.get("updatedAt", "")), reverse=True)
    return filtered


def artifact_record_for_package(
    metadata: dict[str, Any],
    package_name: str,
    platform: str,
    *,
    version: str = "",
) -> tuple[manifests.ServiceManifest, dict[str, Any], dict[str, Any]]:
    target = TARGETS_BY_NAME[package_name]
    package_record = metadata.get("packages", {}).get(package_name)
    if not isinstance(package_record, dict):
        raise SystemExit(f"package metadata is missing for {package_name}")
    if version:
        for entry in _history_entries_for(metadata, package_name, platform):
            if str(entry.get("version", "")).strip() == version:
                return target.service, package_record, entry
        raise SystemExit(f"no published {platform} artifact recorded for {package_name} version {version}")
    artifacts = package_record.get("artifacts", {})
    artifact_record = artifacts.get(platform) if isinstance(artifacts, dict) else None
    if not isinstance(artifact_record, dict):
        raise SystemExit(f"no published {platform} artifact recorded for {package_name}")
    artifact_record = {**artifact_record, "version": package_record.get("version", "")}
    return target.service, package_record, artifact_record


def ensure_downloaded_wheel_dependencies(service: manifests.ServiceManifest, wheel_path: Path) -> list[Path]:
    if not service.is_python or not service.build.build_wheelhouse:
        return []
    wheelhouse_dir = wheel_path.parent / "wheelhouse"
    if wheelhouse_dir.exists():
        return sorted(wheelhouse_dir.glob("*.whl"))
    return []


def download_release_artifacts(
    *,
    metadata_path: Path,
    package_names: list[str],
    platform: str,
    cloud_api_base_url: str,
    cloud_api_token: str,
    device_id: str,
    package_download_path: str = CLOUD_API_PACKAGE_DOWNLOAD_PATH,
    output_root: Path | None = None,
    version: str = "",
) -> dict[str, Path]:
    metadata = load_metadata(metadata_path)
    selected_names = target_names_from_args(package_names)
    download_root = (output_root or (paths.DEVICE_ROOT / "out" / "package-downloads" / normalize_platform_tag(platform, "platform"))).resolve()
    resolved: dict[str, Path] = {}
    for name in selected_names:
        service, _package_record, artifact_record = artifact_record_for_package(metadata, name, platform, version=version)
        remote_path = str(artifact_record["remotePath"])
        file_name = str(artifact_record["fileName"])
        expected_sha = str(artifact_record.get("sha256", "")).strip()
        destination = download_root / name / file_name
        downloaded = download_via_cloud_api(
            cloud_api_base_url,
            remote_path,
            destination,
            auth_token=cloud_api_token,
            device_id=device_id,
            request_path=package_download_path,
            expected_sha256=expected_sha,
        )
        ensure_downloaded_wheel_dependencies(service, downloaded)
        resolved[name] = downloaded
    return resolved


def cmd_plan(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["metadata", "package", "force_package", "json_out"])
    metadata = load_metadata(Path(args.metadata).resolve())
    planned, next_metadata = plan_targets(metadata, args.package or [], set(args.force_package or []))
    payload = {"changed": planned, "metadataPath": str(Path(args.metadata).resolve()), "nextMetadata": next_metadata}
    if args.json_out:
        Path(args.json_out).resolve().write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


def cmd_release(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(
        args,
        request,
        [
            "metadata",
            "package",
            "force_package",
            "platform",
            "publish_target",
            "cloud_api_base_url",
            "cloud_api_token",
            "package_prefix",
            "manifest_out",
            "write_metadata",
            "s3_bucket",
            "s3_region",
        ],
    )
    metadata_path = Path(args.metadata).resolve()
    metadata = load_metadata(metadata_path)
    planned, next_metadata = plan_targets(metadata, args.package or [], set(args.force_package or []))
    built_at = utc_now_iso()
    release_manifest: dict[str, Any] = {
        "builtAt": built_at,
        "changed": [],
        "metadataPath": str(metadata_path),
        "platform": args.platform,
        "publishTarget": args.publish_target,
    }
    for item in planned:
        target = TARGETS_BY_NAME[item["name"]]
        artifact_path = build_artifact(target.service, item["version"], args.platform, built_at)
        artifact_sha = compute_sha256(artifact_path)
        artifact_platform = normalize_platform_tag(args.platform, target.platform_strategy)
        remote_path = f"{item['name']}/{item['version']}/{artifact_platform}/{artifact_path.name}"
        publish_artifact(
            args.publish_target,
            remote_path,
            artifact_path,
            cloud_api_base_url=args.cloud_api_base_url,
            cloud_api_token=args.cloud_api_token,
            package_prefix=args.package_prefix,
            s3_bucket=args.s3_bucket,
            s3_region=args.s3_region,
        )
        package_record = next_metadata["packages"][item["name"]]
        artifacts = package_record.setdefault("artifacts", {})
        artifacts[args.platform] = {
            "fileName": artifact_path.name,
            "remotePath": remote_path,
            "sha256": artifact_sha,
            "updatedAt": built_at,
        }
        history = package_record.setdefault("history", [])
        history.append(
            {
                "fileName": artifact_path.name,
                "platform": args.platform,
                "remotePath": remote_path,
                "sha256": artifact_sha,
                "updatedAt": built_at,
                "version": item["version"],
            }
        )
        release_manifest["changed"].append(
            {
                **item,
                "artifactPath": str(artifact_path),
                "fileName": artifact_path.name,
                "platform": args.platform,
                "remotePath": remote_path,
                "sha256": artifact_sha,
            }
        )
    if args.write_metadata:
        write_metadata(metadata_path, next_metadata)
    manifest_out = (
        Path(args.manifest_out).resolve()
        if args.manifest_out
        else artifact_output_root(normalize_platform_tag(args.platform, "platform")) / "release-manifest.json"
    )
    manifest_out.parent.mkdir(parents=True, exist_ok=True)
    manifest_out.write_text(json.dumps(release_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(release_manifest, indent=2, sort_keys=True))
    return 0


def cmd_pull(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(
        args,
        request,
        [
            "metadata",
            "package",
            "platform",
            "cloud_api_base_url",
            "cloud_api_token",
            "device_id",
            "package_download_path",
            "output_root",
            "json_out",
            "version",
            "interactive",
        ],
    )
    require_argument_values(args, {"cloud_api_base_url": "--cloud-api-base-url", "device_id": "--device-id"})
    metadata_path = Path(args.metadata).resolve()
    metadata = load_metadata(metadata_path)
    selected_packages = list(args.package or [])
    if args.interactive or not selected_packages:
        package_options = target_names_from_args(selected_packages or [])
        if not selected_packages:
            package_options = sorted(TARGETS_BY_NAME)
        selected_packages = choose_many("Select packages to pull", package_options)
    selected_version = args.version
    if args.interactive and len(selected_packages) == 1 and not selected_version:
        history = _history_entries_for(metadata, selected_packages[0], args.platform)
        versions = [str(entry.get("version", "")).strip() for entry in history if str(entry.get("version", "")).strip()]
        if versions:
            selected_version = choose_one("Select version to pull", versions)
    resolved_paths = download_release_artifacts(
        metadata_path=metadata_path,
        package_names=selected_packages,
        platform=args.platform,
        cloud_api_base_url=args.cloud_api_base_url,
        cloud_api_token=args.cloud_api_token,
        device_id=args.device_id,
        package_download_path=args.package_download_path,
        output_root=Path(args.output_root).resolve() if args.output_root else None,
        version=selected_version,
    )
    payload = {
        "downloaded": {
            name: {"path": str(path), "sha256": compute_sha256(path)}
            for name, path in sorted(resolved_paths.items())
        },
        "metadataPath": str(metadata_path),
        "platform": args.platform,
        "version": selected_version or "latest",
    }
    if args.json_out:
        Path(args.json_out).resolve().write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["metadata", "platform"])
    metadata = load_metadata(Path(args.metadata).resolve())
    rows = []
    for name in sorted(TARGETS_BY_NAME):
        try:
            _service, package_record, artifact = artifact_record_for_package(metadata, name, args.platform)
            rows.append(
                {
                    "package": name,
                    "version": package_record.get("version", ""),
                    "remotePath": artifact.get("remotePath", ""),
                    "sha256": artifact.get("sha256", ""),
                }
            )
        except SystemExit:
            rows.append({"package": name, "version": "", "remotePath": "", "sha256": ""})
    print(json.dumps({"packages": rows, "platform": args.platform}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build, version, publish, and pull device packages.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    common_parent = argparse.ArgumentParser(add_help=False)
    common_parent.add_argument("--metadata", default=str(paths.PACKAGE_METADATA_PATH))
    common_parent.add_argument("--package", action="append", help="package name to include; defaults to all packages")
    common_parent.add_argument("--request", default="")

    plan_parser = subparsers.add_parser("plan", parents=[common_parent], help="discover changed packages and planned versions")
    plan_parser.add_argument("--force-package", action="append", help="package name to rebuild even if the source hash did not change")
    plan_parser.add_argument("--json-out", default="")
    plan_parser.set_defaults(func=cmd_plan)

    release_parser = subparsers.add_parser("release", parents=[common_parent], help="build changed packages, publish them, and update package metadata")
    release_parser.add_argument("--force-package", action="append")
    release_parser.add_argument("--platform", default=paths.DEFAULT_ARM64_PLATFORM)
    release_parser.add_argument("--publish-target", choices=["none", "cloud-api", "s3"], default="none")
    release_parser.add_argument("--cloud-api-base-url", default="http://127.0.0.1:3000")
    release_parser.add_argument("--cloud-api-token", default="")
    release_parser.add_argument("--package-prefix", default=paths.DEFAULT_PACKAGE_PREFIX)
    release_parser.add_argument("--manifest-out", default="")
    release_parser.add_argument("--no-write-metadata", action="store_false", dest="write_metadata")
    release_parser.add_argument("--s3-bucket", default=os.environ.get("TRAKRAI_PACKAGE_S3_BUCKET", ""))
    release_parser.add_argument("--s3-region", default=os.environ.get("AWS_REGION", ""))
    release_parser.set_defaults(func=cmd_release, write_metadata=True)

    pull_parser = subparsers.add_parser("pull", parents=[common_parent], help="download published packages from the cloud artifact repo using device credentials")
    pull_parser.add_argument("--platform", default=paths.DEFAULT_ARM64_PLATFORM)
    pull_parser.add_argument("--cloud-api-base-url", default="")
    pull_parser.add_argument("--cloud-api-token", default="")
    pull_parser.add_argument("--device-id", default="")
    pull_parser.add_argument("--package-download-path", default=CLOUD_API_PACKAGE_DOWNLOAD_PATH)
    pull_parser.add_argument("--output-root", default="")
    pull_parser.add_argument("--json-out", default="")
    pull_parser.add_argument("--version", default="")
    pull_parser.add_argument("--interactive", action="store_true")
    pull_parser.set_defaults(func=cmd_pull)

    list_parser = subparsers.add_parser("list", parents=[common_parent], help="show tracked package versions for a platform")
    list_parser.add_argument("--platform", default=paths.DEFAULT_ARM64_PLATFORM)
    list_parser.set_defaults(func=cmd_list)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
