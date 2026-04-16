# Local Device Emulator

This stack treats a Docker container as the local TrakrAI device runtime and reuses the existing staged deployment flow instead of inventing a second startup path.

What it does:

- builds device artifacts for the local Docker platform
- stages the runtime with the same manifest/bootstrap flow used by `deploy_device_runtime.py`
- starts an Ubuntu 18.04 + Python 3.8 device container
- runs a fake RTSP camera from a looped MP4 file
- connects `cloud-comm` to the existing Mosquitto broker already running on the laptop

Default local configs only include the services that can run meaningfully without hardware or cloud credentials:

- `audio-manager`
- `cloud-comm`
- `cloud-transfer`
- `live-feed`
- `rtsp-feeder`
- `workflow-engine`
- `runtime-manager`

The local stack also starts local object storage infrastructure for the transfer worker:

- `minio` on `http://127.0.0.1:19000`
- `mock-speaker` on `http://127.0.0.1:18910`

The real cloud API is expected to be provided by the `trakrai` web app, typically on:

- `http://127.0.0.1:3000`

If you want to add more services, pass `--config-dir` to [`local_device_runtime.py`](/Users/hardikj/code/web-apps/trakrbi/trakrai/device/scripts/local_device_runtime.py).

## Usage

From the repository root:

```bash
python3 trakrai/device/scripts/local_device_runtime.py up --video /absolute/path/to/sample.mp4
```

Useful variants:

```bash
python3 trakrai/device/scripts/local_device_runtime.py status
python3 trakrai/device/scripts/local_device_runtime.py logs --service device-emulator
python3 trakrai/device/scripts/local_device_runtime.py down
python3 trakrai/device/scripts/local_device_runtime.py down --volumes
```

Important defaults:

- edge UI/API: `http://127.0.0.1:18080`
- fake RTSP feed: `rtsp://127.0.0.1:18554/stream`
- host-backed transfer shared dir: `trakrai/device/.localdev/shared`
- host-backed workflow file: `trakrai/device/.localdev/shared/workflow.json`
- host-backed speaker code mapping: `trakrai/device/.localdev/shared/audio/speaker-codes.csv`
- broker host inside containers: `host.docker.internal:1883`
- local MinIO API: `http://127.0.0.1:19000`
- local MinIO console: `http://127.0.0.1:19001`
- local cloud API: `http://127.0.0.1:3000`

## Using Uploads And Downloads From The UI

`cloud-transfer` only reads and writes files inside the device shared directory. In local dev,
that directory is now bind-mounted to the host at:

```bash
trakrai/device/.localdev/shared
```

Use the transfers UI like this:

- for uploads, create the source file under `trakrai/device/.localdev/shared`
- in the UI, enter the `localPath` relative to that directory, for example `manual-tests/sample.txt`
- use any scoped S3 path for `remotePath`, for example `manual-tests/sample.txt`
- for downloads, use an existing remote path and a target `localPath` like `manual-tests/downloaded.txt`
- timeout values accept Go-style durations like `4h`, and also day-based values like `1d`

Examples:

```text
Upload localPath:  manual-tests/sample.txt
Upload remotePath: manual-tests/sample.txt

Download localPath:  manual-tests/downloaded.txt
Download remotePath: manual-tests/sample.txt
```

Host filesystem paths like `/Users/...` will fail, because `cloud-transfer` only accepts paths
inside the device shared directory.

## Verifying Cloud Transfer

The local stack now includes `cloud-transfer`, which no longer exposes a private HTTP API.
Instead, it uses the same `cloud-comm`-owned IPC bus pattern as the other device services:
commands are routed through the Unix socket, and responses come back through routed
`response` packets.

Run the end-to-end verifier from the repository root:

```bash
python3 trakrai/device/scripts/verify_cloud_transfer_local.py
```

That script:

- writes a file into the runtime shared directory
- registers a temporary verifier service on the IPC socket
- enqueues an upload through `cloud-transfer` over the local service bus
- waits for the upload to complete
- simulates a storage outage by stopping MinIO to verify retry/backoff recovery
- simulates a short timeout window to verify expiry/failure behavior
- enqueues a download for the same object
- verifies the downloaded payload matches the original file

## Verifying Audio Manager

The local stack includes `audio-manager` as a wheel-installed managed service. In local dev it:

- synthesizes WAV files with `espeak`
- records local playback via the `mock` playback backend
- delivers network speaker announcements to the `mock-speaker` HTTP service

Run the end-to-end verifier from the repository root:

```bash
python3 trakrai/device/scripts/verify_audio_service_local.py
```

That script:

- queues a direct `play-audio` request over the local IPC bus
- waits for the queued job to complete
- verifies the generated audio file exists in the shared runtime volume
- verifies `mock-speaker` received the short-code payload
- temporarily swaps in an audio test workflow
- submits a detection frame to `workflow-engine`
- waits for the workflow-triggered audio job to complete
- restores the original workflow file afterward

## Using The Workflow Engine

The local stack now also includes `workflow-engine` as a wheel-installed managed service.
Its workflow definition is read from the shared host-backed file:

```bash
trakrai/device/.localdev/shared/workflow.json
```

On first `up`, that file is seeded from the tracked template at:

```bash
trakrai/device/localdev/workflows/minimal-detection-workflow.json
```

The service polls the workflow file contents and reloads automatically when the file
changes. When a reload happens, queued runs are dropped and any in-flight run result is
discarded if it completes against the previous workflow generation.

To feed mock detections into the workflow queue from the host:

```bash
python3 trakrai/device/scripts/mock_workflow_detections.py \
  --input trakrai/device/localdev/detections/sample-detections.json
```

That script copies the payload file into the shared device volume and then runs the
in-container feeder CLI, which submits each frame to `workflow-engine` over the local IPC bus.

Input format example:

```json
{
  "delayMs": 200,
  "frames": [
    {
      "cameraId": "1",
      "cameraName": "Camera-1",
      "frameId": "frame-0001",
      "detections": [
        { "label": "person", "confidence": 0.97, "bbox": [42, 18, 180, 260] }
      ]
    }
  ]
}
```

Each frame can also include `requestId`, `delayMs`, or a raw `detectionData` object if
you want to send the workflow payload directly instead of the friendly `cameraId` /
`cameraName` / `detections` shape.

## Using Next Dev Server

The baked device UI keeps working as-is from `cloud-comm`, but UI developers can point
`next dev` at the running fake device runtime.

From `trakrai/web`:

```bash
pnpm --filter trakrai-device dev
```

In development, `trakrai-device` now auto-resolves the fake device runtime from the current
browser host on port `18080`, so `http://127.0.0.1:3000` talks to `http://127.0.0.1:18080`
and `http://localhost:3000` talks to `http://localhost:18080` without extra setup.

That keeps the Next.js app on the normal dev port while the runtime config, WebSocket, and
ICE config continue to come from the fake device stack.

If you need to override the default fake-device port or use a fully custom runtime-config URL:

```bash
NEXT_PUBLIC_TRAKRAI_LOCAL_DEVICE_HTTP_PORT=28080 pnpm --filter trakrai-device dev

NEXT_PUBLIC_TRAKRAI_RUNTIME_CONFIG_URL=http://127.0.0.1:28080/api/runtime-config \
pnpm --filter trakrai-device dev
```

The local emulator also publishes a dedicated UDP range for WebRTC media and advertises
`127.0.0.1` as the local host candidate by default. If your machine needs a different host IP
or a different UDP range, override those when starting the stack:

```bash
python3 trakrai/device/scripts/local_device_runtime.py up \
  --video /absolute/path/to/sample.mp4 \
  --webrtc-host-candidate-ip 127.0.0.1 \
  --webrtc-udp-port-min 41000 \
  --webrtc-udp-port-max 41049
```

The local device staging flow whitelists common Next dev origins by default:

- `http://127.0.0.1:3000` through `http://127.0.0.1:3005`
- `http://localhost:3000` through `http://localhost:3005`

If you need a different origin, override it before starting the fake device stack:

```bash
TRAKRAI_UI_DEV_ORIGINS=http://127.0.0.1:3100,http://localhost:3100 \
python3 trakrai/device/scripts/local_device_runtime.py up --video /absolute/path/to/sample.mp4
```

If the existing broker is reachable differently from Docker on your machine, override it:

```bash
python3 trakrai/device/scripts/local_device_runtime.py up \
  --video /absolute/path/to/sample.mp4 \
  --mqtt-host 192.168.1.50
```
