"""Mock camera orchestration for the local device emulator.

The existing emulator already loops a single MP4 over RTSP via the
`fake-camera` container. This module lets a developer spin up any number of
additional mock cameras for stress testing without redefining the compose
stack. Each camera publishes to `rtsp://fake-camera:8554/streamN` and mirrors
the same encoding knobs used on-device, so the staged rtsp-feeder service
sees representative workloads.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

from . import paths


LOCALDEV_EXTRA_VIDEOS_DIR = paths.LOCALDEV_ROOT / "extra-videos"
FAKE_CAMERA_CONTAINER_DEFAULT = "trakrai-local-device_fake-camera_1"


def resolve_fake_camera_container() -> str | None:
    result = subprocess.run(
        [
            "docker",
            "ps",
            "--filter",
            "label=com.docker.compose.service=fake-camera",
            "--format",
            "{{.Names}}",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    names = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return names[0] if names else None


def ensure_extra_video(target: Path, source_video: Path) -> None:
    if target.exists() and target.stat().st_size > 0:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_video, target)


def probe_stream(container_name: str, path: str, timeout_sec: float) -> dict[str, object]:
    deadline = time.time() + timeout_sec
    last_error = ""
    while time.time() < deadline:
        result = subprocess.run(
            [
                "docker",
                "exec",
                container_name,
                "ffprobe",
                "-v",
                "error",
                "-rtsp_transport",
                "tcp",
                "-print_format",
                "json",
                "-show_streams",
                f"rtsp://127.0.0.1:8554/{path}",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            payload = json.loads(result.stdout or "{}")
            streams = payload.get("streams", []) or []
            for stream in streams:
                if stream.get("codec_type") == "video":
                    return {
                        "path": path,
                        "ok": True,
                        "codec": stream.get("codec_name"),
                        "width": stream.get("width"),
                        "height": stream.get("height"),
                    }
        else:
            last_error = result.stderr.strip() or f"exit code {result.returncode}"
        time.sleep(1.0)
    return {"path": path, "ok": False, "error": last_error or "timeout"}


def fetch_camera_frame(http_port: int, camera_id: int, out_path: Path) -> dict[str, object]:
    # The cloud-comm edge HTTP API exposes the most recent processed/raw JPEG
    # for each camera at /api/cameras/<id>/frame. Use it to validate an active
    # pipeline without needing a WebRTC session.
    url = f"http://127.0.0.1:{http_port}/api/cameras/{camera_id}/frame"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            data = response.read()
    except Exception as exc:
        return {"camera_id": camera_id, "ok": False, "error": str(exc), "url": url}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(data)
    return {"camera_id": camera_id, "ok": True, "path": str(out_path), "bytes": len(data), "url": url}


def cmd_list(_args: argparse.Namespace) -> int:
    container = resolve_fake_camera_container()
    if container is None:
        print(json.dumps({"ok": False, "error": "fake-camera container not running"}, indent=2))
        return 1
    camera_count = 1
    env_file = paths.LOCALDEV_COMPOSE_ENV
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("TRAKRAI_LOCAL_CAMERA_COUNT="):
                try:
                    camera_count = max(1, int(line.split("=", 1)[1]))
                except ValueError:
                    pass
                break
    probes: list[dict[str, object]] = []
    for index in range(1, camera_count + 1):
        probes.append(probe_stream(container, f"stream{index}", timeout_sec=2))
    print(json.dumps({"container": container, "streams": probes}, indent=2))
    return 0 if all(p.get("ok") for p in probes) else 1


def cmd_probe(args: argparse.Namespace) -> int:
    container = resolve_fake_camera_container()
    if container is None:
        raise SystemExit("fake-camera container not running; start the emulator first")
    path = args.path or "stream1"
    result = probe_stream(container, path, timeout_sec=args.timeout_sec)
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


def cmd_capture(args: argparse.Namespace) -> int:
    http_port = args.http_port or paths.DEFAULT_LOCAL_HTTP_PORT
    cameras = list(args.camera_id or [1])
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else LOCALDEV_EXTRA_VIDEOS_DIR.parent / "captures"
    results: list[dict[str, object]] = []
    for camera_id in cameras:
        out = output_dir / f"camera-{camera_id}.jpg"
        results.append(fetch_camera_frame(http_port, camera_id, out))
    print(json.dumps({"httpPort": http_port, "results": results}, indent=2))
    return 0 if all(r.get("ok") for r in results) else 1


def cmd_seed(args: argparse.Namespace) -> int:
    source = Path(args.source_video).expanduser().resolve()
    if not source.exists():
        raise SystemExit(f"source video does not exist: {source}")
    count = max(1, args.count)
    LOCALDEV_EXTRA_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    for index in range(1, count + 1):
        target = LOCALDEV_EXTRA_VIDEOS_DIR / f"stream-{index}.mp4"
        ensure_extra_video(target, source)
    print(json.dumps({"root": str(LOCALDEV_EXTRA_VIDEOS_DIR), "count": count}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage mock cameras used by the local emulator.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="probe each configured mock camera stream")
    list_parser.set_defaults(func=cmd_list)

    probe_parser = subparsers.add_parser("probe", help="probe one RTSP stream path and report codec/resolution")
    probe_parser.add_argument("--path", default="stream1")
    probe_parser.add_argument("--timeout-sec", type=float, default=10.0)
    probe_parser.set_defaults(func=cmd_probe)

    capture_parser = subparsers.add_parser("capture", help="snapshot the latest JPEG frame served by cloud-comm for each camera")
    capture_parser.add_argument("--camera-id", type=int, action="append")
    capture_parser.add_argument("--http-port", type=int, default=0)
    capture_parser.add_argument("--output-dir", default="")
    capture_parser.set_defaults(func=cmd_capture)

    seed_parser = subparsers.add_parser("seed", help="seed distinct per-camera source videos into device/.localdev/extra-videos")
    seed_parser.add_argument("--source-video", required=True)
    seed_parser.add_argument("--count", type=int, default=4)
    seed_parser.set_defaults(func=cmd_seed)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
