"""Download helpers for sample assets needed by the local emulator.

The emulator expects two pieces of external content that we do not bake into
the repo:

* a video file fed into the fake RTSP camera
* a YOLOv5 weights file used by the AI inference service

This module exposes a small CLI wrapped under `python -m device.devtool assets`
to fetch reasonable defaults for both, so a fresh clone can reach a live
end-to-end demo with no manual downloads.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import urllib.request
from pathlib import Path

from . import paths


LOCALDEV_ASSET_ROOT = paths.LOCALDEV_ROOT / "assets"
DEFAULT_VIDEO_PATH = LOCALDEV_ASSET_ROOT / "sample-video.mp4"
DEFAULT_MODEL_ROOT = LOCALDEV_ASSET_ROOT / "models"


# Public, royalty-free MP4 with pedestrians + vehicles that exercises YOLO's
# COCO classes well. Falls back to a second mirror if the primary is down.
VIDEO_SOURCES: tuple[str, ...] = (
    "https://github.com/intel-iot-devkit/sample-videos/raw/master/people-detection.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
)

# Ultralytics publishes YOLOv5 weights as GitHub release assets. The nano
# variant is the right size for a 4 GB GPU (plus it matches the bundled
# yolov5n yaml file shipped with the runtime).
MODEL_SOURCES: dict[str, tuple[str, ...]] = {
    "yolov5n": (
        "https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5n.pt",
    ),
    "yolov5s": (
        "https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5s.pt",
    ),
    "yolov5m": (
        "https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5m.pt",
    ),
}


def download_to(target: Path, sources: tuple[str, ...], *, description: str) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size > 0:
        print(f"{description} already present: {target} ({target.stat().st_size} bytes)")
        return target
    last_error: Exception | None = None
    for source_url in sources:
        print(f"Downloading {description} from {source_url} -> {target}")
        try:
            with urllib.request.urlopen(source_url, timeout=120) as response:
                if int(getattr(response, "status", response.getcode())) >= 400:
                    raise RuntimeError(f"http status {response.status}")
                tmp = target.with_suffix(target.suffix + ".partial")
                with tmp.open("wb") as handle:
                    shutil.copyfileobj(response, handle, length=1024 * 1024)
                tmp.replace(target)
                return target
        except Exception as exc:  # pragma: no cover - network path
            last_error = exc
            print(f"  failed: {exc}")
            continue
    raise SystemExit(f"unable to download {description}: {last_error}")


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cmd_download(args: argparse.Namespace) -> int:
    results: dict[str, dict[str, object]] = {}

    if args.video or args.all:
        target = Path(args.video_path).expanduser().resolve() if args.video_path else DEFAULT_VIDEO_PATH
        download_to(target, VIDEO_SOURCES, description="sample video")
        results["video"] = {"path": str(target), "sha256": sha256_of(target), "bytes": target.stat().st_size}

    if args.model or args.all:
        models = list(args.model_name or []) or ["yolov5n"]
        model_entries: list[dict[str, object]] = []
        for name in models:
            sources = MODEL_SOURCES.get(name)
            if sources is None:
                raise SystemExit(f"unknown model: {name}. Known models: {sorted(MODEL_SOURCES)}")
            target = DEFAULT_MODEL_ROOT / f"{name}.pt"
            download_to(target, sources, description=f"{name} weights")
            model_entries.append({"name": name, "path": str(target), "sha256": sha256_of(target), "bytes": target.stat().st_size})
        results["models"] = model_entries  # type: ignore[assignment]

    if not results:
        raise SystemExit("specify --video, --model, or --all")

    print(json.dumps(results, indent=2))
    return 0


def cmd_list(_args: argparse.Namespace) -> int:
    entries: list[dict[str, object]] = []
    if LOCALDEV_ASSET_ROOT.exists():
        for path in sorted(LOCALDEV_ASSET_ROOT.rglob("*")):
            if path.is_file():
                entries.append({"path": str(path.relative_to(LOCALDEV_ASSET_ROOT)), "bytes": path.stat().st_size})
    print(json.dumps({"root": str(LOCALDEV_ASSET_ROOT), "files": entries}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Download sample video and inference model assets.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    download_parser = subparsers.add_parser("download", help="download sample assets into device/.localdev/assets")
    download_parser.add_argument("--video", action="store_true", help="download the sample video")
    download_parser.add_argument("--video-path", default="", help="override video target path")
    download_parser.add_argument("--model", action="store_true", help="download YOLO model weights")
    download_parser.add_argument("--model-name", action="append", help="specific model name (default: yolov5n)")
    download_parser.add_argument("--all", action="store_true", help="download both video and default model")
    download_parser.set_defaults(func=cmd_download)

    list_parser = subparsers.add_parser("list", help="list downloaded assets")
    list_parser.set_defaults(func=cmd_list)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
