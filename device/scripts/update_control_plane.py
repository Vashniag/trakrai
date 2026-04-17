#!/usr/bin/env python3
"""Device-side updater for runtime-manager and cloud-comm.

`runtime-manager` and `cloud-comm` are the control-plane for every other
TrakrAI service on the device, so they cannot update themselves through the
runtime-manager self-update path the other services use. This script is the
escape hatch: it runs as root on the device, pulls a published binary from
the cloud package API using the device's own `cloud-transfer.json`
credentials, swaps it into place, restarts the systemd unit, and records
the version.

Typical use:

    sudo python3 /home/hacklab/trakrai-device-runtime/scripts/update_control_plane.py
    sudo python3 /home/hacklab/trakrai-device-runtime/scripts/update_control_plane.py --packages runtime-manager
    sudo python3 /home/hacklab/trakrai-device-runtime/scripts/update_control_plane.py --metadata-path /tmp/package-versions.json

By default the script updates both `runtime-manager` and `cloud-comm` for
the `linux/arm64` platform, reading the latest-known version from
`<runtime-root>/state/package-versions.json` (staged by
`bootstrap_device_runtime.py` on each deploy). Override with `--metadata-path`
to point at any other manifest copy, e.g. one pulled from CI on demand.

The script is intentionally standalone (stdlib only) so it can run on a
minimal Jetson image without this repo being checked out on-device.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_RUNTIME_ROOT = Path("/home/hacklab/trakrai-device-runtime")
DEFAULT_PACKAGES = ("runtime-manager", "cloud-comm")
DEFAULT_PLATFORM = "linux/arm64"
DEFAULT_DOWNLOAD_PATH = "/api/external/storage/packages/download-session"
DEFAULT_SYSTEMD_UNIT_FMT = "trakrai-{package}.service"
DEFAULT_METADATA_SUBPATH = Path("state/package-versions.json")
FALLBACK_METADATA_SUBPATH = Path("scripts/package-versions.json")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--packages",
        nargs="+",
        default=list(DEFAULT_PACKAGES),
        help=f"packages to update (default: {' '.join(DEFAULT_PACKAGES)})",
    )
    parser.add_argument("--platform", default=DEFAULT_PLATFORM, help="artifact platform (default: linux/arm64)")
    parser.add_argument("--runtime-root", type=Path, default=DEFAULT_RUNTIME_ROOT)
    parser.add_argument("--metadata-path", type=Path, default=None, help="override for package-versions.json")
    parser.add_argument("--metadata-url", default="", help="fetch package-versions.json from this URL before applying")
    parser.add_argument("--cloud-api-base-url", default="", help="override cloud_api.base_url from cloud-transfer.json")
    parser.add_argument("--cloud-api-token", default="", help="override cloud_api.access_token from cloud-transfer.json")
    parser.add_argument("--device-id", default="", help="override device_id from cloud-transfer.json")
    parser.add_argument("--package-download-path", default="", help="override cloud_api.package_download_presign_path")
    parser.add_argument("--systemd-unit-fmt", default=DEFAULT_SYSTEMD_UNIT_FMT, help="systemd unit name format; {package} is substituted")
    parser.add_argument("--dry-run", action="store_true", help="plan the update without downloading or installing")
    parser.add_argument("--skip-restart", action="store_true", help="install binaries but do not touch systemd")
    args = parser.parse_args()

    if os.geteuid() != 0 and not args.dry_run:
        raise SystemExit("update_control_plane.py must run as root (or pass --dry-run)")

    runtime_root = args.runtime_root.resolve()
    configs_dir = runtime_root / "configs"
    cloud_api = resolve_cloud_api_settings(configs_dir, args)
    metadata = load_metadata(runtime_root, args)

    plan = []
    for package in args.packages:
        artifact = find_artifact(metadata, package, args.platform)
        plan.append((package, artifact))
        print(f"plan: {package} -> {artifact['fileName']} ({artifact['sha256'][:12]}…)")

    if args.dry_run:
        print("dry-run requested, nothing will be downloaded or installed")
        return 0

    staging_root = runtime_root / "downloads" / "control-plane-updates"
    staging_root.mkdir(parents=True, exist_ok=True)

    for package, artifact in plan:
        download_path = staging_root / artifact["fileName"]
        download_package(cloud_api, artifact, download_path)
        install_binary(runtime_root, package, download_path, artifact)
        if args.skip_restart:
            print(f"{package}: skip-restart requested, leaving systemd unit alone")
            continue
        unit = args.systemd_unit_fmt.format(package=package)
        restart_unit(unit)
        wait_for_active(unit, timeout_sec=30)
        print(f"{package}: {artifact['fileName']} installed and {unit} is active")

    print("update_control_plane: done")
    return 0


def resolve_cloud_api_settings(configs_dir: Path, args: argparse.Namespace) -> dict[str, str]:
    cloud_transfer_path = configs_dir / "cloud-transfer.json"
    cloud_transfer: dict[str, Any] = {}
    if cloud_transfer_path.exists():
        cloud_transfer = json.loads(cloud_transfer_path.read_text(encoding="utf-8"))
    api = cloud_transfer.get("cloud_api", {}) if isinstance(cloud_transfer, dict) else {}

    base_url = args.cloud_api_base_url.strip() or str(api.get("base_url", "")).strip()
    token = args.cloud_api_token if args.cloud_api_token != "" else str(api.get("access_token", "")).strip()
    device_id = args.device_id.strip() or str(cloud_transfer.get("device_id", "")).strip()
    download_path = args.package_download_path.strip() or str(api.get("package_download_presign_path", "")).strip() or DEFAULT_DOWNLOAD_PATH

    missing = []
    if not base_url:
        missing.append("cloud_api.base_url")
    if not device_id:
        missing.append("device_id")
    if missing:
        raise SystemExit(
            f"missing cloud credentials in {cloud_transfer_path}: {', '.join(missing)} "
            f"(override with --cloud-api-base-url/--device-id/--cloud-api-token)"
        )

    return {
        "base_url": base_url,
        "token": token,
        "device_id": device_id,
        "download_path": download_path,
    }


def load_metadata(runtime_root: Path, args: argparse.Namespace) -> dict[str, Any]:
    if args.metadata_url.strip():
        print(f"fetching metadata from {args.metadata_url}")
        req = urllib.request.Request(args.metadata_url)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise SystemExit(f"metadata fetch failed: HTTP {exc.code}: {detail}") from exc

    if args.metadata_path is not None:
        candidate = args.metadata_path
    else:
        candidate = runtime_root / DEFAULT_METADATA_SUBPATH
        if not candidate.exists():
            candidate = runtime_root / FALLBACK_METADATA_SUBPATH
    if not candidate.exists():
        raise SystemExit(f"no package metadata found at {candidate} (pass --metadata-path or --metadata-url)")
    return json.loads(candidate.read_text(encoding="utf-8"))


def find_artifact(metadata: dict[str, Any], package: str, platform: str) -> dict[str, Any]:
    packages = metadata.get("packages", {})
    record = packages.get(package)
    if not isinstance(record, dict):
        raise SystemExit(f"metadata has no entry for package '{package}'")
    artifacts = record.get("artifacts", {})
    artifact = artifacts.get(platform) if isinstance(artifacts, dict) else None
    if not isinstance(artifact, dict):
        raise SystemExit(f"no '{platform}' artifact recorded for package '{package}'")
    for field in ("remotePath", "fileName", "sha256"):
        if not str(artifact.get(field, "")).strip():
            raise SystemExit(f"incomplete artifact metadata for {package}: missing {field}")
    return artifact


def download_package(cloud_api: dict[str, str], artifact: dict[str, Any], destination: Path) -> None:
    body = json.dumps({"deviceId": cloud_api["device_id"], "path": artifact["remotePath"]}).encode("utf-8")
    presign_url = urllib.parse.urljoin(cloud_api["base_url"].rstrip("/") + "/", cloud_api["download_path"].lstrip("/"))
    request = urllib.request.Request(
        presign_url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    if cloud_api["token"]:
        request.add_header("Authorization", f"Bearer {cloud_api['token']}")

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            presigned = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"presign request failed for {artifact['remotePath']}: HTTP {exc.code}: {detail}") from exc

    download_request = urllib.request.Request(
        presigned["url"],
        method=str(presigned.get("method", "GET")).upper(),
        headers=presigned.get("headers", {}) or {},
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    try:
        with urllib.request.urlopen(download_request, timeout=300) as response, destination.open("wb") as fh:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                hasher.update(chunk)
                fh.write(chunk)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"download failed for {artifact['remotePath']}: HTTP {exc.code}: {detail}") from exc

    actual = hasher.hexdigest()
    expected = str(artifact["sha256"]).strip().lower()
    if actual.lower() != expected:
        destination.unlink(missing_ok=True)
        raise SystemExit(f"SHA-256 mismatch for {artifact['fileName']}: expected {expected}, got {actual}")
    print(f"downloaded {artifact['fileName']} ({destination.stat().st_size} bytes, sha256 {actual[:12]}…)")


def install_binary(runtime_root: Path, package: str, source: Path, artifact: dict[str, Any]) -> None:
    target = runtime_root / "bin" / package
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    target.chmod(0o755)
    shutil.chown(target, user="hacklab", group="hacklab")

    version_file = runtime_root / "versions" / f"{package}.txt"
    version_file.parent.mkdir(parents=True, exist_ok=True)
    version_file.write_text(artifact["fileName"] + "\n", encoding="utf-8")
    shutil.chown(version_file, user="hacklab", group="hacklab")


def restart_unit(unit: str) -> None:
    # daemon-reload is a no-op for binary swaps, but cheap insurance if the
    # unit file was also edited out-of-band.
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "restart", unit], check=True)


def wait_for_active(unit: str, *, timeout_sec: int) -> None:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        result = subprocess.run(["systemctl", "is-active", unit], capture_output=True, text=True)
        state = result.stdout.strip() or result.stderr.strip()
        if state == "active":
            return
        if state in {"failed", "inactive"}:
            # Give systemd a moment to actually start; RestartSec is usually small.
            time.sleep(1)
            continue
        time.sleep(1)
    raise SystemExit(f"{unit} did not reach active within {timeout_sec}s")


if __name__ == "__main__":
    sys.exit(main())
