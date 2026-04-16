#!/usr/bin/env python3
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

import device_runtime_common as common


METADATA_SCHEMA_VERSION = 1
INITIAL_VERSION = "0.1.0"
PACKAGE_METADATA_PATH = common.DEVICE_ROOT / "package-versions.json"
DEFAULT_PACKAGE_PREFIX = "device-packages"
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
HASH_IGNORE_SUFFIXES = {
    ".log",
    ".pyc",
    ".pyo",
    ".swp",
    ".tmp",
    ".whl",
}


@dataclass(frozen=True)
class PackageTarget:
    name: str
    kind: str
    platform_strategy: str
    service_name: str
    source_roots: tuple[Path, ...]
    target_type: str
    cmd_path: str = ""
    dockerfile: str = ""
    wheel_target: common.PythonWheelTarget | None = None


def package_targets() -> tuple[PackageTarget, ...]:
    go_targets = tuple(
        PackageTarget(
            name=service_name,
            kind="binary",
            platform_strategy="platform",
            service_name=service_name,
            source_roots=(common.DEVICE_ROOT,),
            target_type="go-binary",
            cmd_path=cmd_path,
            dockerfile=dockerfile,
        )
        for service_name, dockerfile, cmd_path in common.SERVICE_BUILD_TARGETS
    )
    wheel_targets = tuple(
        PackageTarget(
            name=target.service_name,
            kind="wheel",
            platform_strategy="platform",
            service_name=target.service_name,
            source_roots=(target.context_dir,),
            target_type="python-wheel",
            wheel_target=target,
        )
        for target in common.PYTHON_WHEEL_TARGETS
    )
    ui_target = (
        PackageTarget(
            name="edge-ui",
            kind="zip",
            platform_strategy="universal",
            service_name="edge-ui",
            source_roots=(
                common.REPO_ROOT / "web" / "apps" / "trakrai-device",
                common.REPO_ROOT / "web" / "packages",
                common.REPO_ROOT / "web" / "package.json",
                common.REPO_ROOT / "web" / "pnpm-lock.yaml",
                common.REPO_ROOT / "web" / "pnpm-workspace.yaml",
                common.REPO_ROOT / "web" / "turbo.json",
                common.REPO_ROOT / "web" / "Dockerfile.trakrai-device-bundle",
            ),
            target_type="ui-bundle",
        ),
    )
    return (*go_targets, *wheel_targets, *ui_target)


TARGETS_BY_NAME = {target.name: target for target in package_targets()}


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
        return {
            "schemaVersion": METADATA_SCHEMA_VERSION,
            "updatedAt": "",
            "packages": {},
        }

    with path.open("r", encoding="utf-8") as handle:
        metadata = json.load(handle)
    if not isinstance(metadata, dict):
        raise SystemExit(f"expected a JSON object in {path}")
    metadata.setdefault("schemaVersion", METADATA_SCHEMA_VERSION)
    metadata.setdefault("updatedAt", "")
    metadata.setdefault("packages", {})
    if not isinstance(metadata["packages"], dict):
        raise SystemExit(f"expected packages to be a JSON object in {path}")
    return metadata


