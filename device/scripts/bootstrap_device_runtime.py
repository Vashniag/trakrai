#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import pwd
import grp
import site
import shutil
import stat
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap the TrakrAI device runtime on Linux.")
    parser.add_argument("--stage-dir", required=True, help="staged deployment directory")
    parser.add_argument(
        "--manifest",
        default="manifest.json",
        help="manifest file name inside the stage directory (default: manifest.json)",
    )
    args = parser.parse_args()

    if os.geteuid() != 0:
        raise SystemExit("bootstrap_device_runtime.py must run as root")

    stage_dir = Path(args.stage_dir).resolve()
    manifest_path = stage_dir / args.manifest
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    runtime_root = Path(manifest["runtime_root"]).resolve()
    runtime_user = manifest["runtime_user"]
    runtime_group = manifest.get("runtime_group", runtime_user)
    unit_directory = Path(manifest["unit_directory"]).resolve()

    uid = pwd.getpwnam(runtime_user).pw_uid
    gid = grp.getgrnam(runtime_group).gr_gid

    runtime_root.mkdir(parents=True, exist_ok=True)
    stop_units(manifest.get("stop_units", []))
    stop_manual_processes(manifest.get("manual_process_patterns", []))

    backup_dir = runtime_root / "legacy-backups" / time.strftime("%Y%m%d-%H%M%S")
    backup_legacy_entries(runtime_root, backup_dir, manifest.get("legacy_backup_names", []))
    ensure_directories(manifest["directories"], runtime_root, uid, gid)

    install_configs(stage_dir, runtime_root, manifest.get("configs", []), uid, gid)
    install_binaries(stage_dir, runtime_root, manifest.get("binaries", []), uid, gid)
    install_ui_bundle(stage_dir, runtime_root, manifest.get("ui_bundle"))
    install_python_packages(stage_dir, runtime_root, manifest.get("python_packages", []), uid, gid)
    install_python_path_entries(manifest.get("python_path_entries", []))
    install_python_wheels(stage_dir, runtime_root, manifest.get("wheels", []), uid, gid)

    runtime_manager = manifest["runtime_manager"]
    write_runtime_manager_wrapper(runtime_root, runtime_manager, uid, gid)
    write_runtime_manager_unit(unit_directory, runtime_root, runtime_manager)

    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", runtime_manager["unit_name"]])
    run(["systemctl", "restart", runtime_manager["unit_name"]])
    wait_for_unit(runtime_manager["unit_name"])

    wait_for_generated_units(unit_directory, manifest.get("wait_for_units", []))
    start_units(manifest.get("start_units", []))
    verify_units(manifest.get("verify_units", []))

    chown_recursive(runtime_root, uid, gid)
    print(json.dumps({"status": "ok", "runtime_root": str(runtime_root), "backup_dir": str(backup_dir)}))
    return 0


def ensure_directories(directories: list[str], runtime_root: Path, uid: int, gid: int) -> None:
    for directory in directories:
        path = runtime_root / directory
        path.mkdir(parents=True, exist_ok=True)
        os.chown(path, uid, gid)


def stop_units(units: list[str]) -> None:
    for unit in units:
        if not unit.strip():
            continue
        run(["systemctl", "stop", unit], check=False)
        run(["systemctl", "disable", unit], check=False)


def stop_manual_processes(patterns: list[str]) -> None:
    for pattern in patterns:
        if not pattern.strip():
            continue
        run(["pkill", "-f", pattern], check=False)


def backup_legacy_entries(runtime_root: Path, backup_dir: Path, names: list[str]) -> None:
    if not names:
        return

    moved_any = False
    for name in names:
        for candidate in runtime_root.glob(name):
            if not candidate.exists():
                continue
            explicit_json_name = name.endswith(".json") and Path(name).name == candidate.name
            if candidate.name.endswith(".json") and candidate.name != "managed-services.json" and not explicit_json_name:
                continue
            backup_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(candidate), str(backup_dir / candidate.name))
            moved_any = True

    if moved_any:
        print(f"Backed up legacy entries to {backup_dir}")


