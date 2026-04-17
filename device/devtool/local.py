from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path

from . import manifests, paths
from .build import resolve_local_artifacts
from .configs import default_webrtc_host_candidate_ip, generate_profile_config_map, parse_host_candidate_ip
from .request_files import apply_request_overrides, load_request_file
from .stage import StageOptions, prepare_stage
from .utils import DEFAULT_LOCAL_PLATFORM, ensure_clean_dir, run


HOST_AUDIO_PLAYER_SCRIPT = paths.DEVICE_ROOT / "localdev" / "host-audio-player" / "server.py"
HOST_AUDIO_DIR = paths.LOCALDEV_ROOT / "host-audio-player"
HOST_AUDIO_PID_FILE = HOST_AUDIO_DIR / "server.pid"
HOST_AUDIO_LOG_FILE = HOST_AUDIO_DIR / "server.log"
HOST_AUDIO_META_FILE = HOST_AUDIO_DIR / "server.json"


def compose_bind_path(path: Path) -> str:
    return path.resolve().as_posix()


def read_host_audio_pid() -> int | None:
    if not HOST_AUDIO_PID_FILE.exists():
        return None
    raw = HOST_AUDIO_PID_FILE.read_text(encoding="utf-8").strip()
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


def http_endpoint_healthy(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1.0) as response:
            return int(getattr(response, "status", response.getcode())) == 200
    except (OSError, urllib.error.URLError):
        return False


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