def write_metadata(path: Path, metadata: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def decode_json_stream(payload: str) -> list[dict[str, Any]]:
    decoder = json.JSONDecoder()
    idx = 0
    objects: list[dict[str, Any]] = []
    while idx < len(payload):
        while idx < len(payload) and payload[idx].isspace():
            idx += 1
        if idx >= len(payload):
            break
        obj, idx = decoder.raw_decode(payload, idx)
        if not isinstance(obj, dict):
            raise ValueError("expected object in go list output")
        objects.append(obj)
    return objects


def run_go_list_json(cmd_path: str) -> list[dict[str, Any]]:
    env = os.environ.copy()
    env.setdefault("GOOS", "linux")
    env.setdefault("GOARCH", "arm64")
    proc = subprocess.run(
        ["go", "list", "-deps", "-json", cmd_path],
        cwd=common.DEVICE_ROOT,
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
        dir_path.relative_to(common.DEVICE_ROOT)
    except ValueError:
        return files

    for field in PACKAGE_FILE_FIELDS:
        for name in pkg.get(field, []) or []:
            files.add((dir_path / name).resolve())
    return files


def compute_go_source_hash(target: PackageTarget) -> tuple[str, list[str]]:
    files: set[Path] = set()
    for pkg in run_go_list_json(target.cmd_path):
        files.update(collect_package_files(pkg))
    files.add((common.DEVICE_ROOT / "go.mod").resolve())
    files.add((common.DEVICE_ROOT / "go.sum").resolve())
    files.add((common.DEVICE_ROOT / target.dockerfile).resolve())
    return hash_paths(files, common.REPO_ROOT)


def iter_files_for_hash(root: Path) -> list[Path]:
    if root.is_file():
        return [root.resolve()]

    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if path.is_dir():
            if path.name in HASH_IGNORE_DIRS:
                continue
            continue
        if any(part in HASH_IGNORE_DIRS for part in path.parts):
            continue
        if path.suffix in HASH_IGNORE_SUFFIXES:
            continue
        files.append(path.resolve())
    return files


def compute_recursive_source_hash(target: PackageTarget) -> tuple[str, list[str]]:
    files: set[Path] = set()
    for root in target.source_roots:
        files.update(iter_files_for_hash(root))
    return hash_paths(files, common.REPO_ROOT)


def hash_paths(paths: set[Path], relative_root: Path) -> tuple[str, list[str]]:
    rel_paths = sorted(str(path.relative_to(relative_root)).replace("\\", "/") for path in paths)
    hasher = hashlib.sha256()
    for rel_path in rel_paths:
        hasher.update(rel_path.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update((relative_root / rel_path).read_bytes())
    return f"sha256:{hasher.hexdigest()}", rel_paths


def compute_source_hash(target: PackageTarget) -> tuple[str, list[str]]:
    if target.target_type == "go-binary":
        return compute_go_source_hash(target)
    return compute_recursive_source_hash(target)


def compute_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def artifact_output_root(platform_tag: str) -> Path:
    return common.DEVICE_ROOT / "out" / "package-release" / platform_tag


def build_go_binary(target: PackageTarget, version: str, platform: str, platform_tag: str, built_at: str) -> Path:
    output_dir = artifact_output_root(platform_tag) / target.name
    common.docker_buildx(
        output_dir=output_dir,
        dockerfile=target.dockerfile,
        build_args={
            "CMD_PATH": target.cmd_path,
            "BINARY_NAME": target.name,
            "GO_LDFLAGS": (
                f"-X github.com/trakrai/device-services/internal/buildinfo.Version={version} "
                f"-X github.com/trakrai/device-services/internal/buildinfo.Commit={current_git_commit()} "
                f"-X github.com/trakrai/device-services/internal/buildinfo.SourceHash={compute_source_hash(target)[0]} "
                f"-X github.com/trakrai/device-services/internal/buildinfo.BuiltAt={built_at}"
            ),
        },
        context_dir=common.DEVICE_ROOT,
        platform=platform,
    )
    source_path = output_dir / target.name
    artifact_name = f"{target.name}-{platform_tag}-v{version}"
    artifact_path = output_dir / artifact_name
    if artifact_path.exists():
        artifact_path.unlink()
    source_path.rename(artifact_path)
    return artifact_path


def build_python_wheel(target: PackageTarget, version: str, platform: str, platform_tag: str) -> Path:
    if target.wheel_target is None:
        raise SystemExit(f"wheel target metadata missing for {target.name}")
    output_dir = artifact_output_root(platform_tag) / target.name
    common.docker_buildx(
        output_dir=output_dir,
        dockerfile="Dockerfile.wheel",
        build_args={"PACKAGE_VERSION": version},
        context_dir=target.wheel_target.context_dir,
        platform=platform,
    )
    wheel = common.find_single_file(output_dir, "*.whl")
    if wheel is None:
        raise SystemExit(f"wheel build did not produce an artifact for {target.name}")
    return wheel


def build_edge_ui(version: str) -> Path:
    output_dir = artifact_output_root("universal") / "edge-ui"
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    common.run_local(["pnpm", "--filter", "trakrai-device", "build"], cwd=common.REPO_ROOT / "web")
    zip_path = output_dir / f"edge-ui-v{version}.zip"
    common.create_ui_zip(common.WEB_DEVICE_APP_ROOT / "out", zip_path)
    return zip_path


def guess_content_type(artifact_path: Path) -> str:
    if artifact_path.suffix == ".zip":
        return "application/zip"
    if artifact_path.suffix == ".whl":
        return "application/octet-stream"
    return "application/octet-stream"


def current_git_commit() -> str:
    proc = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=common.REPO_ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return proc.stdout.strip() or "unknown"


def build_artifact(target: PackageTarget, version: str, platform: str, built_at: str) -> Path:
    platform_tag = normalize_platform_tag(platform, target.platform_strategy)
    if target.target_type == "go-binary":
        return build_go_binary(target, version, platform, platform_tag, built_at)
    if target.target_type == "python-wheel":
        return build_python_wheel(target, version, platform, platform_tag)
    if target.target_type == "ui-bundle":
        return build_edge_ui(version)
    raise SystemExit(f"unsupported target type {target.target_type}")


def publish_local_minio(base_url: str, remote_path: str, artifact_path: Path) -> None:
    query = urllib.parse.urlencode({"path": remote_path})
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/v1/package-storage/object?{query}",
        data=artifact_path.read_bytes(),
        method="PUT",
        headers={"Content-Type": "application/octet-stream"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status >= 300:
                raise SystemExit(f"local package upload failed for {remote_path}: HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"local package upload failed for {remote_path}: HTTP {exc.code}: {detail}") from exc


def cloud_api_request_json(
    base_url: str,
    request_path: str,
    payload: dict[str, Any],
    *,
    auth_token: str,
) -> dict[str, Any]:
    request = urllib.request.Request(
        urllib.parse.urljoin(base_url.rstrip("/") + "/", request_path.lstrip("/")),
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    if auth_token.strip() != "":
        request.add_header("Authorization", f"Bearer {auth_token.strip()}")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(
            f"cloud API request failed for {request_path}: HTTP {exc.code}: {detail}",
        ) from exc


def publish_via_cloud_api(
    base_url: str,
    remote_path: str,
    artifact_path: Path,
    *,
    auth_token: str,
) -> None:
    if base_url.strip() == "":
        raise SystemExit("cloud API base URL is required for publish-target cloud-api")
    content_type = guess_content_type(artifact_path)
    presigned = cloud_api_request_json(
        base_url,
        CLOUD_API_PACKAGE_UPLOAD_PATH,
        {"contentType": content_type, "path": remote_path},
        auth_token=auth_token,
    )
    request = urllib.request.Request(
        presigned["url"],
        data=artifact_path.read_bytes(),
        method=str(presigned.get("method", "PUT")).upper(),
        headers={**presigned.get("headers", {}), "Content-Type": content_type},
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            if response.status >= 300:
                raise SystemExit(
                    f"cloud package upload failed for {remote_path}: HTTP {response.status}",
                )
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(
            f"cloud package upload failed for {remote_path}: HTTP {exc.code}: {detail}",
        ) from exc


def upload_s3_object(bucket: str, key: str, artifact_path: Path, region: str) -> None:
    if importlib.util.find_spec("boto3") is None:
        raise SystemExit("publish-target s3 requires boto3 to be installed in the current Python environment")
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
    local_cloud_api_base_url: str,
    s3_bucket: str,
    s3_region: str,
) -> None:
    if publish_target == "none":
        return
    if publish_target == "cloud-api":
        publish_via_cloud_api(
            cloud_api_base_url,
            remote_path,
            artifact_path,
            auth_token=cloud_api_token,
        )
        return
    if publish_target == "local-minio":
        publish_via_cloud_api(
            local_cloud_api_base_url,
            remote_path,
            artifact_path,
            auth_token=cloud_api_token,
        )
        return
    if publish_target == "s3":
        if s3_bucket.strip() == "":
            raise SystemExit("--s3-bucket is required for publish-target s3")
        key = f"{package_prefix.strip('/')}/{remote_path}".strip("/")
        upload_s3_object(s3_bucket, key, artifact_path, s3_region)
        return
    raise SystemExit(f"unsupported publish target: {publish_target}")


def build_platform_index(metadata: dict[str, Any], platform: str) -> dict[str, Any]:
    packages_payload: dict[str, Any] = {}
    for name, package in sorted(metadata.get("packages", {}).items()):
        if not isinstance(package, dict):
            continue
        artifacts = package.get("artifacts", {})
        if not isinstance(artifacts, dict):
            continue
        artifact = artifacts.get(platform)
        if not isinstance(artifact, dict):
            continue
        packages_payload[name] = {
            "kind": package.get("kind", ""),
            "remotePath": artifact.get("remotePath", ""),
            "serviceName": package.get("serviceName", name),
            "sha256": artifact.get("sha256", ""),
            "targetType": package.get("targetType", ""),
            "version": package.get("version", ""),
        }
    return {
        "generatedAt": utc_now_iso(),
        "packages": packages_payload,
        "platform": platform,
        "schemaVersion": METADATA_SCHEMA_VERSION,
    }


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
        source_hash, source_inputs = compute_source_hash(target)
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
            "kind": target.kind,
            "serviceName": target.service_name,
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
                    "serviceName": target.service_name,
                    "sourceHash": source_hash,
                    "targetType": target.target_type,
                    "version": version,
                }
            )

    if metadata_changed:
        next_metadata["updatedAt"] = utc_now_iso()
    return planned, next_metadata


def cmd_plan(args: argparse.Namespace) -> int:
    metadata = load_metadata(Path(args.metadata).resolve())
    planned, next_metadata = plan_targets(metadata, args.package or [], set(args.force_package or []))
    payload = {
        "changed": planned,
        "metadataPath": str(Path(args.metadata).resolve()),
        "nextMetadata": next_metadata,
    }
    if args.json_out:
        Path(args.json_out).resolve().write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


def cmd_release(args: argparse.Namespace) -> int:
    metadata_path = Path(args.metadata).resolve()
    metadata = load_metadata(metadata_path)
    package_names = args.package or []
    forced_names = set(args.force_package or [])
    planned, next_metadata = plan_targets(metadata, package_names, forced_names)
    platform = args.platform
    built_at = utc_now_iso()
    platform_tag = normalize_platform_tag(platform, "platform")
    release_manifest: dict[str, Any] = {
        "builtAt": built_at,
        "changed": [],
        "metadataPath": str(metadata_path),
        "platform": platform,
        "publishTarget": args.publish_target,
    }

    for item in planned:
        target = TARGETS_BY_NAME[item["name"]]
        artifact_path = build_artifact(target, item["version"], platform, built_at)
        artifact_sha = compute_sha256(artifact_path)
        artifact_platform = normalize_platform_tag(platform, target.platform_strategy)
        remote_path = f"{item['name']}/{item['version']}/{artifact_platform}/{artifact_path.name}"
        publish_artifact(
            args.publish_target,
            remote_path,
            artifact_path,
            cloud_api_base_url=args.cloud_api_base_url,
            cloud_api_token=args.cloud_api_token,
            package_prefix=args.package_prefix,
            local_cloud_api_base_url=args.cloud_api_base_url,
            s3_bucket=args.s3_bucket,
            s3_region=args.s3_region,
        )
        package_record = next_metadata["packages"][item["name"]]
        artifacts = package_record.setdefault("artifacts", {})
        artifacts[platform] = {
            "fileName": artifact_path.name,
            "remotePath": remote_path,
            "sha256": artifact_sha,
            "updatedAt": built_at,
        }
        release_manifest["changed"].append(
            {
                **item,
                "artifactPath": str(artifact_path),
                "fileName": artifact_path.name,
                "platform": platform,
                "remotePath": remote_path,
                "sha256": artifact_sha,
            }
        )

    if args.write_metadata:
        write_metadata(metadata_path, next_metadata)

    manifest_out = Path(args.manifest_out).resolve() if args.manifest_out else artifact_output_root(platform_tag) / "release-manifest.json"
    manifest_out.parent.mkdir(parents=True, exist_ok=True)
    manifest_out.write_text(json.dumps(release_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(release_manifest, indent=2, sort_keys=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build, version, and publish device update packages.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    common_parent = argparse.ArgumentParser(add_help=False)
    common_parent.add_argument("--metadata", default=str(PACKAGE_METADATA_PATH))
    common_parent.add_argument("--package", action="append", help="package name to include; defaults to all packages")
    common_parent.add_argument("--force-package", action="append", help="package name to rebuild even if its source hash did not change")

    plan_parser = subparsers.add_parser("plan", parents=[common_parent], help="discover changed packages and planned versions")
    plan_parser.add_argument("--json-out", default="")
    plan_parser.set_defaults(func=cmd_plan)

    release_parser = subparsers.add_parser("release", parents=[common_parent], help="build changed packages, publish them, and update package metadata")
    release_parser.add_argument("--platform", default=common.DEFAULT_ARM64_PLATFORM)
    release_parser.add_argument("--publish-target", choices=["none", "cloud-api", "local-minio", "s3"], default="none")
    release_parser.add_argument("--cloud-api-base-url", "--local-cloud-api-base-url", dest="cloud_api_base_url", default="http://127.0.0.1:3000")
    release_parser.add_argument("--cloud-api-token", default="")
    release_parser.add_argument("--package-prefix", default=DEFAULT_PACKAGE_PREFIX)
    release_parser.add_argument("--manifest-out", default="")
    release_parser.add_argument("--no-write-metadata", action="store_false", dest="write_metadata")
    release_parser.add_argument("--s3-bucket", default=os.environ.get("TRAKRAI_PACKAGE_S3_BUCKET", ""))
    release_parser.add_argument("--s3-region", default=os.environ.get("AWS_REGION", ""))
    release_parser.set_defaults(func=cmd_release, write_metadata=True)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