def install_configs(stage_dir: Path, runtime_root: Path, configs: list[dict[str, Any]], uid: int, gid: int) -> None:
    for item in configs:
        source = stage_dir / item["source"]
        target = runtime_root / item["target"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        os.chown(target, uid, gid)


def install_binaries(stage_dir: Path, runtime_root: Path, binaries: list[dict[str, Any]], uid: int, gid: int) -> None:
    for item in binaries:
        source = stage_dir / item["source"]
        target = runtime_root / item["target"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        target.chmod(int(item.get("mode", "0755"), 8))
        os.chown(target, uid, gid)


def install_ui_bundle(stage_dir: Path, runtime_root: Path, bundle: dict[str, Any] | None) -> None:
    if not bundle:
        return

    source = stage_dir / bundle["source"]
    target_dir = runtime_root / bundle["target_dir"]
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(source) as archive:
        archive.extractall(target_dir)


def install_python_packages(
    stage_dir: Path,
    runtime_root: Path,
    packages: list[dict[str, Any]],
    uid: int,
    gid: int,
) -> None:
    for item in packages:
        source = stage_dir / item["source"]
        target_dir = runtime_root / item["target_dir"]
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, target_dir)
        chown_recursive(target_dir, uid, gid)


def install_python_path_entries(entries: list[str]) -> None:
    normalized_entries = [str(Path(entry).resolve()) for entry in entries if str(entry).strip()]
    if not normalized_entries:
        return

    site_dirs = []
    for raw_path in site.getsitepackages():
        path = Path(raw_path).resolve()
        if path not in site_dirs:
            site_dirs.append(path)
    for site_dir in site_dirs:
        site_dir.mkdir(parents=True, exist_ok=True)
        pth_path = site_dir / "trakrai-device-runtime.pth"
        pth_path.write_text("\n".join(normalized_entries) + "\n", encoding="utf-8")


def install_python_wheels(
    stage_dir: Path,
    runtime_root: Path,
    wheels: list[dict[str, Any]],
    uid: int,
    gid: int,
) -> None:
    for item in wheels:
        dependency_targets: list[Path] = []
        for dependency_source in item.get("dependency_sources", []):
            dependency = stage_dir / dependency_source
            dependency_target = runtime_root / "downloads" / Path(dependency_source).name
            dependency_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dependency, dependency_target)
            os.chown(dependency_target, uid, gid)
            dependency_targets.append(dependency_target)

        source = stage_dir / item["source"]
        target = runtime_root / item["download_target"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        os.chown(target, uid, gid)
        for dependency_target in dependency_targets:
            run(["python3", "-m", "pip", "install", "--no-deps", "--force-reinstall", str(dependency_target)])
        run(resolve_tokens(item["install_command"], wheel_path=str(target)))


def write_runtime_manager_wrapper(
    runtime_root: Path,
    runtime_manager: dict[str, Any],
    uid: int,
    gid: int,
) -> None:
    script_path = runtime_root / runtime_manager["script_path"]
    log_path = runtime_root / runtime_manager["log_path"]
    version_file = runtime_root / runtime_manager["version_file"]
    binary_path = runtime_root / runtime_manager["binary_path"]
    config_path = runtime_root / runtime_manager["config_path"]

    script_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    version_file.parent.mkdir(parents=True, exist_ok=True)

    script = f"""#!/bin/bash
set -euo pipefail
mkdir -p '{log_path.parent}'
mkdir -p '{version_file.parent}'
exec >>'{log_path}' 2>&1
exec < /dev/null
version_output="$('{binary_path}' --version 2>&1 || true)"
version_output="$(printf '%s\\n' "$version_output" | awk 'NF {{print; exit}}')"
printf '%s\\n' "${{version_output:-unknown}}" > '{version_file}'
exec '{binary_path}' -config '{config_path}'
"""

    script_path.write_text(script, encoding="utf-8")
    script_path.chmod(0o755)
    os.chown(script_path, uid, gid)


def write_runtime_manager_unit(unit_directory: Path, runtime_root: Path, runtime_manager: dict[str, Any]) -> None:
    script_path = runtime_root / runtime_manager["script_path"]
    unit_path = unit_directory / runtime_manager["unit_name"]

    unit = f"""[Unit]
Description=TrakrAI runtime manager
After=network-online.target

[Service]
Type=simple
User={runtime_manager["user"]}
Group={runtime_manager["group"]}
WorkingDirectory={runtime_root}
ExecStart=/bin/bash {script_path}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
"""
    unit_path.write_text(unit, encoding="utf-8")


def wait_for_generated_units(unit_directory: Path, units: list[str]) -> None:
    deadline = time.time() + 30
    pending = {unit for unit in units if unit.strip()}
    while pending and time.time() < deadline:
        for unit in list(pending):
            if (unit_directory / unit).exists():
                pending.remove(unit)
        if pending:
            time.sleep(1)
    if pending:
        raise SystemExit(f"Timed out waiting for generated units: {', '.join(sorted(pending))}")


def start_units(units: list[str]) -> None:
    for unit in units:
        if not unit.strip():
            continue
        run(["systemctl", "enable", unit], check=False)
        run(["systemctl", "restart", unit])


def verify_units(units: list[str], *, settle_timeout: float = 20.0) -> None:
    """Verify each unit reaches `active`. Give services still in `activating` a chance to settle."""
    pending = list(units)
    deadline = time.time() + settle_timeout
    last_state: dict[str, str] = {}
    while pending and time.time() < deadline:
        still_pending: list[str] = []
        for unit in pending:
            result = run(["systemctl", "is-active", unit], capture_output=True, check=False)
            state = result.stdout.strip() or result.stderr.strip() or "unknown"
            last_state[unit] = state
            if state == "active":
                continue
            if state in {"activating", "reloading"}:
                still_pending.append(unit)
                continue
            # Anything else (failed, inactive, ...) we record immediately.
        pending = still_pending
        if pending:
            time.sleep(1)

    failed = [f"{unit}={last_state.get(unit, 'unknown')}" for unit in units if last_state.get(unit) != "active"]
    if failed:
        raise SystemExit("Unit verification failed: " + ", ".join(failed))


def wait_for_unit(unit: str) -> None:
    deadline = time.time() + 30
    while time.time() < deadline:
        result = run(["systemctl", "is-active", unit], capture_output=True, check=False)
        if result.stdout.strip() == "active":
            return
        time.sleep(1)
    raise SystemExit(f"Timed out waiting for {unit} to become active")


def chown_recursive(path: Path, uid: int, gid: int) -> None:
    for root, dirs, files in os.walk(path):
        os.chown(root, uid, gid)
        for name in dirs:
            os.chown(os.path.join(root, name), uid, gid)
        for name in files:
            try:
                os.chown(os.path.join(root, name), uid, gid)
            except FileNotFoundError:
                continue


def resolve_tokens(values: list[str], **replacements: str) -> list[str]:
    resolved: list[str] = []
    for value in values:
        current = value
        for key, replacement in replacements.items():
            current = current.replace(f"{{{{{key}}}}}", replacement)
        resolved.append(current)
    return resolved


def run(command: list[str], *, capture_output: bool = False, check: bool = True) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(command))
    result = subprocess.run(
        command,
        capture_output=capture_output,
        check=False,
        text=True,
    )
    if check and result.returncode != 0:
        raise SystemExit(
            f"Command failed ({result.returncode}): {' '.join(command)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


if __name__ == "__main__":
    raise SystemExit(main())