def ensure_host_audio_player(port: int) -> None:
    HOST_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    existing_pid = read_host_audio_pid()
    if host_audio_healthy(port):
        if existing_pid is None or not process_alive(existing_pid):
            if HOST_AUDIO_PID_FILE.exists():
                HOST_AUDIO_PID_FILE.unlink()
            HOST_AUDIO_META_FILE.write_text(json.dumps({"pid": 0, "port": port}, indent=2) + "\n", encoding="utf-8")
        return
    if existing_pid is not None and process_alive(existing_pid):
        return
    if existing_pid is not None:
        stop_host_audio_player()
    log_handle = HOST_AUDIO_LOG_FILE.open("a", encoding="utf-8")
    try:
        process = subprocess.Popen(
            [sys.executable or "python", str(HOST_AUDIO_PLAYER_SCRIPT), "--port", str(port), "--state-dir", str(HOST_AUDIO_DIR)],
            cwd=paths.DEVICE_ROOT,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    finally:
        log_handle.close()
    HOST_AUDIO_PID_FILE.write_text(str(process.pid), encoding="utf-8")
    HOST_AUDIO_META_FILE.write_text(json.dumps({"pid": process.pid, "port": port}, indent=2) + "\n", encoding="utf-8")
    deadline = time.time() + 10
    while time.time() < deadline:
        if process.poll() is not None:
            raise SystemExit(f"host-audio-player exited early; see {HOST_AUDIO_LOG_FILE}")
        if host_audio_healthy(port):
            return
        time.sleep(0.25)
    raise SystemExit(f"host-audio-player did not become healthy on port {port}")


def print_host_audio_status() -> None:
    if not HOST_AUDIO_META_FILE.exists():
        print("host-audio-player: stopped")
        return
    metadata = json.loads(HOST_AUDIO_META_FILE.read_text(encoding="utf-8"))
    pid = int(metadata.get("pid", 0) or 0)
    port = int(metadata.get("port", 0) or 0)
    healthy = port > 0 and host_audio_healthy(port)
    if healthy:
        state = "running"
    elif pid > 0 and process_alive(pid):
        state = "starting"
    else:
        state = "unhealthy"
    print(f"host-audio-player: {state} (pid={pid or 'n/a'}, port={port or 'n/a'})")


def tail_host_audio_logs(lines: int) -> None:
    if not HOST_AUDIO_LOG_FILE.exists():
        raise SystemExit(f"host-audio-player log file not found: {HOST_AUDIO_LOG_FILE}")
    with HOST_AUDIO_LOG_FILE.open("r", encoding="utf-8", errors="replace") as handle:
        trailing_lines = deque(handle, maxlen=lines)
    for line in trailing_lines:
        print(line.rstrip("\n"))


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
    paths.LOCALDEV_COMPOSE_ENV.write_text(
        "\n".join(
            [
                f"COMPOSE_PROJECT_NAME={compose_project_name}",
                f"TRAKRAI_LOCAL_STAGE_DIR={compose_bind_path(stage_dir)}",
                f"TRAKRAI_LOCAL_SHARED_DIR={compose_bind_path(shared_dir)}",
                f"TRAKRAI_LOCAL_VIDEO_FILE={compose_bind_path(video_path)}",
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


def run_compose(command: list[str], *, env: dict[str, str], check: bool = True) -> int:
    full_command = ["docker", "compose", "--env-file", str(paths.LOCALDEV_COMPOSE_ENV), "-f", str(paths.LOCALDEV_COMPOSE_FILE), *command]
    result = run(full_command, cwd=paths.DEVICE_ROOT, env=env, check=check)
    return result.returncode


def seed_local_shared_assets(config_map: dict[str, dict[str, object]]) -> None:
    workflow_engine = config_map.get("workflow-engine.json")
    if isinstance(workflow_engine, dict):
        workflow = workflow_engine.get("workflow")
        if isinstance(workflow, dict):
            workflow_path = str(workflow.get("file_path", "")).strip()
            prefix = f"{paths.DEFAULT_RUNTIME_ROOT}/shared/"
            if workflow_path.startswith(prefix):
                host_path = paths.LOCALDEV_SHARED_ROOT / workflow_path[len(prefix) :]
                if not host_path.exists():
                    host_path.parent.mkdir(parents=True, exist_ok=True)
                    source = paths.LOCALDEV_WORKFLOW_ROOT / "minimal-detection-workflow.json"
                    host_path.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    roi_config = config_map.get("roi-config.json")
    if isinstance(roi_config, dict):
        storage = roi_config.get("storage")
        if isinstance(storage, dict):
            file_path = str(storage.get("file_path", "")).strip()
            prefix = f"{paths.DEFAULT_RUNTIME_ROOT}/shared/"
            if file_path.startswith(prefix):
                host_path = paths.LOCALDEV_SHARED_ROOT / file_path[len(prefix) :]
                if not host_path.exists():
                    host_path.parent.mkdir(parents=True, exist_ok=True)
                    source = paths.LOCALDEV_ROI_ROOT / "roi-config.json"
                    host_path.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    audio_manager = config_map.get("audio-manager.json")
    if isinstance(audio_manager, dict):
        speaker = audio_manager.get("speaker")
        if isinstance(speaker, dict):
            mapping_file = str(speaker.get("mapping_file", "")).strip()
            prefix = f"{paths.DEFAULT_RUNTIME_ROOT}/shared/"
            if mapping_file.startswith(prefix):
                host_path = paths.LOCALDEV_SHARED_ROOT / mapping_file[len(prefix) :]
                if not host_path.exists():
                    host_path.parent.mkdir(parents=True, exist_ok=True)
                    source = paths.LOCALDEV_AUDIO_ROOT / "speaker-codes.csv"
                    host_path.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")


def selected_service_names(profile_name: str, explicit_services: list[str]) -> list[str]:
    if explicit_services:
        return sorted(set(explicit_services))
    profile = manifests.require_profile(profile_name)
    return list(profile.services)


def selected_component_names(profile_name: str, explicit_components: list[str], service_names: list[str]) -> list[str]:
    profile = manifests.require_profile(profile_name)
    if explicit_components:
        return manifests.resolve_component_closure(explicit_components)
    return manifests.resolve_component_closure(list(profile.components) + manifests.required_components_for_services(service_names))


def verify_local_stack(*, env: dict[str, str], components: list[str], host_audio_port: int | None) -> None:
    run_compose(["ps"], env=env)
    if "device-emulator" in components:
        for _ in range(20):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{env['TRAKRAI_LOCAL_HTTP_PORT'] if 'TRAKRAI_LOCAL_HTTP_PORT' in env else paths.DEFAULT_LOCAL_HTTP_PORT}/api/runtime-config", timeout=2) as response:
                    if int(getattr(response, "status", response.getcode())) == 200:
                        break
            except (OSError, urllib.error.URLError):
                time.sleep(1)
        else:
            raise SystemExit("local device emulator did not become healthy")
    if "cloud-api" in components and not http_endpoint_healthy("http://127.0.0.1:3000/health"):
        raise SystemExit("local cloud API is not healthy on port 3000")
    if host_audio_port is not None and not host_audio_healthy(host_audio_port):
        raise SystemExit(f"host-audio-player is not healthy on port {host_audio_port}")


def cmd_up(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(
        args,
        request,
        [
            "video",
            "profile",
            "service",
            "component",
            "mqtt_host",
            "mqtt_port",
            "cloud_api_base_url",
            "cloud_api_access_token",
            "device_id",
            "http_port",
            "rtsp_port",
            "host_audio_port",
            "disable_host_audio_playback",
            "platform",
            "skip_build",
            "skip_ui_build",
            "skip_compose_build",
            "compose_project_name",
            "start_mode",
            "webrtc_udp_port_min",
            "webrtc_udp_port_max",
            "webrtc_host_candidate_ip",
            "camera_count",
            "cloud_mode",
        ],
    )
    video_path = Path(args.video).expanduser().resolve()
    if not video_path.exists():
        raise SystemExit(f"video file does not exist: {video_path}")
    service_names = selected_service_names(args.profile, list(args.service or []))
    component_names = selected_component_names(args.profile, list(args.component or []), service_names)
    enable_host_audio = not args.disable_host_audio_playback
    config_map = generate_profile_config_map(
        profile_name=args.profile,
        camera_count=args.camera_count,
        cloud_mode=args.cloud_mode,
        device_id=args.device_id,
        mqtt_host=args.mqtt_host,
        mqtt_port=args.mqtt_port,
        cloud_api_base_url=args.cloud_api_base_url,
        cloud_api_access_token=args.cloud_api_access_token,
        webrtc_host_candidate_ip=parse_host_candidate_ip(args.webrtc_host_candidate_ip)
        if args.webrtc_host_candidate_ip is not None
        else default_webrtc_host_candidate_ip(),
        webrtc_udp_port_min=args.webrtc_udp_port_min,
        webrtc_udp_port_max=args.webrtc_udp_port_max,
        enable_host_audio_playback=enable_host_audio,
        host_audio_port=args.host_audio_port,
    )
    artifact_service_names = [name for name in service_names if name != "edge-ui"] + ["edge-ui"]
    if "device-emulator" in component_names:
        artifacts = resolve_local_artifacts(
            service_names=sorted(set(artifact_service_names)),
            skip_build=args.skip_build,
            platform=args.platform,
            require_ui=True,
            build_ui_if_missing=not args.skip_ui_build,
        )
        ensure_clean_dir(paths.LOCALDEV_STAGE_ROOT)
        options = StageOptions(
            runtime_root=paths.DEFAULT_RUNTIME_ROOT,
            runtime_user=paths.DEFAULT_RUNTIME_USER,
            runtime_group=paths.DEFAULT_RUNTIME_GROUP,
            unit_directory=paths.DEFAULT_UNIT_DIRECTORY,
            cloud_bridge_url=f"ws://127.0.0.1:{args.http_port}/ws",
            transport_mode="edge",
            http_port=8080,
            public_http_port=args.http_port,
            start_mode=args.start_mode,
            edge_host="127.0.0.1",
            edge_origin_hosts=("127.0.0.1", "localhost"),
        )
        prepare_stage(paths.LOCALDEV_STAGE_ROOT, artifacts, config_map, options)
        shutil_path = paths.DEVTOOL_RUNTIME_ASSETS_ROOT / "bootstrap_device_runtime.py"
        target_path = paths.LOCALDEV_STAGE_ROOT / "bootstrap_device_runtime.py"
        target_path.write_text(shutil_path.read_text(encoding="utf-8"), encoding="utf-8")
    paths.LOCALDEV_ROOT.mkdir(parents=True, exist_ok=True)
    paths.LOCALDEV_SHARED_ROOT.mkdir(parents=True, exist_ok=True)
    seed_local_shared_assets(config_map)
    if enable_host_audio and "host-audio-player" in component_names:
        ensure_host_audio_player(args.host_audio_port)
    else:
        stop_host_audio_player()
    write_compose_env(
        compose_project_name=args.compose_project_name,
        stage_dir=paths.LOCALDEV_STAGE_ROOT,
        shared_dir=paths.LOCALDEV_SHARED_ROOT,
        video_path=video_path,
        http_port=args.http_port,
        rtsp_port=args.rtsp_port,
        webrtc_udp_port_min=args.webrtc_udp_port_min,
        webrtc_udp_port_max=args.webrtc_udp_port_max,
    )
    env = compose_env(args.compose_project_name, args.platform)
    env["TRAKRAI_LOCAL_HTTP_PORT"] = str(args.http_port)
    compose_services = [component for component in component_names if manifests.components_by_name().get(component, None) and manifests.components_by_name()[component].kind == "docker-compose-service"]
    if compose_services:
        command = ["up", "-d", "--wait", "--force-recreate", *compose_services]
        if args.skip_compose_build:
            run_compose(command, env=env)
        else:
            run_compose(["build", *compose_services], env=env)
            run_compose(command, env=env)
    verify_local_stack(env=env, components=component_names, host_audio_port=args.host_audio_port if enable_host_audio and "host-audio-player" in component_names else None)
    print(json.dumps({"components": component_names, "services": service_names, "httpPort": args.http_port}, indent=2))
    return 0


def cmd_down(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["compose_project_name", "volumes", "keep_stage"])
    env = compose_env(args.compose_project_name, DEFAULT_LOCAL_PLATFORM)
    command = ["down"]
    if args.volumes:
        command.append("-v")
    run_compose(command, env=env, check=False)
    stop_host_audio_player()
    if not args.keep_stage and paths.LOCALDEV_STAGE_ROOT.exists():
        import shutil
        shutil.rmtree(paths.LOCALDEV_STAGE_ROOT)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["compose_project_name"])
    env = compose_env(args.compose_project_name, DEFAULT_LOCAL_PLATFORM)
    run_compose(["ps"], env=env)
    print_host_audio_status()
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    request = load_request_file(args.request)
    apply_request_overrides(args, request, ["compose_project_name", "service", "lines"])
    env = compose_env(args.compose_project_name, DEFAULT_LOCAL_PLATFORM)
    if args.service == "host-audio-player":
        tail_host_audio_logs(args.lines)
        return 0
    command = ["logs", "--tail", str(args.lines)]
    if args.service:
        command.append(args.service)
    run_compose(command, env=env)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bring up and manage the local device emulator.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    up_parser = subparsers.add_parser("up", help="build, stage, and start the local device stack")
    up_parser.add_argument("--request", default="")
    up_parser.add_argument("--video", required=True)
    up_parser.add_argument("--profile", default="local-emulator-all")
    up_parser.add_argument("--service", action="append")
    up_parser.add_argument("--component", action="append")
    up_parser.add_argument("--camera-count", type=int, default=1)
    up_parser.add_argument("--cloud-mode", default="local", choices=["local", "live"])
    up_parser.add_argument("--mqtt-host", default="host.docker.internal")
    up_parser.add_argument("--mqtt-port", type=int, default=1883)
    up_parser.add_argument("--cloud-api-base-url", default="")
    up_parser.add_argument("--cloud-api-access-token", default="")
    up_parser.add_argument("--device-id", default=paths.DEFAULT_LOCAL_DEVICE_ID)
    up_parser.add_argument("--http-port", type=int, default=paths.DEFAULT_LOCAL_HTTP_PORT)
    up_parser.add_argument("--rtsp-port", type=int, default=paths.DEFAULT_LOCAL_RTSP_PORT)
    up_parser.add_argument("--host-audio-port", type=int, default=paths.DEFAULT_LOCAL_AUDIO_PORT)
    up_parser.add_argument("--disable-host-audio-playback", action="store_true")
    up_parser.add_argument("--platform", default=DEFAULT_LOCAL_PLATFORM)
    up_parser.add_argument("--skip-build", action="store_true")
    up_parser.add_argument("--skip-ui-build", action="store_true")
    up_parser.add_argument("--skip-compose-build", action="store_true")
    up_parser.add_argument("--compose-project-name", default="trakrai-local-device")
    up_parser.add_argument("--start-mode", default="all", choices=["core", "all"])
    up_parser.add_argument("--webrtc-udp-port-min", type=int, default=paths.DEFAULT_WEBRTC_UDP_PORT_MIN)
    up_parser.add_argument("--webrtc-udp-port-max", type=int, default=paths.DEFAULT_WEBRTC_UDP_PORT_MAX)
    up_parser.add_argument("--webrtc-host-candidate-ip", default=None)
    up_parser.set_defaults(func=cmd_up)

    down_parser = subparsers.add_parser("down", help="stop the local device stack")
    down_parser.add_argument("--request", default="")
    down_parser.add_argument("--compose-project-name", default="trakrai-local-device")
    down_parser.add_argument("--volumes", action="store_true")
    down_parser.add_argument("--keep-stage", action="store_true")
    down_parser.set_defaults(func=cmd_down)

    status_parser = subparsers.add_parser("status", help="show compose status")
    status_parser.add_argument("--request", default="")
    status_parser.add_argument("--compose-project-name", default="trakrai-local-device")
    status_parser.set_defaults(func=cmd_status)

    logs_parser = subparsers.add_parser("logs", help="tail compose logs")
    logs_parser.add_argument("--request", default="")
    logs_parser.add_argument("--compose-project-name", default="trakrai-local-device")
    logs_parser.add_argument("--service", help="optional service filter")
    logs_parser.add_argument("--lines", type=int, default=200)
    logs_parser.set_defaults(func=cmd_logs)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
