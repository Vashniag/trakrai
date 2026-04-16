#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import device_runtime_common as common


COMPOSE_FILE = common.DEVICE_ROOT / "localdev" / "docker-compose.yml"
LOCALDEV_ROOT = common.DEVICE_ROOT / ".localdev"
STAGE_DIR = LOCALDEV_ROOT / "stage"
COMPOSE_ENV_FILE = LOCALDEV_ROOT / "compose.env"
SHARED_DIR = LOCALDEV_ROOT / "shared"
DEFAULT_CONFIG_DIR = common.DEVICE_ROOT / "localdev" / "configs"
DEFAULT_PROJECT_NAME = "trakrai-local-device"
DEFAULT_RUNTIME_ROOT = "/home/hacklab/trakrai-device-runtime"
DEFAULT_UNIT_DIRECTORY = f"{DEFAULT_RUNTIME_ROOT}/units"
DEFAULT_PUBLIC_HTTP_PORT = 18080
DEFAULT_PUBLIC_RTSP_PORT = 18554
DEFAULT_WEBRTC_UDP_PORT_MIN = 40000
DEFAULT_WEBRTC_UDP_PORT_MAX = 40049
LOCALDEV_WORKFLOW_TEMPLATE = common.DEVICE_ROOT / "localdev" / "workflows" / "minimal-detection-workflow.json"
LOCALDEV_ROI_TEMPLATE = common.DEVICE_ROOT / "localdev" / "roi" / "roi-config.json"
LOCALDEV_AUDIO_CODES_TEMPLATE = common.DEVICE_ROOT / "localdev" / "audio" / "speaker-codes.csv"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a local Docker-based TrakrAI device emulator.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    up_parser = subparsers.add_parser("up", help="build, stage, and start the local device stack")
    up_parser.add_argument("--video", required=True, help="path to the MP4 file to loop as the fake camera stream")
    up_parser.add_argument("--config-dir", default=str(DEFAULT_CONFIG_DIR), help="directory containing local device JSON configs")
    up_parser.add_argument("--mqtt-host", default="host.docker.internal", help="hostname/IP of the existing Mosquitto broker")
    up_parser.add_argument("--mqtt-port", type=int, default=1883, help="port of the existing Mosquitto broker")
    up_parser.add_argument(
        "--cloud-api-base-url",
        default="http://host.docker.internal:3000",
        help="base URL for the real cloud API as seen from inside the device container",
    )
    up_parser.add_argument(
        "--cloud-api-auth-token",
        default="",
        help="optional bearer token for cloud storage presign requests",
    )
    up_parser.add_argument("--device-id", default="trakrai-device-local", help="device ID to expose from cloud-comm")
    up_parser.add_argument(
        "--http-port",
        type=int,
        default=DEFAULT_PUBLIC_HTTP_PORT,
        help="host port for the device edge UI/API",
    )
    up_parser.add_argument(
        "--rtsp-port",
        type=int,
        default=DEFAULT_PUBLIC_RTSP_PORT,
        help="host port for the fake camera RTSP server",
    )
    up_parser.add_argument("--platform", default=common.DEFAULT_LOCAL_PLATFORM, help="Docker platform for local builds, for example linux/arm64")
    up_parser.add_argument("--skip-build", action="store_true", help="reuse existing device/out artifacts")
    up_parser.add_argument("--skip-ui-build", action="store_true", help="fail instead of building the device UI export when missing")
    up_parser.add_argument("--compose-project-name", default=DEFAULT_PROJECT_NAME)
    up_parser.add_argument("--start-mode", default="all", choices=["core", "all"])
    up_parser.add_argument(
        "--webrtc-udp-port-min",
        type=int,
        default=DEFAULT_WEBRTC_UDP_PORT_MIN,
        help="first host UDP port to publish for live-feed WebRTC media",
    )
    up_parser.add_argument(
        "--webrtc-udp-port-max",
        type=int,
        default=DEFAULT_WEBRTC_UDP_PORT_MAX,
        help="last host UDP port to publish for live-feed WebRTC media",
    )
    up_parser.add_argument(
        "--webrtc-host-candidate-ip",
        default="127.0.0.1",
        help="host IP advertised by live-feed for local WebRTC candidates",
    )

    down_parser = subparsers.add_parser("down", help="stop the local device stack")
    down_parser.add_argument("--compose-project-name", default=DEFAULT_PROJECT_NAME)
    down_parser.add_argument("--volumes", action="store_true", help="also remove compose volumes")
    down_parser.add_argument("--keep-stage", action="store_true", help="keep the generated local stage directory")

    status_parser = subparsers.add_parser("status", help="show compose status")
    status_parser.add_argument("--compose-project-name", default=DEFAULT_PROJECT_NAME)

    logs_parser = subparsers.add_parser("logs", help="tail compose logs")
    logs_parser.add_argument("--compose-project-name", default=DEFAULT_PROJECT_NAME)
    logs_parser.add_argument(
        "--service",
        choices=["device-emulator", "fake-camera", "minio", "mock-speaker", "redis"],
        help="optional service filter",
    )
    logs_parser.add_argument("--lines", type=int, default=200)

    args = parser.parse_args()

    if args.command == "up":
        return cmd_up(args)
    if args.command == "down":
        return cmd_down(args)
    if args.command == "status":
        return cmd_status(args)
    if args.command == "logs":
        return cmd_logs(args)
    raise SystemExit(f"unsupported command: {args.command}")


