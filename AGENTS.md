# AGENTS.md

This file is the working guide for agents operating inside `D:\trakrbi\trakrai`.
It is intended to let a new agent become productive without replaying the whole history of the repo.

Important:

- This repo contains local-only environment details, including device access used during development.
- Do not copy these credentials to public repos, tickets, or external documentation.
- Remove or redact the access section before sharing this file outside the trusted internal environment.
- Do not commit logs, temporary configs, or machine-specific artifacts.

## What This Repo Is

`trakrai` is a split web + device system for cloud-controlled edge devices.

Current active focus:

- cloud-side live camera viewing
- MQTT-based command/signaling
- on-device RTSP ingest
- on-device WebRTC live streaming
- a separation between generic communication plumbing and app-specific services

The repo was migrated into the following layout:

- `web/`
  Cloud/web monorepo
- `device/`
  Unified Go module for on-device services
- `deploy/`
  Root-level Docker Compose deployment assets for broker/TURN/postgres/live gateway

Important renames/migrations already completed:

- old `cloud/` folder was renamed to `web/`
- old `deploy/` folder was moved to repo root as `deploy/`
- old cloud live service name `live-feeder` was renamed to `live-gateway`
- on-device services were consolidated into one Go module under `device/`

## Current Architecture Snapshot

### Cloud/web side

- `web/apps/trakrai`
  The Next.js application
- `web/services/live-gateway`
  Dedicated cloud-side live-view service
- `deploy/mosquitto`
  MQTT broker config
- `deploy/coturn`
  TURN/STUN config
- `deploy/docker-compose.yml`
  Local infra stack definition

### Device side

- `device/cmd/cloud-comm`
  On-device MQTT router + IPC server
- `device/cmd/live-feed`
  On-device WebRTC live service
- `device/cmd/rtsp-feeder`
  On-device RTSP ingest service that writes JPEG frames to Redis

### Key design rule

`cloud-comm` must remain app-agnostic.

It should know:

- MQTT connection
- topic routing
- IPC registration
- status/error reporting
- heartbeats

It should not know:

- camera business logic
- WebRTC details
- PTZ logic
- speaker logic
- app-specific payload semantics

## End-to-End Live View Flow

Current live-view flow:

1. Browser opens `http://localhost:3000/live`.
2. The Next.js UI uses `LiveGatewayClient` to open a WebSocket to `live-gateway`.
3. `live-gateway` subscribes to the device topics and immediately sends a `get-status` command.
4. `cloud-comm` receives MQTT commands and routes them over IPC to `live-feed`.
5. `live-feed` receives `start-live`, creates a WebRTC peer connection, and publishes:
   - `start-live-ack`
   - `sdp-offer`
   - ICE candidates
6. Browser receives the offer through `live-gateway`, creates the answer, and sends answer + ICE back.
7. `live-feed` pulls frames from Redis, encodes them to H.264, and writes them to the WebRTC track.
8. The browser displays the live stream and gathers real-time stats.
9. Device heartbeats/status updates continue over MQTT.
10. UI diagnostics show:
    - connection state
    - bitrate
    - fps
    - resolution
    - RTT
    - jitter
    - packet loss
    - codec
    - route
11. On stop, the browser sends `stop-live`, and `live-feed` tears down the session and reports `idle`.

## Current Repo Map

### Top-level

- `deploy/docker-compose.yml`
- `device/`
- `web/`

### Web app

- `web/apps/trakrai/src/app/live/page.tsx`
  Live-view page shell
- `web/apps/trakrai/src/app/live/_components/live-view.tsx`
  Main live-view UI
- `web/apps/trakrai/src/app/live/_components/use-device-stream.ts`
  Browser-side state machine, stats collection, signaling handling
- `web/apps/trakrai/src/app/live/_components/video-player.tsx`
  Video surface and overlay
- `web/apps/trakrai/src/lib/live-gateway-client.ts`
  WebSocket client with reconnect and outbound queueing

### Live gateway

- `web/services/live-gateway/src/index.ts`
  Express + WebSocket server bootstrap
- `web/services/live-gateway/src/config.ts`
  Env parsing and MQTT topic helpers
