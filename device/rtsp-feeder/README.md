# RTSP Feeder

Single Go binary that captures RTSP camera feeds using NVIDIA hardware acceleration (NVDEC + NVJPEG) via GStreamer's C API (CGO) and publishes JPEG frames to Redis.

Replaces the per-camera Python `play_rtsp.py` services with one binary that handles all cameras from a single JSON config file.

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                 rtsp-feeder  (single process)             │
│                                                           │
│  Go runtime                                               │
│  ├── goroutine: Camera 1 ──► GStreamer pipeline ──┐       │
│  ├── goroutine: Camera 2 ──► GStreamer pipeline ──┤       │
│  └── goroutine: Camera N ──► GStreamer pipeline ──┤       │
│                                                   │       │
│  GStreamer (linked via CGO, loaded once)           │       │
│  ├── nvv4l2decoder  (NVDEC hardware H.265/H.264)  │       │
│  ├── nvvidconv      (GPU resize + rotation)        │       │
│  └── nvjpegenc      (NVIDIA JPEG encoder)          │       │
│                                                   ▼       │
│                                              Redis HSET   │
└───────────────────────────────────────────────────────────┘
```

All cameras share a single GStreamer runtime in one process. Each camera runs in its own goroutine with a dedicated GStreamer pipeline. Frames are pulled directly from `appsink` in-process (no subprocess, no pipe I/O).

## Build

Requires Docker. The Dockerfile cross-compiles from x86 using arm64 GStreamer 1.14 dev libraries from Ubuntu 18.04 repos (exact match for Jetson).

```bash
make build
# produces: out/rtsp-feeder (ARM64 ELF, ~4.3 MB)
```

The build runs natively on x86 (no QEMU emulation), takes ~15 seconds with cached layers.

## Deploy

```bash
scp out/rtsp-feeder hacklab@<device>:/home/hacklab/
scp config.json hacklab@<device>:/home/hacklab/rtsp-feeder-config.json
```

Run:
```bash
./rtsp-feeder -config rtsp-feeder-config.json
```

## Config

Copy `config.sample.json` to `config.json` and edit. The `defaults` section provides base values; individual cameras can override any parameter.

### Parameters

| Parameter | Default | Description |
|---|---|---|
| `log_level` | `info` | `debug`, `info`, `warn`, `error` |
| `capture_method` | `auto` | `auto`, `h265_hw`, `h264_hw`, `software` |
| `width` | `640` | Output frame width |
| `height` | `480` | Output frame height |
| `framerate` | `2` | Target FPS published to Redis |
| `jpeg_quality` | `85` | JPEG compression (1-100) |
| `latency_ms` | `200` | RTSP source latency buffer |
| `protocols` | `tcp` | RTSP transport (`tcp`, `udp`) |
| `reconnect_delay_sec` | `5` | Wait before reconnecting on failure |
| `rotate_180` | `false` | For physically inverted cameras |
| `save_frames` | `false` | Also save JPEGs to disk |
| `save_path` | `/data/raw` | Disk save directory |
| `pipeline_timeout_sec` | `15` | Max wait for first frame from a pipeline |

## Pipeline Fallback

In `auto` mode, pipelines are tried in order:

1. **H.265 HW** — `nvv4l2decoder` + `nvvidconv` + `nvjpegenc` (all on NVDEC/GPU)
2. **H.264 HW** — same hardware path, H.264 codec
3. **Software** — `decodebin` + `videoconvert` + `jpegenc` (CPU fallback)

## Redis Format

```
camera:<name>:latest  →  hash { raw: <JPEG>, imgID: <timestamp>, cam_id: <int> }
```

Wire-compatible with the existing Python `play_rtsp.py` output.

## Install as systemd Service

```bash
sudo tee /etc/systemd/system/rtsp-feeder.service << 'EOF'
[Unit]
Description=TrakrAI RTSP Camera Feeder
After=network.target redis-server.service

[Service]
Type=simple
ExecStart=/home/hacklab/rtsp-feeder -config /home/hacklab/rtsp-feeder-config.json
Restart=always
RestartSec=10
User=hacklab
Group=hacklab
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now rtsp-feeder
```

## Resource Usage (3 cameras @ 2 FPS, Jetson Nano)

| | Old (Python/subprocess) | New (CGO in-process) |
|---|---|---|
| Processes | 4 (Go + 3 gst-launch) | **1** |
| RAM | ~185 MB | **~97 MB** |
| CPU | ~25-30% | **~23%** |
| HW decode | NVDEC (via subprocess) | **NVDEC (direct)** |

## Dynamic Libraries

The binary links against system GStreamer libraries on the Jetson:

```
libgstapp-1.0.so.0    libgstreamer-1.0.so.0    libgobject-2.0.so.0
libglib-2.0.so.0      libgstbase-1.0.so.0      libc.so.6
```

NVIDIA plugins (`nvv4l2decoder`, `nvvidconv`, `nvjpegenc`) are loaded by GStreamer at runtime from the Jetson BSP — they are not link-time dependencies.