def cmd_up(args: argparse.Namespace) -> int:
    video_path = Path(args.video).expanduser().resolve()
    if not video_path.exists():
        raise SystemExit(f"Video file does not exist: {video_path}")
    if video_path.suffix.lower() != ".mp4":
        raise SystemExit(f"Expected an MP4 file for --video, got: {video_path}")
    if args.webrtc_udp_port_min <= 0 or args.webrtc_udp_port_max <= 0:
        raise SystemExit("--webrtc-udp-port-min and --webrtc-udp-port-max must both be greater than 0")
    if args.webrtc_udp_port_min > args.webrtc_udp_port_max:
        raise SystemExit("--webrtc-udp-port-min must be less than or equal to --webrtc-udp-port-max")

    config_map = common.load_local_config_dir(Path(args.config_dir).expanduser().resolve())
    config_map = patch_local_configs(
        config_map,
        mqtt_host=args.mqtt_host,
        mqtt_port=args.mqtt_port,
        cloud_api_auth_token=args.cloud_api_auth_token,
        cloud_api_base_url=args.cloud_api_base_url,
        device_id=args.device_id,
        webrtc_host_candidate_ip=args.webrtc_host_candidate_ip,
        webrtc_udp_port_min=args.webrtc_udp_port_min,
        webrtc_udp_port_max=args.webrtc_udp_port_max,
    )

    artifact_paths = common.ensure_local_artifacts(
        skip_build=args.skip_build,
        platform=args.platform,
        include_python_wheels={
            target.config_name for target in common.PYTHON_WHEEL_TARGETS if target.config_name in config_map
        },
        require_ui=True,
        build_ui_if_missing=not args.skip_ui_build,
    )

    if STAGE_DIR.exists():
        shutil.rmtree(STAGE_DIR)
    STAGE_DIR.mkdir(parents=True, exist_ok=True)

    options = common.StageOptions(
        runtime_root=DEFAULT_RUNTIME_ROOT,
        runtime_user="hacklab",
        runtime_group="hacklab",
        unit_directory=DEFAULT_UNIT_DIRECTORY,
        cloud_bridge_url=f"ws://127.0.0.1:{args.http_port}/ws",
        transport_mode="edge",
        http_port=8080,
        public_http_port=args.http_port,
        start_mode=args.start_mode,
        edge_host="127.0.0.1",
    )
    common.prepare_stage(STAGE_DIR, artifact_paths, config_map, options)
    shutil.copy2(common.DEVICE_ROOT / "scripts" / "bootstrap_device_runtime.py", STAGE_DIR / "bootstrap_device_runtime.py")

    LOCALDEV_ROOT.mkdir(parents=True, exist_ok=True)
    SHARED_DIR.mkdir(parents=True, exist_ok=True)
    seed_local_workflow_assets(config_map)
    seed_local_roi_assets(config_map)
    seed_local_audio_assets(config_map)
    write_compose_env(
        compose_project_name=args.compose_project_name,
        stage_dir=STAGE_DIR,
        shared_dir=SHARED_DIR,
        video_path=video_path,
        http_port=args.http_port,
        rtsp_port=args.rtsp_port,
        webrtc_udp_port_min=args.webrtc_udp_port_min,
        webrtc_udp_port_max=args.webrtc_udp_port_max,
    )

    env = compose_env(args.compose_project_name, args.platform)
    run_compose(["up", "--build", "-d", "--wait"], env=env)
    verify_local_stack(env=env)

    print("")
    print(f"Device edge UI: http://127.0.0.1:{args.http_port}")
    print(f"Cloud API (from device): {args.cloud_api_base_url}")
    print(f"Fake RTSP feed: rtsp://127.0.0.1:{args.rtsp_port}/stream")
    print("Mock speaker API: http://127.0.0.1:18910")
    print(f"Host shared dir: {SHARED_DIR}")
    return 0


