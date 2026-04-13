#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


RELEASE_TAG = "device-binaries-latest"
MANIFEST_ASSET_NAME = "device-binary-manifest.json"
MANIFEST_SCHEMA_VERSION = 1
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


@dataclass(frozen=True)
class BinaryDefinition:
    name: str
    cmd_path: str
    dockerfile: str


BINARY_DEFINITIONS = (
    BinaryDefinition("cloud-comm", "./cmd/cloud-comm", "Dockerfile"),
    BinaryDefinition("live-feed", "./cmd/live-feed", "Dockerfile.gstreamer"),
    BinaryDefinition("ptz-control", "./cmd/ptz-control", "Dockerfile"),
    BinaryDefinition("rtsp-feeder", "./cmd/rtsp-feeder", "Dockerfile.gstreamer"),
    BinaryDefinition("workflow-comm", "./cmd/workflow-comm", "Dockerfile"),
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}

    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    if not isinstance(data, dict):
        raise ValueError(f"expected JSON object in {path}")

    return data


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def parse_semver(value: str | None) -> tuple[int, int, int]:
    if not value:
        return (0, 0, 0)

    match = SEMVER_RE.match(value)
    if not match:
        raise ValueError(f"invalid semantic version: {value}")

    return tuple(int(group) for group in match.groups())


def bump_patch(value: str | None) -> str:
    major, minor, patch = parse_semver(value)
    return f"{major}.{minor}.{patch + 1}"


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


