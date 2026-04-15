# Native Pipeline Migration

This directory contains the compiled replacement path for the current on-device AI stack.

Pieces:

- `device/cmd/ai-inference-native`
  Go service that keeps the existing Redis contracts stable while delegating model execution to a native backend.
- `device/cmd/event-recorder`
  Go service that samples raw/processed frames, keeps a rolling event buffer, and writes fast-forwarded MP4 clips.
- `device/native/tensorrt-yolo`
  Native TensorRT backend server for YOLOv8-style engines.

## Why This Layout

This keeps cloud control, MQTT, Redis contracts, and workflow uploads stable while removing the Python inference process and adding event recording as a first-class service.

The intended steady-state topology is:

```text
RTSP -> rtsp-feeder -> Redis(raw latest)
                  -> ai-inference-native -> Redis(detections + processed)
                  -> live-feed (raw/processed preview)
                  -> event-recorder (rolling buffer + MP4 clips)
                  -> workflow-comm (cloud upload)
```

This is still a compatibility bridge. The next step after this migration is removing the Redis JPEG hot path entirely and replacing it with RTP/SHM transport.

## Build Go Services

From `D:\trakrbi\trakrai\device`:

```powershell
make build-ai-inference-native
make build-event-recorder
```

Cross-build for Jetson using the existing Docker builders:

```powershell
docker buildx build --platform linux/arm64 --output type=local,dest=./out/ai-inference-native -f Dockerfile --build-arg CMD_PATH=./cmd/ai-inference-native --build-arg BINARY_NAME=ai-inference-native .
docker buildx build --platform linux/arm64 --output type=local,dest=./out/event-recorder -f Dockerfile.gstreamer --build-arg CMD_PATH=./cmd/event-recorder --build-arg BINARY_NAME=event-recorder .
```

## Build TensorRT Backend On Jetson

Build this directly on the Jetson after TensorRT development headers and OpenCV dev packages are present:

```bash
cd /home/hacklab/trakrai-device-runtime/src/tensorrt-yolo
cmake -S . -B build
cmake --build build -j4
cp build/trakrai-trt-yolo-server /home/hacklab/trakrai-device-runtime/bin/trakrai-trt-yolo-server
chmod +x /home/hacklab/trakrai-device-runtime/bin/trakrai-trt-yolo-server
```

## Example Runtime Configs

- Native inference config:
  `device/configs/ai-inference-native.sample.json`
- Event recorder config:
  `device/configs/event-recorder.sample.json`
- Runtime manager definitions:
  `device/configs/runtime-manager.sample.json`

## Example Native Inference Run

```bash
/home/hacklab/trakrai-device-runtime/bin/ai-inference-native \
  -config /home/hacklab/trakrai-device-runtime/ai-inference-native.json
```

The backend command in the sample config expects a prebuilt TensorRT engine at:

```text
/data/trakrai-models/yolov8n.engine
```

## Example Event Recorder Run

```bash
/home/hacklab/trakrai-device-runtime/bin/event-recorder \
  -config /home/hacklab/trakrai-device-runtime/event-recorder.json
```

## Example Recorder Command

Send through the existing service command topic or edge websocket bridge:

```json
{
  "type": "capture-event",
  "payload": {
    "eventId": "event-123",
    "cameraNames": ["Camera-1", "Camera-2", "Camera-3"],
    "layoutMode": "grid-4",
    "frameSource": "processed",
    "preSeconds": 30,
    "postSeconds": 120,
    "playbackFps": 24,
    "cloudUpload": {
      "enabled": true,
      "jobKind": "violation-event",
      "fileTag": "clip",
      "data": {
        "siteId": "site-1",
        "cameraGroup": "yard"
      },
      "presign": {
        "url": "/api/external/device-workflow/presign-uploads",
        "method": "POST",
        "files_field": "files"
      },
      "finalize": {
        "url": "/api/external/device-workflow/store-event",
        "method": "POST",
        "files_field": "files"
      }
    }
  }
}
```

The recorder will:

1. Pull sampled frames from the rolling buffer.
2. Create a fast-forward MP4 under the configured workflow files root.
3. Enqueue a `workflow-comm` upload job when `cloudUpload.enabled=true`.

## Native Backend Protocol

The Go service talks to `trakrai-trt-yolo-server` over stdin/stdout using one request per line.

Request:

```text
INFER\t<request-id>\t<input-jpeg-path>\t<annotated-jpeg-path>
```

Response success:

```text
OK\t<request-id>\t<latency-ms>\t<label,score,left,top,right,bottom;...>
```

Response failure:

```text
ERR\t<request-id>\t<message>
```

## Practical Deployment Notes

- `event-recorder` needs the GStreamer build path because it writes MP4 clips natively.
- `ai-inference-native` is plain Go; the heavy dependency stays inside the TensorRT backend binary.
- The sample configs target `/data` for staging and rolling buffers so the Nano root filesystem is not used for hot-path media files.
- The current Jetson profile in this workspace is missing TensorRT and DeepStream packages, so the Go bridge can run immediately but the TensorRT backend still needs the NVIDIA runtime installed before deployment.
