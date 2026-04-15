# Local Device Emulator

This stack treats a Docker container as the local TrakrAI device runtime and reuses the existing staged deployment flow instead of inventing a second startup path.

What it does:

- builds device artifacts for the local Docker platform
- stages the runtime with the same manifest/bootstrap flow used by `deploy_device_runtime.py`
- starts an Ubuntu 18.04 + Python 3.8 device container
- runs a fake RTSP camera from a looped MP4 file
- connects `cloud-comm` to the existing Mosquitto broker already running on the laptop

Default local configs only include the services that can run meaningfully without hardware or cloud credentials:

- `cloud-comm`
- `cloud-transfer`
- `live-feed`
- `rtsp-feeder`
- `runtime-manager`

The local stack also starts mock cloud storage infrastructure for the transfer worker:

- `minio` on `http://127.0.0.1:19000`
- `mock-cloud-api` on `http://127.0.0.1:18090`

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
- broker host inside containers: `host.docker.internal:1883`
- local MinIO API: `http://127.0.0.1:19000`
- local MinIO console: `http://127.0.0.1:19001`
- local mock cloud API: `http://127.0.0.1:18090`

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
- confirms the object exists in the mock cloud bucket
- simulates a cloud outage to verify retry/backoff recovery
- simulates a short timeout window to verify expiry/failure behavior
- enqueues a download for the same object
- verifies the downloaded payload matches the original file

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