def cmd_down(args: argparse.Namespace) -> int:
    env = compose_env(args.compose_project_name, common.DEFAULT_LOCAL_PLATFORM)
    command = ["down"]
    if args.volumes:
        command.append("--volumes")
    run_compose(command, env=env, check=False)
    if not args.keep_stage and STAGE_DIR.exists():
        shutil.rmtree(STAGE_DIR)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    env = compose_env(args.compose_project_name, common.DEFAULT_LOCAL_PLATFORM)
    run_compose(["ps"], env=env)
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    env = compose_env(args.compose_project_name, common.DEFAULT_LOCAL_PLATFORM)
    command = ["logs", "--tail", str(args.lines)]
    if args.service:
        command.append(args.service)
    run_compose(command, env=env)
    return 0


def patch_local_configs(
    config_map: dict[str, dict[str, object]],
    *,
    mqtt_host: str,
    mqtt_port: int,
    cloud_api_auth_token: str,
    cloud_api_base_url: str,
    device_id: str,
    webrtc_host_candidate_ip: str,
    webrtc_udp_port_min: int,
    webrtc_udp_port_max: int,
) -> dict[str, dict[str, object]]:
    patched = json.loads(json.dumps(config_map))
    cloud_comm = patched["cloud-comm.json"]
    mqtt = cloud_comm.setdefault("mqtt", {})
    mqtt["broker_url"] = f"tcp://{mqtt_host}:{mqtt_port}"
    cloud_comm["device_id"] = device_id

    cloud_transfer = patched.get("cloud-transfer.json")
    if isinstance(cloud_transfer, dict):
        cloud_transfer["device_id"] = device_id
        cloud_api = cloud_transfer.setdefault("cloud_api", {})
        cloud_api["auth_token"] = cloud_api_auth_token
        cloud_api["base_url"] = cloud_api_base_url.rstrip("/")

    workflow_engine = patched.get("workflow-engine.json")
    if isinstance(workflow_engine, dict):
        workflow_engine["device_id"] = device_id

    audio_manager = patched.get("audio-manager.json")
    if isinstance(audio_manager, dict):
        audio_manager["device_id"] = device_id

    live_feed = patched.get("live-feed.json")
    if isinstance(live_feed, dict):
        webrtc = live_feed.setdefault("webrtc", {})
        host_candidate_ip = webrtc_host_candidate_ip.strip()
        webrtc["host_candidate_ips"] = [host_candidate_ip] if host_candidate_ip else []
        webrtc["udp_port_range"] = {
            "min": webrtc_udp_port_min,
            "max": webrtc_udp_port_max,
        }
    return patched


def seed_local_workflow_assets(config_map: dict[str, dict[str, object]]) -> None:
    workflow_config = config_map.get("workflow-engine.json")
    if not isinstance(workflow_config, dict):
        return
    workflow = workflow_config.get("workflow")
    if not isinstance(workflow, dict):
        return
    workflow_path = str(workflow.get("file_path", "")).strip()
    runtime_shared_prefix = f"{DEFAULT_RUNTIME_ROOT}/shared/"
    if not workflow_path.startswith(runtime_shared_prefix):
        return

    relative_path = Path(workflow_path[len(runtime_shared_prefix) :])
    host_path = SHARED_DIR / relative_path
    if host_path.exists():
        return
    host_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(LOCALDEV_WORKFLOW_TEMPLATE, host_path)


def seed_local_roi_assets(config_map: dict[str, dict[str, object]]) -> None:
    roi_config = config_map.get("roi-config.json")
    if not isinstance(roi_config, dict):
        return
    storage = roi_config.get("storage")
    if not isinstance(storage, dict):
        return
    file_path = str(storage.get("file_path", "")).strip()
    runtime_shared_prefix = f"{DEFAULT_RUNTIME_ROOT}/shared/"
    if not file_path.startswith(runtime_shared_prefix):
        return

    relative_path = Path(file_path[len(runtime_shared_prefix) :])
    host_path = SHARED_DIR / relative_path
    if host_path.exists():
        return
    host_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(LOCALDEV_ROI_TEMPLATE, host_path)


def seed_local_audio_assets(config_map: dict[str, dict[str, object]]) -> None:
    audio_config = config_map.get("audio-manager.json")
    if not isinstance(audio_config, dict):
        return
    speaker = audio_config.get("speaker")
    if not isinstance(speaker, dict):
        return
    mapping_file = str(speaker.get("mapping_file", "")).strip()
    runtime_shared_prefix = f"{DEFAULT_RUNTIME_ROOT}/shared/"
    if not mapping_file.startswith(runtime_shared_prefix):
        return

    relative_path = Path(mapping_file[len(runtime_shared_prefix) :])
    host_path = SHARED_DIR / relative_path
    if host_path.exists():
        return
    host_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(LOCALDEV_AUDIO_CODES_TEMPLATE, host_path)