- `web/services/live-gateway/src/mqtt-client.ts`
  Cloud-side MQTT client
- `web/services/live-gateway/src/ws-handler.ts`
  Browser <-> MQTT signaling bridge

### Device services

- `device/cmd/cloud-comm/main.go`
- `device/cmd/live-feed/main.go`
- `device/cmd/rtsp-feeder/main.go`
- `device/internal/cloudcomm/`
- `device/internal/livefeed/`
- `device/internal/rtspfeeder/`
- `device/internal/ipc/`
- `device/internal/shared/`

### Device configs

- `device/configs/cloud-comm.sample.json`
- `device/configs/live-feed.sample.json`
- `device/configs/rtsp-feeder.sample.json`

### Design/architecture docs

- `web/docs/communication-layer-plan.md`

## Device Access And Runtime Details

These details are currently used for local/internal development and testing.

### SSH access

- Host: `10.8.0.50`
- User: `hacklab`
- Password: `HACK@LAB`
- Current device ID in the system: `hacklab@10.8.0.50`

Example:

```powershell
ssh hacklab@10.8.0.50
```

### Remote runtime layout

- Runtime folder:
  `/home/hacklab/trakrai-device-runtime`
- Log folder:
  `/tmp/trakrai-device-runtime-logs`
- IPC socket:
  `/tmp/trakrai-cloud-comm.sock`
- Redis:
  `localhost:6379`

Expected runtime contents:

- `/home/hacklab/trakrai-device-runtime/cloud-comm`
- `/home/hacklab/trakrai-device-runtime/cloud-comm.json`
- `/home/hacklab/trakrai-device-runtime/live-feed`
- `/home/hacklab/trakrai-device-runtime/live-feed.json`
- `/home/hacklab/trakrai-device-runtime/rtsp-feeder`
- `/home/hacklab/trakrai-device-runtime/rtsp-feeder.json`

Do not leave extra files like:

- `*.new`
- old repo copies
- temporary logs
- local build junk

### Remote logs

- `/tmp/trakrai-device-runtime-logs/cloud-comm.log`
- `/tmp/trakrai-device-runtime-logs/live-feed.log`
- `/tmp/trakrai-device-runtime-logs/rtsp-feeder.log`

Useful remote inspection commands:

```bash
ps -ef | grep '[c]loud-comm'
ps -ef | grep '[l]ive-feed'
ps -ef | grep '[r]tsp-feeder'
tail -n 50 /tmp/trakrai-device-runtime-logs/cloud-comm.log
tail -n 50 /tmp/trakrai-device-runtime-logs/live-feed.log
tail -n 50 /tmp/trakrai-device-runtime-logs/rtsp-feeder.log
```

### Broker/TURN host currently in use

- Broker host: `10.8.0.51`
- MQTT port: `1883`
- TURN host: `10.8.0.51`
- TURN port: `3478`
- TURN username: `trakrai`
- TURN credential: `trakrai-secret`

## How Services Work

### `cloud-comm`

Responsibility:

- connect to MQTT
- subscribe to device command/signaling topics
- host the Unix-domain IPC server
- route MQTT envelopes to registered local services
- publish heartbeats and status snapshots
- publish service-unavailable errors when a target service is not registered

It exposes IPC methods including:

- `register-service`
- `publish-message`
- `report-status`
- `report-error`

It currently supports:

- legacy live topics:
  - `trakrai/device/<deviceId>/command`
  - `trakrai/device/<deviceId>/webrtc/answer`
  - `trakrai/device/<deviceId>/webrtc/ice`
- future/generic service topics:
  - `trakrai/device/<deviceId>/service/<service>/command`
  - `trakrai/device/<deviceId>/service/<service>/webrtc/answer`
  - `trakrai/device/<deviceId>/service/<service>/webrtc/ice`

### `live-feed`

Responsibility:

- register itself with `cloud-comm` over IPC as `live-feed`
- react to MQTT-routed commands from IPC
- read frames from Redis
- create the WebRTC peer connection
- encode outgoing media as H.264
- send ack/offer/ICE through IPC -> MQTT
- report status transitions

Current status transitions:

- `idle`
- `starting`
- `negotiating`
- `streaming`
- `stopped`

Current reliability behavior:

- each stream start gets a unique `sessionId`
- stale answers/ICE are ignored
- transient `disconnected` states are not torn down immediately
- a disconnect grace window is used before stop

### `rtsp-feeder`

Responsibility:

- connect to RTSP camera sources
- use GStreamer capture pipelines
- write JPEG frames to Redis under the configured camera key prefix
- keep camera pipelines alive and reconnect when needed

This service is the upstream producer for `live-feed`.

### `live-gateway`

Responsibility:

- expose `/api/health`
- expose `/api/ice-config`
- host WebSocket endpoint `/ws`
- bridge browser signaling to MQTT
- subscribe to per-device response/status/offer/ICE topics
- cache last known device status and send it immediately to new browser sessions

Important:

- this is app-specific live-view logic
- it is not the future generic cloud communication layer

## How To Run Everything Locally

### Web workspace install

From `D:\trakrbi\trakrai\web`:

```powershell
pnpm install
```

### Root infra via Docker Compose

From `D:\trakrbi\trakrai\deploy`:

```powershell
docker compose up -d postgres mosquitto coturn
docker compose ps
```

### Run the Next.js app locally

From `D:\trakrbi\trakrai\web`:

```powershell
$env:SKIP_ENV_VALIDATION='true'
$env:NEXT_PUBLIC_LIVE_GATEWAY_WS_URL='ws://localhost:4000/ws'
$env:NEXT_PUBLIC_LIVE_GATEWAY_HTTP_URL='http://localhost:4000'
pnpm --filter trakrai dev
```

### Run the live gateway locally

From `D:\trakrbi\trakrai\web`:

```powershell
$env:MQTT_BROKER_URL='mqtt://10.8.0.51:1883'
$env:TURN_SERVER_URL='turn:10.8.0.51:3478'
$env:TURN_USERNAME='trakrai'
$env:TURN_CREDENTIAL='trakrai-secret'
$env:DEVICE_ID='hacklab@10.8.0.50'
pnpm --filter @trakrai/live-gateway dev
```

### Useful web checks

From `D:\trakrbi\trakrai\web`:

```powershell
pnpm --filter trakrai lint
pnpm --filter trakrai typecheck
pnpm --filter @trakrai/live-gateway build
```

### Open the live UI

```text
http://localhost:3000/live
```

## Device Builds

The device is a single Go module:

- module path: `github.com/trakrai/device-services`

Only `live-feed` and `rtsp-feeder` need GStreamer/CGO.
`cloud-comm` should stay on the plain Docker build path.

### Build all device binaries

From `D:\trakrbi\trakrai\device`:

```powershell
make build
```

### Build individual binaries

```powershell
make build-cloud-comm
make build-live-feed
make build-rtsp-feeder
```

Outputs:

- `device/out/cloud-comm/cloud-comm`
- `device/out/live-feed/live-feed`
- `device/out/rtsp-feeder/rtsp-feeder`

### Why there are two Dockerfiles

- `device/Dockerfile`
  For non-CGO services like `cloud-comm`
- `device/Dockerfile.gstreamer`
  For CGO/GStreamer services like `live-feed` and `rtsp-feeder`

Do not add GStreamer dependencies to services that do not need them.

## Device Deployment And Restart Recipes

### Copy one rebuilt binary to the device

Example for `live-feed`:

```powershell
scp D:\trakrbi\trakrai\device\out\live-feed\live-feed hacklab@10.8.0.50:/home/hacklab/trakrai-device-runtime/live-feed.new
```

### Restart `live-feed` on the device

```bash
mv /home/hacklab/trakrai-device-runtime/live-feed.new /home/hacklab/trakrai-device-runtime/live-feed
chmod +x /home/hacklab/trakrai-device-runtime/live-feed
pkill -f "/home/hacklab/trakrai-device-runtime/live-feed -config /home/hacklab/trakrai-device-runtime/live-feed.json" || true
nohup /home/hacklab/trakrai-device-runtime/live-feed -config /home/hacklab/trakrai-device-runtime/live-feed.json >> /tmp/trakrai-device-runtime-logs/live-feed.log 2>&1 < /dev/null &
```

