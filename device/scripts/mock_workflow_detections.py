#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
import uuid
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DEVICE_ROOT = REPO_ROOT / "device"
COMPOSE_FILE = DEVICE_ROOT / "localdev" / "docker-compose.yml"
COMPOSE_ENV_FILE = DEVICE_ROOT / ".localdev" / "compose.env"
LOCAL_SHARED_DIR = DEVICE_ROOT / ".localdev" / "shared"
RUNTIME_SHARED_DIR = "/home/hacklab/trakrai-device-runtime/shared"
RUNTIME_CONFIG_PATH = "/home/hacklab/trakrai-device-runtime/configs/workflow-engine.json"


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

    if not COMPOSE_ENV_FILE.exists():
        raise SystemExit(
            f"Local device compose env not found at {COMPOSE_ENV_FILE}. Start the local device stack first."
        )

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        raise SystemExit(f"Input file does not exist: {input_path}")

    local_target = LOCAL_SHARED_DIR / Path(args.shared_target)
    local_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(input_path, local_target)

    runtime_target = f"{RUNTIME_SHARED_DIR}/{Path(args.shared_target).as_posix()}"
    command = compose_command(
        "exec",
        "-T",
        "device-emulator",
        "python3.8",
        "-m",
        "trakrai_workflow_engine.mock_feed",
        "--config",
        RUNTIME_CONFIG_PATH,
        "--input",
        runtime_target,
        "--request-timeout-sec",
        str(args.request_timeout_sec),
        "--source-service",
        f"workflow-feed-host-{uuid.uuid4().hex[:8]}",
    )
    if args.delay_ms >= 0:
        command.extend(["--delay-ms", str(args.delay_ms)])

    result = subprocess.run(
        command,
        cwd=DEVICE_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout or f"command failed: {' '.join(command)}")
    print(result.stdout, end="")
    return 0


def compose_command(*args: str) -> list[str]:
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
