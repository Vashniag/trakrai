#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path


def load_config(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    runtime_root = Path(data.get("runtime_root", path.parent)).resolve()
    source_dir = runtime_root / "src" / "deepstream-pipeline-app"
    data.setdefault("image", "trakrai/deepstream-l4t:6.0.1-build")
    data.setdefault("build", {})
    data["build"].setdefault("enabled", True)
    data["build"].setdefault("base_image", "nvcr.io/nvidia/deepstream-l4t:6.0.1-samples")
    data["build"].setdefault("dockerfile", str((source_dir / "Dockerfile").as_posix()))
    data.setdefault("container_name", "trakrai-deepstream-pipeline")
    data.setdefault("runtime_root", str(runtime_root))
    data.setdefault("redis", {})
    data["redis"].setdefault("host", "127.0.0.1")
    data["redis"].setdefault("port", 6379)
    data["redis"].setdefault("password", "")
    data["redis"].setdefault("key_prefix", "camera")
    data.setdefault("network", {})
    data["network"].setdefault("udp_host", "127.0.0.1")
    data.setdefault("pipeline", {})
    data["pipeline"].setdefault("mux_width", 640)
    data["pipeline"].setdefault("mux_height", 640)
    data["pipeline"].setdefault("tile_width", 960)
    data["pipeline"].setdefault("tile_height", 540)
    data["pipeline"].setdefault("raw_grid_port", 0)
    data["pipeline"].setdefault("processed_grid_port", 0)
    data.setdefault("sampling", {})
    data["sampling"].setdefault("spool_dir", "/data/trakrai-recordings/ring")
    data["sampling"].setdefault("sample_fps", 1)
    data["sampling"].setdefault("jpeg_quality", 80)
    data.setdefault("nvinfer", {})
    data["nvinfer"].setdefault(
        "config_path",
        str((Path(data["runtime_root"]) / "src" / "deepstream-pipeline-app" / "config_infer_primary_yolov5s.txt").as_posix()),
    )
    return data


def enabled_cameras(config: dict) -> list[dict]:
    items = []
    for camera in config.get("cameras", []):
        if not camera.get("enabled", True):
            continue
        items.append(camera)
    if not items:
        raise SystemExit("deepstream-pipeline requires at least one enabled camera")
    return items


def build_app_args(config: dict, cameras: list[dict]) -> list[str]:
    args = [
        "./trakrai-deepstream-app",
        "--infer-config",
        config["nvinfer"]["config_path"],
        "--redis-host",
        str(config["redis"]["host"]),
        "--redis-port",
        str(config["redis"]["port"]),
        "--redis-prefix",
        str(config["redis"]["key_prefix"]),
        "--udp-host",
        str(config["network"]["udp_host"]),
        "--raw-grid-port",
        str(config["pipeline"]["raw_grid_port"]),
        "--processed-grid-port",
        str(config["pipeline"]["processed_grid_port"]),
        "--mux-width",
        str(config["pipeline"]["mux_width"]),
        "--mux-height",
        str(config["pipeline"]["mux_height"]),
        "--tile-width",
        str(config["pipeline"]["tile_width"]),
        "--tile-height",
        str(config["pipeline"]["tile_height"]),
        "--spool-dir",
        str(config["sampling"]["spool_dir"]),
        "--sample-fps",
        str(config["sampling"]["sample_fps"]),
        "--sample-jpeg-quality",
        str(config["sampling"]["jpeg_quality"]),
    ]
    if config["redis"].get("password"):
        args.extend(["--redis-password", str(config["redis"]["password"])])

    for camera in cameras:
        parts = [
            str(camera["id"]),
            str(camera["name"]),
            str(camera["rtsp_url"]),
            str(camera.get("raw_port", 0)),
            str(camera.get("processed_port", 0)),
            str(camera.get("latency_ms", 200)),
            "1" if camera.get("rotate_180", False) else "0",
            str(camera.get("rtp_protocol", 4)),
        ]
        args.extend(["--source", "|".join(parts)])
    return args


def docker_command(config: dict, cameras: list[dict], config_path: Path) -> list[str]:
    runtime_root = Path(config["runtime_root"]).as_posix()
    source_dir = f"{runtime_root}/src/deepstream-pipeline-app"
    make_and_run = "make -C {src} && exec {cmd}".format(
        src=shlex.quote(source_dir),
        cmd=" ".join(shlex.quote(part) for part in build_app_args(config, cameras)),
    )
    return [
        "docker",
        "run",
        "--rm",
        "--name",
        str(config["container_name"]),
        "--runtime",
        "nvidia",
        "--network",
        "host",
        "-v",
        f"{runtime_root}:{runtime_root}",
        "-v",
        "/data:/data",
        "-v",
        "/tmp:/tmp",
        "-w",
        source_dir,
        str(config["image"]),
        "bash",
        "-lc",
        make_and_run,
    ]


def ensure_image(config: dict) -> None:
    if not config.get("build", {}).get("enabled", True):
        return

    image = str(config["image"])
    inspect = subprocess.run(
        ["docker", "image", "inspect", image],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if inspect.returncode == 0:
        return

    dockerfile = Path(config["build"]["dockerfile"]).as_posix()
    source_dir = str(Path(config["runtime_root"]).resolve() / "src" / "deepstream-pipeline-app")
    base_image = str(config["build"]["base_image"])
    command = [
        "docker",
        "build",
        "--network",
        "host",
        "--build-arg",
        f"BASE_IMAGE={base_image}",
        "-t",
        image,
        "-f",
        dockerfile,
        source_dir,
    ]
    print("+", " ".join(shlex.quote(part) for part in command))
    subprocess.run(command, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the TrakrAI DeepStream pipeline container")
    parser.add_argument("-config", dest="config_path", required=False, help="path to deepstream-pipeline.json")
    parser.add_argument("--version", action="store_true")
    args = parser.parse_args()

    if args.version:
        print("deepstream-pipeline-runner 0.1.0")
        return 0

    if not args.config_path:
        raise SystemExit("-config is required")

    config_path = Path(args.config_path).resolve()
    config = load_config(config_path)
    cameras = enabled_cameras(config)
    ensure_image(config)

    subprocess.run(
        ["docker", "rm", "-f", str(config["container_name"])],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    command = docker_command(config, cameras, config_path)
    print("+", " ".join(shlex.quote(part) for part in command))
    os.execvp(command[0], command)


if __name__ == "__main__":
    raise SystemExit(main())