Same pattern applies to:

- `cloud-comm`
- `rtsp-feeder`

Current caveat:

- services are launched with `nohup`
- they are not yet managed by `systemd`
- a reboot will require manual restart unless persistence is added later

## Adding A New On-Device Service

Use this flow.

### 1. Pick the service name

Example:

- `ptz`
- `speaker`
- `roi`

Use that exact name consistently in:

- `cmd/<service>`
- `internal/<service>`
- IPC registration
- MQTT topic path under `/service/<service>/...`

### 2. Add the entrypoint

Create:

- `device/cmd/<service>/main.go`

Follow the same pattern as the existing services:

- parse `-config`
- load config
- configure logging
- use signal-aware context
- run service

### 3. Add the internal package

Create:

- `device/internal/<service>/config.go`
- `device/internal/<service>/service.go`

Optionally:

- adapter files
- transport files
- hardware/service-specific helpers

### 4. Decide if the service needs IPC

If it receives commands from cloud/web:

- create `ipc.NewClient(socketPath, "<service-name>")`
- call `Connect()`
- register the service
- listen to `Notifications()`
- handle routed MQTT envelopes
- use `ReportStatus()`
- use `ReportError()`
- use `Publish()` for responses/events

### 5. Use generic service topics for new services

Prefer:

- `trakrai/device/<deviceId>/service/<service>/command`
- `trakrai/device/<deviceId>/service/<service>/response`
- `trakrai/device/<deviceId>/service/<service>/status`

Do not add new legacy top-level topics unless there is a hard backward-compatibility reason.

### 6. Add a sample config

Create:

- `device/configs/<service>.sample.json`

Document:

- required fields
- defaults
- external dependencies

### 7. Update build pipeline

If the service is plain Go:

- use `device/Dockerfile`

If the service needs GStreamer/CGO:

- use `device/Dockerfile.gstreamer`

Add a `Makefile` target if the service is part of the normal workflow.

### 8. Do not put app logic into `cloud-comm`

If you find yourself wanting code like:

- `if service == "ptz" { ... }`
- `if action == "speaker-volume" { ... }`

stop and move that behavior into the service itself.

`cloud-comm` should route, not interpret.

## Adding A New Cloud/Web Service

Use this when the browser needs app-specific protocol handling.

Examples:

- `live-gateway`
- future `ptz-gateway`
- future `speaker-gateway`

Use this flow:

1. create `web/services/<service-name>`
2. give it its own `package.json`
3. expose only the API/WebSocket surface needed for that app
4. keep MQTT topic handling typed and explicit
5. keep browser-specific signaling/session logic in that service
6. do not turn it into a second generic broker/router

If the app only needs generic request/response routing, that belongs in a future generic cloud communication layer instead.

## TypeScript Guidance

Write TypeScript in a way that matches the current repo.

### General rules

- prefer explicit payload types over `any`
- keep transport/state-machine logic in hooks or small clients
- keep UI components focused on rendering and controls
- run `lint` and `typecheck` before stopping

### UI rules for `web/apps/trakrai`

- use `@trakrai/design-system` components first
- do not introduce ad-hoc controls when a shared component already exists
- use the live page pattern:
  - hook manages protocol and state
  - component renders cards/controls/diagnostics
- keep diagnostic information readable, not hidden in raw console output

### Environment handling

- normalize env strings
- trim URLs and device IDs
- assume someone may accidentally leave trailing spaces in env values

This matters because a previous bug was caused by a trailing space in the WebSocket URL.

### WebRTC/browser rules

- always track `sessionId`
- ignore stale or duplicate offers/ICE
- avoid tearing down on transient `disconnected` immediately
- expose useful operator feedback:
  - status
  - camera
  - recent events
  - metrics

## Go Guidance

Write Go in the style already used in `device/`.

### Structure

- entrypoints in `cmd/`
- service logic in `internal/<service>/`
- shared utilities in `internal/shared/`
- cross-service IPC code in `internal/ipc/`

### Patterns to follow

- config loader per service
- `slog` structured logs
- signal-aware root context
- clean shutdown on `SIGINT`/`SIGTERM`
- report status transitions, not just fatal errors

