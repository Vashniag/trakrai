# TrakrAI local-stack bringup

A single runbook to go from a fresh git clone to a live end-to-end pipeline:

```
fake RTSP cameras  →  rtsp-feeder  →  Redis  →  ai_inference (GPU)
                                          ↓
                                     live-feed (WebRTC)  →  Browser
                                          ↑
        cloud-comm  ←  MQTT  ←  live-gateway  ←  Next.js cloud UI
```

Every step below assumes the repository root is your working directory.

---

## 1. Host prerequisites

Verified on Windows 11 (bash shell, Docker Desktop with WSL2, NVIDIA driver
≥ 535), but the commands are Linux-portable.

| Requirement | Minimum | Used for |
|-------------|---------|----------|
| Docker Engine | 24+ | every container service |
| Docker Compose | v2 | orchestration |
| NVIDIA driver + nvidia-container-toolkit | matches CUDA 12.1 | GPU inference |
| Node.js | 20+ | web workspace |
| pnpm | 10.33 | web workspace |
| Go | 1.21+ | device services |
| Python | 3.10+ (Linux) / any 3.10+ (Windows: `python`) | devtool |

Verify locally:

```bash
docker --version && docker compose version
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi --query-gpu=name --format=csv,noheader
node --version && pnpm --version && go version && python --version
```

If `docker run --gpus all` fails, install the nvidia-container-toolkit before
continuing. Windows users need to enable GPU support in Docker Desktop
(Settings → Resources → WSL integration → GPU).

---

## 2. Configure environment

Two env files are consumed — one for the cloud stack, one for the cloud web
app.

### 2.1 `deploy/.env`

Already drafted for local dev. Key values:

- `APP_DOMAIN=localhost` — no TLS by default (Caddy is behind the `tls`
  compose profile; skip it for local dev).
- `TURN_SERVER_URL=turn:<host-ip>:3478?transport=udp,…` — point at the
  laptop IP so containers can reach coturn.
- `POSTGRES_USER=trakrai`, `POSTGRES_PASSWORD=trakrai-local-dev` — change for
  production.

Edit `deploy/.env` if your LAN IP differs from `192.168.1.35`.

### 2.2 `web/apps/trakrai/.env.local`

Required only when you also run the cloud-side Next.js app. Create it with:

```ini
SKIP_ENV_VALIDATION=true
DATABASE_URL=postgres://trakrai:trakrai-local-dev@localhost:5439/trakrai
STORAGE_PROVIDER=MINIO
MINIO_ENDPOINT=http://localhost:29000
MINIO_DEVICE_ENDPOINT=http://host.docker.internal:29000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET_NAME=trakrai-local
MINIO_REGION=us-east-1
BETTER_AUTH_SECRET=local-dev-better-auth-secret-change-me-change-me
BETTER_AUTH_URL=http://localhost:3010
MICROSOFT_CLIENT_ID=local-dev-placeholder
MICROSOFT_CLIENT_SECRET=local-dev-placeholder
MICROSOFT_TENANT_ID=common
SMTP_SERVER=smtp://localhost:1025
SMTP_USER=dev
SMTP_PASSWORD=dev
EMAIL_SENDER_ADDRESS=dev@example.com
NEXT_PUBLIC_TRAKRAI_CLOUD_GATEWAY_BASE_URL=http://localhost:4000
PORT=3010
NODE_ENV=development
```

Replace with real values before pushing to production.

### 2.3 `web/apps/trakrai-device/.env.local`

Only needed when running `pnpm --filter trakrai-device dev`. The device
bundle served by `cloud-comm` reads runtime config from the device itself,
so this is optional for the main flow.

```ini
SKIP_ENV_VALIDATION=true
NEXT_PUBLIC_TRAKRAI_CLOUD_API_URL=http://localhost:3000
NEXT_PUBLIC_TRAKRAI_CLOUD_BRIDGE_URL=ws://localhost:4000/ws
NEXT_PUBLIC_TRAKRAI_DEVICE_ID=trakrai-device-local
NEXT_PUBLIC_TRAKRAI_DEVICE_TRANSPORT_MODE=edge
NEXT_PUBLIC_TRAKRAI_ENABLE_DIAGNOSTICS=true
NEXT_PUBLIC_TRAKRAI_LOCAL_DEVICE_HTTP_PORT=18080
NODE_ENV=development
```

