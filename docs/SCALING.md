# Scaling TrakrAI to thousands of field devices

This document captures gaps identified while bringing the local stack up and
the concrete changes the codebase should adopt before we trust it with 1 K+
devices in the field. Sections are ordered by blast radius — touch device
observability first (free leverage once rolled), then the control plane
where most hard scaling limits hide.

---

## 1. Observability — device side (not yet started)

No Prometheus wiring exists on the device today. What it will take, in order
of payback:

1. **Per-service metrics**. Add `github.com/prometheus/client_golang` to
   `cloud-comm`, `rtsp-feeder`, `live-feed`, `runtime-manager`. Each service
   already owns an HTTP listener so wiring `/metrics` is a few dozen lines.
   For `ai_inference` (Python) wrap the existing `[PERF]` log counters in
   `prometheus_client` gauges behind an opt-in flag.
2. **Host/process metrics**. Small sidecar exporter that tails
   `managed-services.json`, walks `psutil` for per-service CPU/RSS, and
   reads Redis queue depth. Keeps the runtime decoupled from observability.
3. **GPU metrics**. `nvidia/dcgm-exporter` inside the emulator and, on
   Jetsons, `jetson-stats` → `/metrics` bridge. Surfaces GPU temperature,
   memory, SM utilization, power draw.
4. **Structured logging**. Switch every `slog` sink to JSON so
   device→cloud log shipping (Loki / Fluent Bit) can index labels like
   `device_id`, `camera_id`, `session_id`, `service`.
5. **Remote write**. Have the device Prometheus scrape the local exporters
   every 30 s and remote-write to the cloud Mimir/Cortex instance with
   `__address__` labelled with `device_id`. Ten thousand 15 s samples/hour
   per device ≈ 25 MB/day/device — budget for `~250 GB/day` ingest at 10 K
   fleet.

### Core dashboards (once metrics land)

- Fleet overview: online count, version breakdown, uptime histogram.
- Per-device deep dive: GPU temp, inference FPS, dropped frames, Redis queue
  depth, MQTT reconnects, WebRTC session errors.
- Camera health: frames/sec per camera, last detection, stream errors.

---

## 2. Observability — cloud side (not yet started)

1. **Prometheus + Grafana**. Stand up a compose overlay that runs
   Prometheus, Grafana, cAdvisor, redis-exporter, mosquitto-exporter, and
   node-exporter — provisioned with a default "TrakrAI — Overview"
   dashboard that shows container CPU/mem, Redis ops/sec, MQTT rates, and
   (once the device side lands) per-device inference FPS.
2. **Alertmanager**. Wire to email/Slack/PagerDuty: device offline > 5 min,
   inference FPS < 5 on a supposedly streaming camera, MQTT queue depth
   exploding, disk > 80 %.
3. **Trace pipeline** (Jaeger / Tempo). Instrument live-gateway ↔ cloud-comm
   signaling spans keyed by `sessionId` to debug failed WebRTC starts.
4. **Log aggregation** (Loki / Elasticsearch). Ship device `slog` JSON
   lines; allow ops to grep by `device_id=… sessionId=…`.
5. **SLO dashboards** backed by Prometheus recording rules:
   - Live-view availability: `sum(rate(live_session_success_total[5m])) / sum(rate(live_session_attempts_total[5m]))`
   - Command latency p95 per device type.
6. **Synthetic probes**. A headless browser running every 5 min on a canary
   device validates the full pipeline end-to-end.

---

## 3. Transport scalability

The current MQTT topology has every device talking to a single Mosquitto
instance in `deploy/docker-compose.yml`. This breaks past ~5 K concurrent
devices on modest hardware.

### Recommended changes

1. **Broker cluster**. Move to EMQX or HiveMQ Community with shared subs and
   horizontally scaled frontends. Keep Mosquitto in local dev only.
2. **Retained-message audit**. `cloud-comm` writes heartbeats on `status`
   topics that should use `retain=true` with a short TTL — otherwise new
   browser subscribers show stale device state. Confirm retention rules per
   topic.
3. **Device auth**. Replace the shared `trakrai / trakrai-secret` TURN creds
   and the open MQTT with per-device client certs minted through a short
   provisioning flow. Rotate with device `cloud-transfer` jobs.
4. **QoS review**. Heartbeats at QoS 0, commands at QoS 1 with request IDs,
   WebRTC signaling at QoS 1 with idempotent dedup. Audit `cloudcomm/mqtt.go`.
5. **Connection backoff**. The current `nohup`-based device runtime will
   thundering-herd the broker after a rolling broker deploy. Add jittered
   exponential backoff in `cloudcomm.Client.Dial` and a feature flag to rate
   limit the first reconnect storm.

---

## 4. Cloud control plane

### Stateful live-gateway

`live-gateway` currently keeps a per-browser WebSocket and caches the last
device status in memory. With multiple replicas behind a load balancer, a
browser's reconnect can hit a different replica and get no state.

Fix path:

- Persist last-known device status to Redis with a short TTL; a replica
  missing it falls back to `get-status` over MQTT.
- Use sticky cookies (`live-gateway`) or make the WebSocket protocol
  resumable with a session ID.

### Postgres

Single-node Postgres in `deploy/` is a dev shortcut. Production wants:

- Managed multi-AZ Postgres with read replicas for analytics.
- Connection pooling (PgBouncer) between Next.js and Postgres — at 10 K
  devices the default per-pod pool blows past `max_connections`.
- Partitioning: split heavy tables (`device_events`, `detections`) by month.
- Aggressive auto-vacuum tuning for high-write workloads.

### Object storage

- Move from MinIO to S3/Azure Blob in deployed environments (already
  supported by `web/apps/trakrai/src/lib/env.ts`).