def run_go_list_json(device_dir: Path, cmd_path: str) -> list[dict[str, Any]]:
    env = os.environ.copy()
    env.setdefault("GOOS", "linux")
    env.setdefault("GOARCH", "arm64")

    proc = subprocess.run(
        ["go", "list", "-deps", "-json", cmd_path],
        cwd=device_dir,
        env=env,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return decode_json_stream(proc.stdout)


def collect_package_files(pkg: dict[str, Any], device_dir: Path) -> set[Path]:
    files: set[Path] = set()
    pkg_dir = pkg.get("Dir")
    if not pkg_dir:
        return files

    dir_path = Path(pkg_dir).resolve()
    try:
        dir_path.relative_to(device_dir)
    except ValueError:
        return files

    for field in PACKAGE_FILE_FIELDS:
        for name in pkg.get(field, []) or []:
            files.add((dir_path / name).resolve())

    return files


def compute_source_hash(device_dir: Path, binary: BinaryDefinition) -> tuple[str, list[str]]:
    files: set[Path] = set()
    for pkg in run_go_list_json(device_dir, binary.cmd_path):
        files.update(collect_package_files(pkg, device_dir))

    files.add((device_dir / "go.mod").resolve())
    files.add((device_dir / "go.sum").resolve())
    files.add((device_dir / binary.dockerfile).resolve())

    rel_paths = sorted(str(path.relative_to(device_dir)).replace("\\", "/") for path in files)
    hasher = hashlib.sha256()
    for rel_path in rel_paths:
        hasher.update(rel_path.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update((device_dir / rel_path).read_bytes())

    return f"sha256:{hasher.hexdigest()}", rel_paths


def build_changed_entry(binary: BinaryDefinition, version: str, previous_version: str | None, source_hash: str) -> dict[str, Any]:
    latest_asset_name = f"{binary.name}-linux-arm64"
    versioned_asset_name = f"{binary.name}-v{version}-linux-arm64"
    return {
        "name": binary.name,
        "cmdPath": binary.cmd_path,
        "dockerfile": binary.dockerfile,
        "version": version,
        "previousVersion": previous_version or "",
        "sourceHash": source_hash,
        "artifactName": f"device-binary-build-{binary.name}",
        "latestAssetName": latest_asset_name,
        "latestChecksumAssetName": f"{latest_asset_name}.sha256",
        "versionedAssetName": versioned_asset_name,
        "versionedChecksumAssetName": f"{versioned_asset_name}.sha256",
    }


def write_github_outputs(path: Path, outputs: dict[str, str]) -> None:
    ensure_parent(path)
    with path.open("a", encoding="utf-8") as handle:
        for key, value in outputs.items():
            if "\n" in value:
                marker = f"__{key.upper()}__"
                handle.write(f"{key}<<{marker}\n{value}\n{marker}\n")
                continue
            handle.write(f"{key}={value}\n")


def plan_release(args: argparse.Namespace) -> int:
    repo_root = Path(args.repo_root).resolve()
    device_dir = (repo_root / "device").resolve()
    manifest = load_json_file(Path(args.manifest).resolve())
    manifest_binaries = manifest.get("binaries", {}) if isinstance(manifest.get("binaries"), dict) else {}

    changed: list[dict[str, Any]] = []
    next_binaries: dict[str, Any] = {}
    inspected_at = utc_now_iso()
    commit = args.commit or os.environ.get("GITHUB_SHA", "unknown")

    for binary in BINARY_DEFINITIONS:
        source_hash, inputs = compute_source_hash(device_dir, binary)
        previous = manifest_binaries.get(binary.name, {}) if isinstance(manifest_binaries.get(binary.name), dict) else {}
        previous_version = previous.get("version")
        current_version = previous_version or "0.0.0"
        version = previous_version if previous.get("sourceHash") == source_hash else bump_patch(previous_version)

        next_entry = {
            "version": version,
            "sourceHash": source_hash,
            "cmdPath": binary.cmd_path,
            "dockerfile": binary.dockerfile,
            "commit": commit,
            "publishedAt": inspected_at,
            "inputs": inputs,
        }
        next_binaries[binary.name] = next_entry

        if previous.get("sourceHash") == source_hash:
            continue

        changed.append(build_changed_entry(binary, version, current_version if previous_version else "", source_hash))

    plan = {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "generatedAt": inspected_at,
        "releaseTag": RELEASE_TAG,
        "manifestAssetName": MANIFEST_ASSET_NAME,
        "changed": changed,
        "nextManifest": {
            "schemaVersion": MANIFEST_SCHEMA_VERSION,
            "releaseTag": RELEASE_TAG,
            "updatedAt": inspected_at,
            "binaries": next_binaries,
        },
    }

    plan_path = Path(args.plan_out).resolve()
    ensure_parent(plan_path)
    plan_path.write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    github_output = args.github_output
    if github_output:
        outputs = {
            "changed_count": str(len(changed)),
            "has_changes": "true" if changed else "false",
            "matrix": json.dumps(changed, separators=(",", ":")),
            "release_tag": RELEASE_TAG,
            "manifest_asset_name": MANIFEST_ASSET_NAME,
            "plan_path": str(plan_path),
        }
        write_github_outputs(Path(github_output), outputs)

    return 0


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def stage_release_assets(args: argparse.Namespace) -> int:
    plan_path = Path(args.plan).resolve()
    artifacts_dir = Path(args.artifacts_dir).resolve()
    staging_dir = Path(args.staging_dir).resolve()

    plan = load_json_file(plan_path)
    changed = plan.get("changed", [])
    if not isinstance(changed, list):
        raise ValueError("plan changed field must be a list")

    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)

    for item in changed:
        name = item["name"]
        artifact_name = item["artifactName"]
        source_binary = artifacts_dir / artifact_name / name
        if not source_binary.exists():
            raise FileNotFoundError(f"missing binary artifact: {source_binary}")

        latest_asset = staging_dir / item["latestAssetName"]
        versioned_asset = staging_dir / item["versionedAssetName"]
        shutil.copy2(source_binary, latest_asset)
        shutil.copy2(source_binary, versioned_asset)

        latest_checksum = sha256_file(latest_asset)
        versioned_checksum = sha256_file(versioned_asset)
        (staging_dir / item["latestChecksumAssetName"]).write_text(
            f"{latest_checksum}  {latest_asset.name}\n",
            encoding="utf-8",
        )
        (staging_dir / item["versionedChecksumAssetName"]).write_text(
            f"{versioned_checksum}  {versioned_asset.name}\n",
            encoding="utf-8",
        )

    manifest_asset = staging_dir / plan.get("manifestAssetName", MANIFEST_ASSET_NAME)
    manifest_asset.write_text(
        json.dumps(plan["nextManifest"], indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Plan and stage device binary releases.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan_parser = subparsers.add_parser("plan", help="compute source hashes and next versions")
    plan_parser.add_argument("--repo-root", default=".", help="repository root")
    plan_parser.add_argument("--manifest", required=True, help="path to the last published manifest JSON")
    plan_parser.add_argument("--plan-out", required=True, help="path to write the generated plan JSON")
    plan_parser.add_argument("--commit", default="", help="commit SHA to record in the next manifest")
    plan_parser.add_argument("--github-output", default="", help="optional GitHub output file")
    plan_parser.set_defaults(func=plan_release)

    stage_parser = subparsers.add_parser("stage", help="copy binaries and checksums into a release staging directory")
    stage_parser.add_argument("--plan", required=True, help="release plan JSON path")
    stage_parser.add_argument("--artifacts-dir", required=True, help="downloaded artifact root")
    stage_parser.add_argument("--staging-dir", required=True, help="output directory for release assets")
    stage_parser.set_defaults(func=stage_release_assets)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