---

## 3. Install web workspace

```bash
cd web
pnpm install
cd ..
```

First-time install takes ~60s and needs ~2 GB free disk.

---

## 4. Start the cloud stack

```bash
cd deploy
docker compose up -d postgres mosquitto live-gateway
cd ..
```

Validate:

```bash
curl -fsS http://localhost:4000/api/health   # expect: mqtt=connected
curl -fsS http://localhost:4000/api/ice-config
docker compose -f deploy/docker-compose.yml ps
```

Optional (if the browser is remote or behind NAT):

```bash
cd deploy && docker compose up -d coturn && cd ..
```

Optional (TLS via Caddy):

```bash
cd deploy && docker compose --profile tls up -d gateway-proxy && cd ..
```

---

## 5. Download sample assets

The `devtool` CLI can fetch a demo mp4 and a YOLOv5n weights file on demand:

```bash
python -m device.devtool assets download --all
python -m device.devtool assets list
```

Outputs land in `device/.localdev/assets/`. The `emulator up --auto-assets`
flag below calls the same downloader when launching the stack.

---

## 6. Build the GPU-capable device emulator image

```bash
cd device/localdev
docker build -t trakrai-local-device-emulator:gpu \
  -f ./device-emulator/Dockerfile.gpu ./device-emulator
cd ../..
```

This image bakes in:

- CUDA 12.1 + cuDNN 8 (matches `torch==2.1.2+cu121`)
- Ubuntu 22.04 + Python 3.10 (close enough to the Jetson baseline that wheels
  work; upgraded because CUDA 12 wheels need Python ≥ 3.9)
- OpenCV, NumPy, Redis, GStreamer — everything `ai_inference`, `rtsp-feeder`,
  and `live-feed` need
- The `fake_systemctl.py` + entrypoint used by the staged runtime

A CPU-only fallback (`Dockerfile`) is kept side-by-side for CI/Mac hosts that
cannot expose a GPU.

---

## 7. Bring up the emulator

```bash
python -m device.devtool emulator up \
  --gpu \
  --auto-assets \
  --profile local-emulator-gpu \
  --camera-count 2
```

What this does:

1. Downloads sample video + YOLOv5n weights if missing.
2. Stages `cloud-comm`, `runtime-manager`, `rtsp-feeder`, `live-feed`,
   `ai-inference`, etc. via the same bootstrap flow used on a real Jetson.
3. Applies `device/localdev/docker-compose.gpu.yml` on top of the base
   compose file to request nvidia runtime + GPU reservation.
4. Starts `fake-camera` with 2 RTSP paths (`/stream1`, `/stream2`).
5. Starts MinIO, mock-speaker, cloud-api, redis, and finally the
   `device-emulator` container.

Status + logs:

```bash
python -m device.devtool emulator status
python -m device.devtool emulator logs --service device-emulator --lines 200
python -m device.devtool cameras list
```

Landing pages:

- Edge UI            : http://localhost:18080/
- Edge WS            : ws://localhost:18080/ws
- Runtime API        : http://localhost:18080/api/runtime-config
- MinIO API          : http://localhost:29000/
- MinIO console      : http://localhost:29001/  (minioadmin / minioadmin)
- Cloud API (mock)   : http://localhost:3000/health
- Live-gateway       : http://localhost:4000/api/health

Ports on Windows with WSL2/Hyper-V: the defaults avoid the 18332–19231 range
which Hyper-V reserves dynamically. Overrides exist for each port (see
`device/localdev/docker-compose.yml`) if 29000/29001 collide with something
else on your box.

Open the edge UI, pick a camera, press Start — you should see the live video
with detection boxes overlaid.

---

## 8. Bring up the Next.js cloud app (optional)

