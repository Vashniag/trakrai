#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shlex
import signal
import subprocess
import sys
import time
from pathlib import Path


UNIT_DIRECTORY = Path(os.environ.get("TRAKRAI_SYSTEMCTL_UNIT_DIR", "/home/hacklab/trakrai-device-runtime/units"))
STATE_DIRECTORY = Path(os.environ.get("TRAKRAI_SYSTEMCTL_STATE_DIR", str(UNIT_DIRECTORY / ".state")))
ENABLED_DIRECTORY = STATE_DIRECTORY / "enabled"
META_DIRECTORY = STATE_DIRECTORY / "meta"


def main() -> int:
    STATE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    ENABLED_DIRECTORY.mkdir(parents=True, exist_ok=True)
    META_DIRECTORY.mkdir(parents=True, exist_ok=True)

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("action")
    parser.add_argument("unit", nargs="?")
    parser.add_argument("extra", nargs="*")
    args, unknown = parser.parse_known_args()
    args.extra.extend(unknown)

    if args.action == "daemon-reload":
        return 0
    if args.action == "enable":
        require_unit(args.unit)
        marker_path(args.unit).touch()
        return 0
    if args.action == "disable":
        require_unit(args.unit)
        marker_path(args.unit).unlink(missing_ok=True)
        return 0
    if args.action == "start":
        require_unit(args.unit)
        start_unit(args.unit)
        return 0
    if args.action == "stop":
        require_unit(args.unit)
        stop_unit(args.unit)
        return 0
    if args.action == "restart":
        require_unit(args.unit)
        stop_unit(args.unit)
        start_unit(args.unit)
        return 0
    if args.action == "is-active":
        require_unit(args.unit)
        state = read_state(args.unit)
        print(state["ActiveState"])
        return 0 if state["ActiveState"] == "active" else 3
    if args.action == "show":
        require_unit(args.unit)
        state = read_state(args.unit)
        print(f"ActiveState={state['ActiveState']}")
        print(f"LoadState={state['LoadState']}")
        print(f"MainPID={state['MainPID']}")
        print(f"SubState={state['SubState']}")
        print(f"UnitFileState={state['UnitFileState']}")
        return 0
    if args.action == "list-units":
        return list_units()

    raise SystemExit(f"unsupported fake systemctl action: {args.action}")


def require_unit(unit: str | None) -> None:
    if not unit:
        raise SystemExit("unit name is required")


def unit_path(unit: str) -> Path:
    return UNIT_DIRECTORY / unit


def marker_path(unit: str) -> Path:
    return ENABLED_DIRECTORY / unit


def meta_path(unit: str) -> Path:
    return META_DIRECTORY / f"{unit}.json"


def load_unit(unit: str) -> dict[str, object]:
    path = unit_path(unit)
    if not path.exists():
        raise SystemExit(f"Unit {unit} not found in {UNIT_DIRECTORY}")

    values: dict[str, object] = {
        "EnvironmentLines": [],
        "EnvironmentFileLines": [],
    }
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("[") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key == "Environment":
            values["EnvironmentLines"].append(value)
            continue
        if key == "EnvironmentFile":
            values["EnvironmentFileLines"].append(value)
            continue
        values[key] = value
    if "ExecStart" not in values:
        raise SystemExit(f"Unit {unit} is missing ExecStart")
    return values


def load_meta(unit: str) -> dict[str, object]:
    path = meta_path(unit)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_meta(unit: str, payload: dict[str, object]) -> None:
    meta_path(unit).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def start_unit(unit: str) -> None:
    unit_data = load_unit(unit)
    state = read_state(unit)
    if state["ActiveState"] == "active":
        return

    env = os.environ.copy()
    for key, value in iter_environment(unit_data).items():
        env[key] = value

    command = shlex.split(str(unit_data["ExecStart"]))
    working_directory = str(unit_data.get("WorkingDirectory") or "/")
    process = subprocess.Popen(
        command,
        cwd=working_directory,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    time.sleep(0.2)

    active_state = "active" if process.poll() is None else "failed"
    sub_state = "running" if process.poll() is None else "exited"
    save_meta(
        unit,
        {
            "pid": process.pid,
            "started_at": time.time(),
            "status": active_state,
            "sub_status": sub_state,
        },
    )
    if process.poll() is not None:
        raise SystemExit(f"failed to start {unit}")


def stop_unit(unit: str) -> None:
    meta = load_meta(unit)
    pid = int(meta.get("pid", 0) or 0)
    if pid <= 0:
        save_meta(unit, {"status": "inactive", "sub_status": "dead"})
        return

    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        save_meta(unit, {"status": "inactive", "sub_status": "dead"})
        return

    deadline = time.time() + 10
    while time.time() < deadline:
        if not process_alive(pid):
            save_meta(unit, {"status": "inactive", "sub_status": "dead"})
            return
        time.sleep(0.2)

    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    save_meta(unit, {"status": "inactive", "sub_status": "dead"})


def read_state(unit: str) -> dict[str, object]:
    load_state = "loaded" if unit_path(unit).exists() else "not-found"
    unit_file_state = "enabled" if marker_path(unit).exists() else "disabled"
    meta = load_meta(unit)
    pid = int(meta.get("pid", 0) or 0)

    if pid > 0 and process_alive(pid):
        active_state = "active"
        sub_state = "running"
        main_pid = pid
    elif meta.get("status") == "failed":
        active_state = "failed"
        sub_state = str(meta.get("sub_status") or "failed")
        main_pid = 0
    else:
        active_state = "inactive"
        sub_state = "dead"
        main_pid = 0

    return {
        "ActiveState": active_state,
        "LoadState": load_state,
        "MainPID": main_pid,
        "SubState": sub_state,
        "UnitFileState": unit_file_state,
    }


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def iter_environment(unit_data: dict[str, object]) -> dict[str, str]:
    environment: dict[str, str] = {}
    for inline_env in unit_data.get("EnvironmentLines", []):
        key, value = parse_assignment(str(inline_env))
        environment[key] = value

    for env_file in unit_data.get("EnvironmentFileLines", []):
        path = Path(str(env_file))
        if path.exists():
            for raw_line in path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                environment[key] = value
    return environment


def parse_assignment(value: str) -> tuple[str, str]:
    cleaned = value.strip()
    if cleaned.startswith('"') and cleaned.endswith('"'):
        cleaned = cleaned[1:-1]
    key, parsed = cleaned.split("=", 1)
    return key, parsed


def list_units() -> int:
    for path in sorted(UNIT_DIRECTORY.glob("*.service")):
        state = read_state(path.name)
        display_name = path.name[:-8] if path.name.endswith(".service") else path.name
        print(
            f"{path.name} loaded {state['ActiveState']} {state['SubState']} "
            f"{display_name}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
