#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import urlopen

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
DEFAULT_HOST_AUDIO_PORT = 18920
DEFAULT_WEBRTC_UDP_PORT_MIN = 40000
DEFAULT_WEBRTC_UDP_PORT_MAX = 40049
LOCALDEV_WORKFLOW_TEMPLATE = common.DEVICE_ROOT / "localdev" / "workflows" / "minimal-detection-workflow.json"
LOCALDEV_ROI_TEMPLATE = common.DEVICE_ROOT / "localdev" / "roi" / "roi-config.json"
COMPOSE_SERVICES = {"device-emulator", "fake-camera", "minio", "mock-speaker", "redis"}
LOCALDEV_AUDIO_CODES_TEMPLATE = common.DEVICE_ROOT / "localdev" / "audio" / "speaker-codes.csv"
HOST_AUDIO_PLAYER_SCRIPT = common.DEVICE_ROOT / "localdev" / "host-audio-player" / "server.py"
HOST_AUDIO_DIR = LOCALDEV_ROOT / "host-audio-player"
HOST_AUDIO_PID_FILE = HOST_AUDIO_DIR / "server.pid"
HOST_AUDIO_LOG_FILE = HOST_AUDIO_DIR / "server.log"
HOST_AUDIO_META_FILE = HOST_AUDIO_DIR / "server.json"


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
        "--cloud-api-access-token",
        default="",
        help="optional device access token used for cloud presign requests from the local emulator",
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
    up_parser.add_argument(
        "--host-audio-port",
        type=int,
        default=DEFAULT_HOST_AUDIO_PORT,
        help="host port for the local host-audio-player relay",
    )
    up_parser.add_argument(
        "--disable-host-audio-playback",
        action="store_true",
        help="keep audio-manager local playback mocked instead of playing through the laptop speakers",
    )
    up_parser.add_argument("--platform", default=common.DEFAULT_LOCAL_PLATFORM, help="Docker platform for local builds, for example linux/arm64")
    up_parser.add_argument("--skip-build", action="store_true", help="reuse existing device/out artifacts")
    up_parser.add_argument("--skip-ui-build", action="store_true", help="fail instead of building the device UI export when missing")
    up_parser.add_argument(
        "--skip-compose-build",
        action="store_true",
        help="skip `docker compose` image builds and only (re)start containers",
    )
    up_parser.add_argument(
        "--compose-build-services",
        default="",
        help=(
            "comma-separated docker compose services to build before `up` "
            "(for example: device-emulator,fake-camera). "
            "If omitted, `up` reuses existing images and only falls back to build when startup fails."
        ),
    )
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
        choices=["device-emulator", "fake-camera", "host-audio-player", "minio", "mock-speaker", "redis"],
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
    if args.host_audio_port <= 0:
        raise SystemExit("--host-audio-port must be greater than 0")

    enable_host_audio_playback = not args.disable_host_audio_playback

    config_map = common.load_local_config_dir(Path(args.config_dir).expanduser().resolve())
    config_map = patch_local_configs(
        config_map,
        mqtt_host=args.mqtt_host,
        mqtt_port=args.mqtt_port,
        cloud_api_access_token=args.cloud_api_access_token,
        cloud_api_base_url=args.cloud_api_base_url,
        device_id=args.device_id,
        webrtc_host_candidate_ip=args.webrtc_host_candidate_ip,
        webrtc_udp_port_min=args.webrtc_udp_port_min,
        webrtc_udp_port_max=args.webrtc_udp_port_max,
        enable_host_audio_playback=enable_host_audio_playback,
        host_audio_port=args.host_audio_port,
    )
    compose_services = required_compose_services(config_map, cloud_api_base_url=args.cloud_api_base_url)

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
    if enable_host_audio_playback:
        ensure_host_audio_player(args.host_audio_port)
    else:
        stop_host_audio_player()
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
    prune_compose_services(env=env, desired_services=compose_services)
    compose_build_services = parse_compose_services_arg(args.compose_build_services)
    if args.skip_compose_build:
        run_compose(["up", "-d", "--wait", "--remove-orphans", *compose_services], env=env)
    else:
        if compose_build_services:
            run_compose(["build", *compose_build_services], env=env)
            run_compose(["up", "-d", "--wait", "--remove-orphans", *compose_services], env=env)
        else:
            exit_code = run_compose(["up", "-d", "--wait", "--remove-orphans", *compose_services], env=env, check=False)
            if exit_code != 0:
                print("`docker compose up` failed without a rebuild; retrying with `--build` once.")
                run_compose(["up", "--build", "-d", "--wait", "--remove-orphans", *compose_services], env=env)
    # The staged runtime is only applied when device-emulator bootstraps, so recreate it
    # on every `up` to ensure updated UI/config payloads are installed into the runtime volume.
    run_compose(["up", "-d", "--wait", "--force-recreate", "--remove-orphans", "device-emulator"], env=env)
    verify_local_stack(
        env=env,
        config_map=config_map,
        start_mode=args.start_mode,
        host_audio_port=args.host_audio_port if enable_host_audio_playback else None,
    )

    print("")
    print(f"Device edge UI: http://127.0.0.1:{args.http_port}")
    print(f"Cloud API (from device): {args.cloud_api_base_url}")
    print(f"Fake RTSP feed: rtsp://127.0.0.1:{args.rtsp_port}/stream")
    print("Mock speaker API: http://127.0.0.1:18910")
    if enable_host_audio_playback:
        print(f"Host audio relay: http://127.0.0.1:{args.host_audio_port}")
    print(f"Host shared dir: {SHARED_DIR}")
    return 0


