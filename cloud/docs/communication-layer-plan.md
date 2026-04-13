# Cloud Communication Layer Plan

## Immediate Split

The first separation is:

1. `mosquitto`
   The broker only. It should remain app-agnostic and never contain WebRTC or UI logic.
2. `live-feeder`
   A dedicated cloud-side service for browser live-view sessions. It speaks WebSocket/WebRTC to the browser and MQTT to the device.
3. `Next.js cloud UI`
   The UI does not talk to the device directly. For live view it connects to `live-feeder`. For normal control flows it should publish commands through a future generic cloud communication service.

This keeps live-view isolated from the rest of the device-control roadmap.

## Target Cloud-Side Layout

### 1. Broker

- Service: `mosquitto`
- Responsibility:
  - route MQTT messages
  - persist retained messages only where needed
  - enforce auth and ACLs later
- Must not know about:
  - PTZ
  - ROI
  - speaker
  - live view
  - WebRTC

### 2. Generic Communication Layer

- Proposed future service: `cloud-comm`
- Responsibility:
  - authenticate cloud-side callers
  - publish device-targeted MQTT envelopes
  - subscribe to device responses/status
  - expose a generic request/response stream to the cloud UI and backend
- Must not know app semantics.
- It should understand:
  - `deviceId`
  - `service`
  - `action`
  - `requestId`
  - `replyTo`
  - `payload`
  - `timestamp`

### 3. App-Specific Services

- `live-feeder`
  - dedicated to live feed control and WebRTC signaling
- future:
  - `ptz-gateway`
  - `speaker-gateway`
  - `roi-session-service`

These services are allowed to know app-specific packet formats. The generic communication layer is not.

## Message Contract

Every packet should use a shared envelope:

```json
{
  "requestId": "uuid",
  "deviceId": "hacklab@10.8.0.50",
  "service": "live-feed",
  "action": "start",
  "replyTo": "trakrai/cloud/session/<sessionId>",
  "timestamp": "2026-04-13T12:00:00.000Z",
  "payload": {}
}
```

### Required envelope fields

- `requestId`
  Correlates command, ack, error, and completion.
- `deviceId`
  Identifies the target device.
- `service`
  Routes the message to a device-side service such as `live-feed`, `ptz`, or `speaker`.
- `action`
  The operation inside that service.
- `replyTo`
  Topic where the response should be published.
- `payload`
  Arbitrary service-specific data.

## Topic Design

Recommended topic layout:

### Device command plane

- `trakrai/device/<deviceId>/service/<service>/command`
- `trakrai/device/<deviceId>/service/<service>/response`
- `trakrai/device/<deviceId>/service/<service>/status`

### Device health plane

- `trakrai/device/<deviceId>/health/heartbeat`
- `trakrai/device/<deviceId>/health/metrics`
- `trakrai/device/<deviceId>/health/errors`

### Session-specific live signaling

- `trakrai/device/<deviceId>/service/live-feed/session/<sessionId>/offer`
- `trakrai/device/<deviceId>/service/live-feed/session/<sessionId>/answer`
- `trakrai/device/<deviceId>/service/live-feed/session/<sessionId>/ice`

Using `sessionId` avoids collisions when multiple operators open live view at the same time.

## Live-Feeder Flow

### Browser to cloud

1. Browser connects to `live-feeder`.
2. Browser selects `deviceId` and `cameraName`.
3. `live-feeder` publishes a `live-feed:start` command over MQTT.

### Cloud to device

4. Device-side live service receives the MQTT command.
5. Device starts or attaches to the feed pipeline.
6. Device publishes `ack`.
7. Device and `live-feeder` exchange SDP/ICE via MQTT.
8. Browser receives the remote track from `live-feeder` signaling.

### Stop flow

9. Browser sends `stop`.
10. `live-feeder` publishes `live-feed:stop`.
11. Device tears down the session and sends final state.

## Why This Split Helps

- The broker remains reusable for future apps.
- WebRTC complexity stays isolated inside `live-feeder`.
- Live-view failures do not contaminate PTZ or speaker control logic.
- Future edge UI can reuse the same device-side service contracts later.

## Shortcomings and Risks

### 1. MQTT is not a media plane

MQTT is good for control and signaling, but not for streaming video bytes. The actual video must stay on WebRTC.

### 2. Session fan-out gets tricky

If multiple browsers connect to the same camera:

- do we create one encoder per viewer?
- do we share a single encoder and multiple peer connections?
- do we allow only one operator at a time?

This must be decided explicitly.

### 3. Broker becomes a critical dependency

If Mosquitto goes down:

- start/stop commands stop working
- PTZ commands stop working
- live signaling stops

Mitigation:

- retained device-presence topics
- reconnect/backoff policy
- health monitoring
- optional HA broker later

### 4. Ordering and stale commands

On unstable links, MQTT retries can cause stale commands to land late. For PTZ and live view this can be dangerous.

Mitigation:

- `requestId`
- `timestamp`
- TTL or expiry in payload
- idempotency handling on device

### 5. WebRTC NAT issues

TURN/STUN configuration must be public-address aware. `localhost` TURN settings break as soon as the browser is on a different machine.

### 6. Generic layer can accidentally become app-aware

This is the main architectural trap. The generic layer should never branch on things like:

- if action is PTZ
- if action is ROI
- if action is live view

Once that happens, it stops being reusable and turns into another monolith.

### 7. Device service routing can become fragile

If one process routes commands to many local apps, then:

- process crashes impact every app
- backpressure in one app can affect others
- message queues need isolation

Mitigation:

- one router process
- separate local adapters per service
- per-service worker queues

### 8. Authentication and authorization are not solved by MQTT alone

Even on the cloud side you still need:

- operator auth
- device auth
- per-service authorization
- audit trails

## Recommended Next Steps

1. Keep `mosquitto` as the pure broker.
2. Keep `live-feeder` as the dedicated live-view cloud service.
3. Introduce a future `cloud-comm` service for non-live generic command routing.
4. Move live MQTT topics to `service/live-feed/...`.
5. Add `sessionId` into every live-view topic and payload.
6. Add broker auth and topic ACLs before expanding to PTZ and speaker control.