- Use presigned URL TTLs < 15 min and tight `Content-Type` allowlist.
- For Jetson clip uploads, prefer multipart with 8 MB parts to ride out
  flaky LTE.

---

## 5. Device OS + lifecycle

### Replace `nohup` with systemd (or k3s)

`AGENTS.md` already flags this. Short-term:

- Generate systemd units from `runtime-manager.json` (the fake-systemctl
  path used in the emulator already emits compatible units under
  `TRAKRAI_SYSTEMCTL_UNIT_DIR`).
- `systemctl enable --now` them during bootstrap.

Long-term for 1 K+ fleet:

- Run each service as a k3s pod. Centralized rolling updates, liveness
  probes, constrained resource classes.
- Ship device OS as a read-only image (balena, Mender, or ostree). Writable
  overlay for configs + captured data only.

### OTA updates

- `runtime-manager` already downloads wheels via `cloud-transfer`. Add:
  * Cryptographic signatures on every package (minisign or cosign).
  * Canary rollouts (10 % → 50 % → 100 %) keyed by `device_id` hash.
  * Automatic rollback: if a new version fails liveness within 10 minutes,
    revert to the previous `version_dir/N-1` and report.

### Provisioning

One-button flow for first boot:

1. Device reads `trakrai.conf` off a USB stick (or cloud-init metadata).
2. Contacts `cloud-provisioning-api` with its hardware ID.
3. Gets a signed device cert + Redis/MQTT URLs + TURN creds.
4. Writes them to `/home/hacklab/trakrai-device-runtime/configs/`.
5. Rebooted by `runtime-manager`.

---

## 6. Pipeline optimizations for Jetson Nano (4 GB / 128 CUDA cores)

These are the knobs that moved the needle most in local stress-test runs.
All are already exposed through the existing config files — we just need the
defaults tuned per hardware profile.

| Knob | Current | Suggested (Jetson Nano) |
|------|---------|--------------------------|
| `inference.inference_image_size` | 512×512 | 320×320 (3× fewer multiplies, usable for COCO) |
| `inference.fp16_inference` | true | true (keep — halves GPU memory) |
| `inference.processed_images_maxlen` | 10 | 3 (Nano has 4 GB system RAM — drop oldest) |
| `inference.poll_interval_ms` | 5 | 15 (Nano saturates at ~20 FPS anyway) |
| `inference.models.weights_path` | `.pt` | `.engine` (pre-compile TensorRT on first run) |
| `rtsp-feeder.defaults.jpeg_quality` | 85 | 75 (≈15 % less CPU, imperceptible quality hit) |
| `rtsp-feeder.defaults.framerate` | 10 | 10 (keep, ingest ≠ inference) |
| `live-feed.composite.width` | 960 | 640 (matches 320×320 inference frames) |
| `live-feed.webrtc.framerate_fps` | 10 | 10 (keep) |
| `video-recorder.buffer_seconds` | 30 | 15 (saves ~150 MB RSS) |

### Further optimizations

1. **Bypass JPEG round-trips**. Today the pipeline is
   `RTSP → H.264 → raw → JPEG → Redis → JPEG decode → YUV → inference`. On
   Jetson, use NVMM buffers end-to-end via `nvv4l2decoder` → `nvvidconv` →
   inference (without the JPEG hop). Save `~40 %` CPU.
2. **DeepStream 6.3** path as an alternative to the current OpenCV
   pipeline. Set via a config flag; keep the existing backend as fallback.
3. **Batch inference across cameras**. The backend already merges
   multi-camera batches; ensure each call has all N cameras' freshest frames
   rather than N single-image calls.
4. **Memory pressure watchdog**. On Jetson Nano, Linux's OOM killer
   regularly murders inference first. Add a monitor in `runtime-manager`
   that drops `processed_images_maxlen` when `MemAvailable < 300 MB`.

---

## 7. Security

1. **Remove secrets from `AGENTS.md`** before any public push. Move to an
   internal runbook.
2. **Harden TURN creds** — today the same `trakrai:trakrai-secret` pair is
   in both live-gateway env and coturn config. Rotate automatically per
   session via short-lived HMAC-based credentials (coturn supports
   `use-auth-secret`).
3. **MQTT ACLs** — restrict per-device publishing to `trakrai/device/<id>/…`
   only. Prevents a compromised device from spoofing others.
4. **Audit log**. Any config-changing command through `runtime` or
   `cloud-transfer` should produce an auditable event.

---

## 8. CI/CD gaps

- No CI for the web workspace (typecheck + lint + build). Add a GitHub
  Action mirroring the existing `publish-device-binaries.yml` pattern.
- No integration test that exercises the emulator end-to-end. A scheduled
  job that runs `devtool assets download`, `emulator up`, validates
  `/api/runtime-config`, and tears down catches regressions early.
- Dependabot / renovate on the three ecosystems (Go, Python, npm).
- Container image scanning (Trivy or Grype) on every PR that touches
  Dockerfiles.

---

## 9. Concrete backlog — actionable tickets

1. [ ] Add `client_golang` exporter to each Go service (one PR per service).
2. [ ] Ship DCGM/jetson-stats metrics.
3. [ ] Move MQTT broker to EMQX cluster for staging/prod.
4. [ ] Replace shared TURN creds with HMAC short-lived creds.
5. [ ] Introduce systemd units for device runtime.
6. [ ] Encode and pre-compile TensorRT engines in OTA package flow.
7. [ ] Build Grafana fleet-overview dashboard.
8. [ ] Alertmanager + PagerDuty wiring.
9. [ ] CI pipeline for web workspace.
10. [ ] Device provisioning service + per-device cert issuance.