def cmd_down(args: argparse.Namespace) -> int:
    env = compose_env(args.compose_project_name, common.DEFAULT_LOCAL_PLATFORM)
    command = ["down"]
    if args.volumes:
        command.append("--volumes")
    run_compose(command, env=env, check=False)
    stop_host_audio_player()
    if not args.keep_stage and STAGE_DIR.exists():
        shutil.rmtree(STAGE_DIR)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    env = compose_env(args.compose_project_name, common.DEFAULT_LOCAL_PLATFORM)
    run_compose(["ps"], env=env)
    print_host_audio_status()
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    if args.service == "host-audio-player":
        tail_host_audio_logs(args.lines)
        return 0
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
    cloud_api_access_token: str,
    cloud_api_base_url: str,
    device_id: str,
    webrtc_host_candidate_ip: str,
    webrtc_udp_port_min: int,
    webrtc_udp_port_max: int,
    enable_host_audio_playback: bool,
    host_audio_port: int,
) -> dict[str, dict[str, object]]:
    patched = json.loads(json.dumps(config_map))
    cloud_comm = patched["cloud-comm.json"]
    mqtt = cloud_comm.setdefault("mqtt", {})
    mqtt["broker_url"] = f"tcp://{mqtt_host}:{mqtt_port}"
    mqtt["client_id"] = device_id
    cloud_comm["device_id"] = device_id

    cloud_transfer = patched.get("cloud-transfer.json")
    if isinstance(cloud_transfer, dict):
        cloud_transfer["device_id"] = device_id
        cloud_api = cloud_transfer.setdefault("cloud_api", {})
        cloud_api["access_token"] = cloud_api_access_token
        cloud_api["base_url"] = cloud_api_base_url.rstrip("/")

    workflow_engine = patched.get("workflow-engine.json")
    if isinstance(workflow_engine, dict):
        workflow_engine["device_id"] = device_id

    audio_manager = patched.get("audio-manager.json")
    if isinstance(audio_manager, dict):
        audio_manager["device_id"] = device_id
        playback = audio_manager.setdefault("playback", {})
        if isinstance(playback, dict):
            if enable_host_audio_playback:
                playback["backend"] = "command"
                playback["timeout_sec"] = max(int(playback.get("timeout_sec", 60) or 60), 60)
                playback["command_template"] = [
                    "curl",
                    "--fail",
                    "--silent",
                    "--show-error",
                    "-X",
                    "POST",
                    "--data-binary",
                    "@{audio_path}",
                    "-H",
                    "Content-Type: {audio_content_type}",
                    f"http://host.docker.internal:{host_audio_port}/play",
                ]
            else:
                playback["backend"] = "mock"
                playback.pop("command_template", None)

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
    stage_path = compose_bind_path(stage_dir)
    shared_path = compose_bind_path(shared_dir)
    video_file_path = compose_bind_path(video_path)
    COMPOSE_ENV_FILE.write_text(
        "\n".join(
            [
                f"COMPOSE_PROJECT_NAME={compose_project_name}",
                f"TRAKRAI_LOCAL_STAGE_DIR={stage_path}",
                f"TRAKRAI_LOCAL_SHARED_DIR={shared_path}",
                f"TRAKRAI_LOCAL_VIDEO_FILE={video_file_path}",
                f"TRAKRAI_LOCAL_HTTP_PORT={http_port}",
                f"TRAKRAI_LOCAL_RTSP_PORT={rtsp_port}",
                f"TRAKRAI_LOCAL_WEBRTC_UDP_PORT_RANGE={webrtc_udp_port_min}-{webrtc_udp_port_max}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def ensure_host_audio_player(port: int) -> None:
    HOST_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    existing_pid = read_host_audio_pid()
    if existing_pid is not None and process_alive(existing_pid) and host_audio_healthy(port):
        return

    if existing_pid is not None:
        stop_host_audio_player()

    log_handle = HOST_AUDIO_LOG_FILE.open("a", encoding="utf-8")
    try:
        process = subprocess.Popen(
            [
                sys.executable or "python",
                str(HOST_AUDIO_PLAYER_SCRIPT),
                "--port",
                str(port),
                "--state-dir",
                str(HOST_AUDIO_DIR),
            ],
            cwd=common.DEVICE_ROOT,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    finally:
        log_handle.close()
    HOST_AUDIO_PID_FILE.write_text(str(process.pid), encoding="utf-8")
    HOST_AUDIO_META_FILE.write_text(
        json.dumps({"pid": process.pid, "port": port}, indent=2) + "\n",
        encoding="utf-8",
    )

    deadline = time.time() + 10
    while time.time() < deadline:
        if process.poll() is not None:
            raise SystemExit(f"host-audio-player exited early; see {HOST_AUDIO_LOG_FILE}")
        if host_audio_healthy(port):
            return
        time.sleep(0.25)
    raise SystemExit(f"host-audio-player did not become healthy on port {port}; see {HOST_AUDIO_LOG_FILE}")


def stop_host_audio_player() -> None:
    pid = read_host_audio_pid()
    if pid is None:
        return
    terminate_host_audio_process(pid, force=False)
    deadline = time.time() + 5
    while time.time() < deadline:
        if not process_alive(pid):
            break
        time.sleep(0.1)
    else:
        terminate_host_audio_process(pid, force=True)
    for path in (HOST_AUDIO_PID_FILE, HOST_AUDIO_META_FILE):
        if path.exists():
            path.unlink()


def terminate_host_audio_process(pid: int, *, force: bool) -> None:
    if os.name == "nt":
        command = ["taskkill", "/PID", str(pid), "/T"]
        if force:
            command.append("/F")
        subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        return

    sig = signal.SIGKILL if force else signal.SIGTERM
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        pass


def read_host_audio_pid() -> int | None:
    if not HOST_AUDIO_PID_FILE.exists():
        return None
    raw = HOST_AUDIO_PID_FILE.read_text(encoding="utf-8").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def host_audio_healthy(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1.0) as response:
            return int(getattr(response, "status", response.getcode())) == 200
    except (OSError, urllib.error.URLError):
        return False


def print_host_audio_status() -> None:
    if not HOST_AUDIO_META_FILE.exists():
        print("host-audio-player: stopped")
        return
    try:
        metadata = json.loads(HOST_AUDIO_META_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"host-audio-player: invalid metadata file at {HOST_AUDIO_META_FILE}")
        return
    pid = int(metadata.get("pid", 0) or 0)
    port = int(metadata.get("port", 0) or 0)
    healthy = port > 0 and host_audio_healthy(port)
    state = "running" if pid > 0 and process_alive(pid) and healthy else "unhealthy"
    print(f"host-audio-player: {state} (pid={pid or 'n/a'}, port={port or 'n/a'})")


def tail_host_audio_logs(lines: int) -> None:
    if not HOST_AUDIO_LOG_FILE.exists():
        raise SystemExit(f"host-audio-player log file not found: {HOST_AUDIO_LOG_FILE}")
    if lines <= 0:
        return
    with HOST_AUDIO_LOG_FILE.open("r", encoding="utf-8", errors="replace") as handle:
        trailing_lines = deque(handle, maxlen=lines)
    for line in trailing_lines:
        print(line.rstrip("\n"))


def compose_env(project_name: str, platform: str) -> dict[str, str]:
    env = os.environ.copy()
    env["COMPOSE_PROJECT_NAME"] = project_name
    env["DOCKER_DEFAULT_PLATFORM"] = platform
    return env


def compose_bind_path(path: Path) -> str:
    # Docker compose accepts forward-slash paths on Windows (for example C:/Users/...).
    # Normalizing here avoids shell-specific backslash and drive-letter parsing issues.
    return path.resolve().as_posix()


def parse_compose_services_arg(raw_value: str) -> list[str]:
    items = [item.strip() for item in raw_value.split(",") if item.strip()]
    unknown = [item for item in items if item not in COMPOSE_SERVICES]
    if unknown:
        raise SystemExit(
            "Unknown compose service(s): "
            + ", ".join(unknown)
            + ". Expected one of: "
            + ", ".join(sorted(COMPOSE_SERVICES))
        )
    return items


def prune_compose_services(*, env: dict[str, str], desired_services: list[str]) -> None:
    extra_services = sorted(COMPOSE_SERVICES - set(desired_services))
    if not extra_services:
        return
    run_compose(["stop", *extra_services], env=env, check=False)
    run_compose(["rm", "-f", *extra_services], env=env, check=False)


def required_compose_services(
    config_map: dict[str, dict[str, object]],
    *,
    cloud_api_base_url: str,
) -> list[str]:
    services = {"device-emulator", "fake-camera", "redis"}
    if "audio-manager.json" in config_map:
        services.add("mock-speaker")
    if "cloud-transfer.json" in config_map and should_use_local_minio(cloud_api_base_url):
        services.add("minio")
    return sorted(services)


def should_use_local_minio(cloud_api_base_url: str) -> bool:
    raw_value = cloud_api_base_url.strip()
    if not raw_value:
        return False
    candidate = raw_value if "://" in raw_value else f"https://{raw_value}"
    parsed = urlparse(candidate)
    host = (parsed.hostname or "").strip().lower()
    return host in {"127.0.0.1", "localhost", "host.docker.internal"}


def run_compose(command: list[str], *, env: dict[str, str], check: bool = True) -> int:
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
    return result.returncode


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


def verify_local_stack(
    *,
    env: dict[str, str],
    config_map: dict[str, dict[str, object]],
    start_mode: str,
    host_audio_port: int | None,
) -> None:
    run_compose(["ps"], env=env)
    if host_audio_port is not None and not host_audio_healthy(host_audio_port):
        raise SystemExit(f"host-audio-player is not healthy on port {host_audio_port}")
    verification_checks = [
        "test -x /home/hacklab/trakrai-device-runtime/bin/cloud-comm",
        "test -x /home/hacklab/trakrai-device-runtime/bin/runtime-manager",
    ]
    for service_name in dynamic_binary_services(config_map):
        verification_checks.append(f"test -x /home/hacklab/trakrai-device-runtime/bin/{service_name}")
    if "audio-manager.json" in config_map:
        verification_checks.append("test -f /home/hacklab/trakrai-device-runtime/shared/audio/speaker-codes.csv")
    verification_checks.append("python3.8 --version")
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
            "set -euo pipefail; " + "; ".join(verification_checks),
        ],
        env=env,
    )
    wait_for_active_units(
        env=env,
        units=expected_active_units(config_map, start_mode=start_mode),
    )
    if start_mode != "core" and "rtsp-feeder.json" in config_map:
        wait_for_redis_frame(env=env)
    wait_for_runtime_config()


def dynamic_binary_services(config_map: dict[str, dict[str, object]]) -> list[str]:
    services: list[str] = []
    for service_name in ["cloud-transfer", "live-feed", "ptz-control", "roi-config", "rtsp-feeder"]:
        if f"{service_name}.json" in config_map:
            services.append(service_name)
    return services


def expected_active_units(
    config_map: dict[str, dict[str, object]],
    *,
    start_mode: str,
) -> list[str]:
    core_units = [
        "trakrai-runtime-manager.service",
        "trakrai-cloud-comm.service",
    ]
    if start_mode == "core":
        return core_units

    units = [*core_units]
    units.extend(f"trakrai-{service_name}.service" for service_name in dynamic_binary_services(config_map))
    for target in common.PYTHON_WHEEL_TARGETS:
        if target.config_name in config_map:
            units.append(common.wheel_systemd_unit(target))
    return units


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


def wait_for_active_units(*, env: dict[str, str], units: list[str], timeout_sec: int = 45) -> None:
    deadline = time.time() + timeout_sec
    latest_states: dict[str, str] = {}

    while time.time() < deadline:
        latest_states = read_unit_states(env=env, units=units)
        if all(latest_states.get(unit) == "active" for unit in units):
            return
        time.sleep(1)

    state_summary = ", ".join(f"{unit}={latest_states.get(unit, 'unknown')}" for unit in units)
    raise SystemExit(f"Timed out waiting for services to become active: {state_summary}")


def read_unit_states(*, env: dict[str, str], units: list[str]) -> dict[str, str]:
    command = [
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
            + " ".join(f"state=$(systemctl is-active {unit} || true); echo '{unit}:'\"${{state}}\";" for unit in units)
        ),
    ]
    result = subprocess.run(
        command,
        cwd=common.DEVICE_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    states: dict[str, str] = {}
    combined_output = "\n".join(part for part in [result.stdout, result.stderr] if part)
    for raw_line in combined_output.splitlines():
        line = raw_line.strip()
        if ":" not in line:
            continue
        unit, state = line.split(":", 1)
        unit = unit.strip()
        if unit in units:
            states[unit] = state.strip()
    return states


def wait_for_runtime_config(timeout_sec: int = 30) -> None:
    runtime_config_url = f"http://127.0.0.1:{read_compose_value('TRAKRAI_LOCAL_HTTP_PORT')}/api/runtime-config"
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with urlopen(runtime_config_url, timeout=5) as response:
                if 200 <= getattr(response, "status", 0) < 300:
                    return
        except URLError:
            pass
        time.sleep(1)
    raise SystemExit(f"Timed out waiting for runtime-config endpoint: {runtime_config_url}")


if __name__ == "__main__":
    raise SystemExit(main())