### Service registration

If the service is controllable through `cloud-comm`, register over IPC and make sure it:

- reports `idle` or equivalent on start
- reports `starting` / `negotiating` / `running` / `streaming` when relevant
- reports `stopped` on shutdown

### Hardware/media services

Only media services should depend on GStreamer.

Right now:

- `rtsp-feeder` needs GStreamer
- `live-feed` needs GStreamer
- `cloud-comm` does not

## Testing Guidance

### Web checks

```powershell
cd D:\trakrbi\trakrai\web
pnpm --filter trakrai lint
pnpm --filter trakrai typecheck
pnpm --filter @trakrai/live-gateway build
```

### Browser testing

Preferred flow:

1. ensure Next.js app is on `:3000`
2. ensure `live-gateway` is on `:4000`
3. ensure device runtime is running
4. open `/live`
5. verify:
   - cameras load
   - status loads without waiting for heartbeat only
   - start stream works
   - metrics populate
   - switch camera works
   - stop stream returns to idle cleanly

### Current tested baseline

Recent tested path:

- browser UI through Playwright
- local Next.js dev server
- local `live-gateway`
- remote Jetson device at `10.8.0.50`

Observed stable resource baseline while streaming:

- `rtsp-feeder`: about `29.5%` CPU, `~111 MB` RSS
- `live-feed`: about `1.1%` to `2.3%` CPU, `~72 MB` RSS
- `cloud-comm`: near `0%` CPU, `~8 MB` RSS
- Jetson RAM: about `3135` to `3138 MB / 3956 MB`
- `GR3D_FREQ` was often `99%`

Important note:

- the stable run used a `host / udp` route in diagnostics
- that means the tested path was effectively LAN/direct
- remote internet / TURN-heavy paths still deserve separate validation

## Known Gotchas

### Local dev processes can interfere with testing

Ports to check:

- `3000` for the Next.js app
- `4000` for `live-gateway`

Useful Windows checks:

```powershell
Get-NetTCPConnection -LocalPort 3000,4000
Get-Process node
```

### `rg.exe` may fail in this Codex session on Windows

If ripgrep fails with access/launcher issues, use PowerShell alternatives:

- `Get-ChildItem`
- `Select-String`
- `Get-Content`

### Do not commit local junk

Never commit:

- `.codex-logs/`
- `device/out/`
- temporary config files
- runtime logs
- machine-local helper scripts unless they are intentionally part of the repo

### Device runtime is not yet service-managed

Because the Jetson runtime is currently `nohup`-based:

- processes can die silently
- reboot persistence is not guaranteed
- manual verification is required after restarts

### Legacy live topics still exist

`live-feed` still supports the top-level live topics for compatibility.
New services should use the generic `/service/<service>/...` topic structure.

## Useful File Jump List

If you are investigating a live-view issue, start here:

- `web/apps/trakrai/src/app/live/_components/use-device-stream.ts`
- `web/apps/trakrai/src/app/live/_components/live-view.tsx`
- `web/apps/trakrai/src/app/live/_components/video-player.tsx`
- `web/apps/trakrai/src/lib/live-gateway-client.ts`
- `web/services/live-gateway/src/ws-handler.ts`
- `web/services/live-gateway/src/mqtt-client.ts`
- `device/internal/livefeed/service.go`
- `device/internal/livefeed/webrtc.go`
- `device/internal/cloudcomm/mqtt.go`
- `device/internal/ipc/server.go`

If you are extending the architecture, also read:

- `web/docs/communication-layer-plan.md`

## Practical Rules For Future Agents

1. Keep `cloud-comm` generic.
2. Keep live-specific logic inside `live-feed` and `live-gateway`.
3. Use the design-system components on the web side.
4. Use typed envelopes and explicit session IDs.
5. Prefer generic `/service/<service>/...` topics for new services.
6. Only use GStreamer where it is actually required.
7. Verify with both code checks and a real browser path when touching live view.
8. Check Jetson resource usage when making media-pipeline changes.
9. Clean up remote runtime folders after deployment.
10. Never leave temporary logs/configs in the repo.