```bash
docker build -t trakrai-cloud-web:local -f web/Dockerfile.trakrai web
docker run --rm -p 3010:3010 \
  --env-file web/apps/trakrai/.env.local \
  --add-host=host.docker.internal:host-gateway \
  trakrai-cloud-web:local
```

Or in dev mode (faster iteration):

```bash
cd web
SKIP_ENV_VALIDATION=true PORT=3010 pnpm --filter trakrai dev
```

Hit http://localhost:3010/live. Port 3000 is reserved for the mock cloud API
shipped with the device local-dev stack.

---

## 9. Multi-camera profiling

With the emulator already up, quick visibility into what the stack is
costing the host can be had straight out of the Docker CLI — no extra
tooling required:

```bash
python -m device.devtool cameras list
docker stats --no-stream \
  $(docker ps --format '{{.Names}}' | grep '^trakrai-local-device-')
nvidia-smi --query-gpu=utilization.gpu,memory.used,power.draw \
           --format=csv,noheader
docker exec trakrai-local-device-device-emulator-1 \
  cat /home/hacklab/trakrai-device-runtime/logs/ai-inference.log 2>/dev/null \
  | tail -n 50
```

The ai_inference service prints a `[PERF] frames=… avg_infer=…ms` line
every 5 s — those are the numbers that matter on the Jetson.

**Observed on a GTX 1650 (4 GB) with 6 mock cameras at 640×480 @ 10 FPS for
two minutes**:

| Metric | Value |
|--------|-------|
| Inference average FPS | ~21 |
| Average inference latency | ~49 ms |
| GPU utilization peak | 38 % |
| GPU memory peak | 129 MiB |
| GPU power peak | 15.6 W |
| Device emulator CPU peak | 175 % (multi-core) |
| Device emulator RSS peak | ~1.1 GiB |
| Fake camera CPU peak | ~150 % (6 ffmpeg encoders) |

Jetson-Nano-relevant levers worth tuning based on that report (all exposed
in `device/localdev/configs/*.json`):

- `inference.inference_image_size`: 320 × 320 halves inference cost versus
  512 × 512. On a GTX 1650 we stay under 40 % GPU, but on the Nano that
  headroom evaporates quickly.
- `inference.fp16_inference: true` — already on; halves GPU memory.
- `inference.processed_images_maxlen`: 3 instead of 10 trims Redis RAM
  proportionally.
- `inference.idle_sleep_ms`: bump to 40 ms+ on the Nano so the ingest loop
  does not busy-wait under load.
- `rtsp-feeder.defaults.jpeg_quality`: 75 saves ~15 % CPU over 85.
- `rtsp-feeder.defaults.framerate`: drop to 5 FPS for cameras where motion
  density is low — the workflow engine still reacts within one inference
  tick.
- `live-feed.composite.width/height`: match the inference grid (e.g.
  640×360 for the default 2×2 layout) — composing 1080p tiles you never
  send wastes CPU cycles.
- Pre-compile TensorRT engine (`.engine` file alongside the `.pt`) so
  Jetson inference avoids Python-only PyTorch overhead.

---

## 10. Teardown

```bash
python -m device.devtool emulator down --volumes
cd deploy && docker compose down && cd ..
```

Append `--keep-stage` to keep the staged runtime on disk for faster next-up.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `FATAL: role "trakrai" does not exist` on postgres | stale volume | `docker compose down -v` in `deploy/` |
| `ffprobe` fails on RTSP | fake-camera still warming up | wait 20 s; `cameras probe --path stream1` |
| `torch.cuda.is_available()` is False | wrong Dockerfile selected | rebuild `Dockerfile.gpu`; verify `docker run --gpus all` |
| Browser ICE stuck | TURN unreachable | update `TURN_SERVER_URL` in `deploy/.env`; restart live-gateway |
| `pnpm` not on `PATH` (Windows) | corepack missing | `corepack enable` then retry |
| Edge UI 404 | `edge-ui` service not staged | check `emulator logs --service device-emulator` |
