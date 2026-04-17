#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
import uuid
from pathlib import Path

from device.devtool import paths

COMPOSE_FILE = paths.LOCALDEV_COMPOSE_FILE
COMPOSE_ENV_FILE = paths.LOCALDEV_COMPOSE_ENV
LOCAL_SHARED_DIR = paths.LOCALDEV_SHARED_ROOT
RUNTIME_SHARED_DIR = f"{paths.DEFAULT_RUNTIME_ROOT}/shared"
RUNTIME_CONFIG_PATH = f"{paths.DEFAULT_RUNTIME_ROOT}/configs/workflow-engine.json"


def feed_mock_detections(
    *,
    input_path: Path,
    compose_project_name: str,
    delay_ms: int,
    request_timeout_sec: float,
    shared_target: str,
) -> str:
    if not COMPOSE_ENV_FILE.exists():
        raise SystemExit(
            f"Local device compose env not found at {COMPOSE_ENV_FILE}. Start the local device stack first."
        )

    resolved_input_path = input_path.expanduser().resolve()
    if not resolved_input_path.exists():
        raise SystemExit(f"Input file does not exist: {resolved_input_path}")

    local_target = LOCAL_SHARED_DIR / Path(shared_target)
    local_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(resolved_input_path, local_target)

    runtime_target = f"{RUNTIME_SHARED_DIR}/{Path(shared_target).as_posix()}"
    command = compose_command(
        compose_project_name,
        "exec",
        "-T",
        "device-emulator",
        "python3.8",
        "-m",
        "workflow_engine.mock_feed",
        "--config",
        RUNTIME_CONFIG_PATH,
        "--input",
        runtime_target,
        "--request-timeout-sec",
        str(request_timeout_sec),
        "--source-service",
        f"workflow-feed-host-{uuid.uuid4().hex[:8]}",
    )
    if delay_ms >= 0:
        command.extend(["--delay-ms", str(delay_ms)])

    result = subprocess.run(
        command,
        cwd=paths.DEVICE_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout or f"command failed: {' '.join(command)}")
    return result.stdout


def main() -> int:
    parser = argparse.ArgumentParser(description="Feed mock detections into the local workflow-engine service.")
    parser.add_argument("--input", required=True, help="host path to a JSON file describing detection frames")
    parser.add_argument("--compose-project-name", default="trakrai-local-device")
    parser.add_argument("--delay-ms", type=int, default=-1)
    parser.add_argument("--request-timeout-sec", type=float, default=10.0)
    parser.add_argument(
        "--shared-target",
        default="mock-workflow-inputs/detections.json",
        help="relative path under the emulator shared dir where the payload file will be copied",
    )
    args = parser.parse_args()
    print(
        feed_mock_detections(
            input_path=Path(args.input),
            compose_project_name=args.compose_project_name,
            delay_ms=args.delay_ms,
            request_timeout_sec=args.request_timeout_sec,
            shared_target=args.shared_target,
        ),
        end="",
    )
    return 0


def compose_command(compose_project_name: str, *args: str) -> list[str]:
    del compose_project_name
    return [
        "docker",
        "compose",
        "--env-file",
        str(COMPOSE_ENV_FILE),
        "-f",
        str(COMPOSE_FILE),
        *args,
    ]


if __name__ == "__main__":
    raise SystemExit(main())
