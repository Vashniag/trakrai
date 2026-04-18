from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import zipfile
from pathlib import Path
from typing import Any


def detect_local_platform() -> str:
    machine = (platform.machine() or "").lower()
    return {
        "aarch64": "linux/arm64",
        "arm64": "linux/arm64",
        "x86_64": "linux/amd64",
        "amd64": "linux/amd64",
        "x64": "linux/amd64",
    }.get(machine, "linux/amd64")


DEFAULT_LOCAL_PLATFORM = detect_local_platform()


def _resolve_executable(command: list[str]) -> list[str]:
    """Windows-friendly command resolution.

    Python's subprocess on Windows does not auto-resolve `*.cmd` / `*.bat`
    shims (the common shape for Node CLIs installed by corepack/pnpm). We
    resolve the first token via `shutil.which` so that invoking `pnpm`,
    `npx`, or `docker` from the devtool works identically on Linux and
    Windows without needing `shell=True`.
    """
    if os.name != "nt" or not command:
        return command
    resolved = shutil.which(command[0])
    if resolved is None:
        return command
    return [resolved, *command[1:]]


def run(
    command: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
    capture_output: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(command))
    resolved = _resolve_executable(command)
    result = subprocess.run(
        resolved,
        cwd=cwd,
        env=env,
        text=True,
        capture_output=capture_output,
        check=False,
    )
    if check and result.returncode != 0:
        message = result.stderr or result.stdout or f"command failed: {' '.join(command)}"
        raise SystemExit(message.strip())
    return result


def dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def deep_copy_json(value: Any) -> Any:
    return json.loads(json.dumps(value))


def create_zip_from_directory(source_dir: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source_dir.rglob("*")):
            if path.is_dir():
                continue
            archive.write(path, path.relative_to(source_dir))


_SKIP_MTIME_DIRNAMES = {"node_modules", ".next", "dist", "out", "build", "__pycache__", ".git", ".turbo"}


def latest_tree_mtime(path: Path) -> float:
    if not path.exists():
        return 0.0
    latest = path.stat().st_mtime
    if path.is_file():
        return latest
    stack: list[Path] = [path]
    while stack:
        current = stack.pop()
        try:
            for entry in current.iterdir():
                if entry.is_dir():
                    if entry.name in _SKIP_MTIME_DIRNAMES:
                        continue
                    stack.append(entry)
                    continue
                try:
                    mtime = entry.stat().st_mtime
                except FileNotFoundError:
                    continue
                if mtime > latest:
                    latest = mtime
        except (FileNotFoundError, PermissionError):
            continue
    return latest


def ensure_clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def find_single_file(root: Path, pattern: str) -> Path | None:
    matches = sorted(root.glob(pattern))
    if not matches:
        return None
    if len(matches) > 1:
        raise SystemExit(f"expected one file matching {pattern} under {root}, found {len(matches)}")
    return matches[0]