def write_compose_env(
    *,
    compose_project_name: str,
    stage_dir: Path,
    shared_dir: Path,
    video_path: Path,
    http_port: int,
    rtsp_port: int,
    webrtc_udp_port_min: int,
    webrtc_udp_port_max: int,
) -> None:
    COMPOSE_ENV_FILE.write_text(
        "\n".join(
            [
                f"COMPOSE_PROJECT_NAME={compose_project_name}",
                f"TRAKRAI_LOCAL_STAGE_DIR={stage_dir}",
                f"TRAKRAI_LOCAL_SHARED_DIR={shared_dir}",
                f"TRAKRAI_LOCAL_VIDEO_FILE={video_path}",
                f"TRAKRAI_LOCAL_HTTP_PORT={http_port}",
                f"TRAKRAI_LOCAL_RTSP_PORT={rtsp_port}",
                f"TRAKRAI_LOCAL_WEBRTC_UDP_PORT_RANGE={webrtc_udp_port_min}-{webrtc_udp_port_max}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def compose_env(project_name: str, platform: str) -> dict[str, str]:
    env = os.environ.copy()
    env["COMPOSE_PROJECT_NAME"] = project_name
    env["DOCKER_DEFAULT_PLATFORM"] = platform
    return env


def run_compose(command: list[str], *, env: dict[str, str], check: bool = True) -> None:
    full_command = [
        "docker",
        "compose",
        "--env-file",
        str(COMPOSE_ENV_FILE),
        "-f",
        str(COMPOSE_FILE),
        *command,
    ]
    print("+", " ".join(full_command))
    result = subprocess.run(full_command, cwd=common.DEVICE_ROOT, env=env, check=False)
    if check and result.returncode != 0:
        raise SystemExit(result.returncode)


def run_local(command: list[str], *, env: dict[str, str], capture_output: bool = False, check: bool = True) -> str:
    print("+", " ".join(command))
    result = subprocess.run(
        command,
        cwd=common.DEVICE_ROOT,
        env=env,
        text=True,
        capture_output=capture_output,
        check=False,
    )
    if check and result.returncode != 0:
        if capture_output:
            raise SystemExit(result.stderr or result.stdout)
        raise SystemExit(result.returncode)
    return result.stdout if capture_output else ""


def verify_local_stack(*, env: dict[str, str]) -> None:
    run_compose(["ps"], env=env)
    run_local(
        [
            "docker",
            "compose",
            "--env-file",
            str(COMPOSE_ENV_FILE),
            "-f",
            str(COMPOSE_FILE),
            "exec",
            "-T",
            "device-emulator",
            "bash",
            "-lc",
            (
                "set -euo pipefail; "
                "test -f /home/hacklab/trakrai-device-runtime/shared/audio/speaker-codes.csv; "
                "test -x /home/hacklab/trakrai-device-runtime/bin/cloud-comm; "
                "test -x /home/hacklab/trakrai-device-runtime/bin/cloud-transfer; "
                "test -x /home/hacklab/trakrai-device-runtime/bin/live-feed; "
                "test -x /home/hacklab/trakrai-device-runtime/bin/ptz-control; "
                "test -x /home/hacklab/trakrai-device-runtime/bin/roi-config; "
                "test -x /home/hacklab/trakrai-device-runtime/bin/rtsp-feeder; "
                "python3.8 --version; "
                "systemctl is-active trakrai-runtime-manager.service; "
                "systemctl is-active trakrai-audio-manager.service; "
                "systemctl is-active trakrai-cloud-comm.service; "
                "systemctl is-active trakrai-cloud-transfer.service; "
                "systemctl is-active trakrai-workflow-engine.service; "
                "systemctl is-active trakrai-live-feed.service; "
                "systemctl is-active trakrai-ptz-control.service; "
                "systemctl is-active trakrai-roi-config.service; "
                "systemctl is-active trakrai-rtsp-feeder.service"
            ),
        ],
        env=env,
    )
    wait_for_redis_frame(env=env)
    run_local(
        [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            f"http://127.0.0.1:{read_compose_value('TRAKRAI_LOCAL_HTTP_PORT')}/api/runtime-config",
        ],
        env=env,
    )


def read_compose_value(name: str) -> str:
    values: dict[str, str] = {}
    for line in COMPOSE_ENV_FILE.read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values[name]


def wait_for_redis_frame(*, env: dict[str, str]) -> None:
    command = [
        "docker",
        "compose",
        "--env-file",
        str(COMPOSE_ENV_FILE),
        "-f",
        str(COMPOSE_FILE),
        "exec",
        "-T",
        "redis",
        "redis-cli",
        "--raw",
        "HEXISTS",
        "camera:Camera-1:latest",
        "raw",
    ]
    deadline = time.time() + 30
    while time.time() < deadline:
        output = run_local(command, env=env, capture_output=True, check=False).strip()
        if output == "1":
            return
        time.sleep(1)
    raise SystemExit("Timed out waiting for rtsp-feeder to publish a frame into Redis")


if __name__ == "__main__":
    raise SystemExit(main())
