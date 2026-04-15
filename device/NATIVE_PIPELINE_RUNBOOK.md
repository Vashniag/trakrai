# Native Pipeline Runbook

This runbook covers the compiled TrakrAI device stack:

- `rtsp-feeder` for camera ingest
- `ai-inference-native` for Redis-compatible inference
- `live-feed` for raw or processed WebRTC preview
- `event-recorder` for fast-forward event clips
- `workflow-comm` for optional cloud upload handoff

The TensorRT model backend is `device/native/tensorrt-yolo`.

## 1. Build Device Binaries

From `D:\trakrbi\trakrai\device`:

```powershell
make build-live-feed
make build-rtsp-feeder
make build-ai-inference-native
make build-event-recorder
make build-workflow-comm
make build-runtime-manager
make build-cloud-comm
```

Arm64 cross-build output goes under `device/out/<service>/<service>`.

## 2. Build The TensorRT Backend On Jetson

Copy `device/native/tensorrt-yolo` to the Jetson and build it there after TensorRT and OpenCV dev packages are available:

```bash
cd /home/hacklab/trakrai-device-runtime/src/tensorrt-yolo
cmake -S . -B build
cmake --build build -j4
cp build/trakrai-trt-yolo-server /home/hacklab/trakrai-device-runtime/bin/trakrai-trt-yolo-server
chmod +x /home/hacklab/trakrai-device-runtime/bin/trakrai-trt-yolo-server
```

## 3. Prepare Device Configs

Use these sample files as the starting point:

- `device/configs/live-feed.sample.json`
- `device/configs/ai-inference-native.sample.json`
- `device/configs/event-recorder.sample.json`
- `device/configs/runtime-manager.sample.json`

Recommended device storage layout on Nano:

- model engines: `/data/trakrai-models`
- inference staging: `/data/trakrai-ai-native/staging`
- event spool: `/data/trakrai-recordings/ring`
- event staging: `/data/trakrai-recordings/staging`
- output clips: `/data/trakrai-workflow-files`

## 4. Deploy The Runtime

The standard deploy helper now stages `ai-inference-native` and `event-recorder` too.

Example:

```powershell
python device/scripts/deploy_device_runtime.py `
  --host 10.8.0.50 `
  --user hacklab `
  --password <device-password> `
  --config-dir D:\trakrbi\trakrai\device\configs `
  --skip-build
```

If you want the deploy script to rebuild the binaries first, drop `--skip-build`.

## 5. Start The Native Inference Service

Example manual run on device:

```bash
/home/hacklab/trakrai-device-runtime/bin/ai-inference-native \
  -config /home/hacklab/trakrai-device-runtime/ai-inference-native.json
```

The sample config launches the TensorRT backend like this:

```json
{
  "backend": {
    "mode": "process",
    "command": [
      "/home/hacklab/trakrai-device-runtime/bin/trakrai-trt-yolo-server",
      "--engine",
      "/data/trakrai-models/yolov8n.engine",
      "--labels",
      "/data/trakrai-models/coco.txt"
    ]
  }
}
```

## 6. Start The Event Recorder

Example manual run on device:

```bash
/home/hacklab/trakrai-device-runtime/bin/event-recorder \
  -config /home/hacklab/trakrai-device-runtime/event-recorder.json
```

## 7. Trigger A Fast-Forward Event Clip

Send this through the existing `cloud-comm` command path:

```json
{
  "type": "capture-event",
  "payload": {
    "eventId": "yard-demo-001",
    "cameraNames": ["LP1-Main", "LP1-Sec", "LP2-Main"],
    "layoutMode": "grid-4",
    "frameSource": "processed",
    "preSeconds": 30,
    "postSeconds": 120,
    "playbackFps": 24,
    "cloudUpload": {
      "enabled": false
    }
  }
}
```

That creates an MP4 clip from the sampled ring buffer instead of recording every frame continuously.

## 8. Run The Native Stack Locally

The local Docker emulator now includes:

- `cloud-comm`
- `live-feed`
- `rtsp-feeder`
- `ai-inference-native` with `backend.mode=mock`
- `event-recorder`

Example:

```powershell
python device/scripts/local_device_runtime.py up --video D:\trakrbi\_test_video.mp4
```

Useful follow-ups:

```powershell
python device/scripts/local_device_runtime.py status
python device/scripts/local_device_runtime.py logs --service device-emulator
python device/scripts/local_device_runtime.py down
```

## 9. Expected Production Flow

```text
RTSP camera
  -> rtsp-feeder
  -> Redis latest raw frame
  -> ai-inference-native
  -> TensorRT backend
  -> Redis processed frame + detections
  -> live-feed
  -> event-recorder
  -> workflow-comm
```

This still keeps the current Redis contract stable. The next optimization step after the native cutover is removing the Redis JPEG hot path and moving the inter-service video path to RTP or shared memory.
