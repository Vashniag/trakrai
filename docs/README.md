# Web Architecture and Device Communication

This document is the current source of truth for the `web/` workspace and its device-facing contracts.

It replaces the earlier `communication-layer-plan.md`, which described a partially future-looking target state that no longer matches the code exactly.

## Workspace shape

The web side is a pnpm workspace with three top-level buckets:

- `apps/`: deployable entrypoints and route shells.
- `packages/`: reusable UI, transport, and feature packages.
- `services/`: standalone server processes that bridge browser-friendly protocols to device-side transport.

Current members:

- `apps/trakrai`: cloud-facing Next.js app.
- `apps/trakrai-device`: static-exportable device-hosted Next.js app.
- `apps/live-gateway`: cloud WebSocket and HTTP bridge for live view.
- `packages/trakrai-design-system`: shared presentational primitives.
- `packages/trakrai-audio-manager-ui`: typed audio queue UI for the `audio-manager` device service.
- `packages/trakrai-live-transport`: transport client, runtime state, diagnostics, and WebRTC providers.
- `packages/trakrai-live-viewer`: live-view feature hook, packet mappers, and viewer UI.
- `packages/trakrai-ptz-controller`: PTZ feature hook, packet mappers, and PTZ UI.
- `packages/trakrai-live-ui`: thin composition shell that assembles viewer, PTZ, diagnostics, inventory, and services panels.

## Architectural patterns on the web side

### 1. Thin app shells

The apps are intentionally light. They choose runtime endpoints, wire providers, and render shared workspace shells.

- `apps/trakrai` selects the cloud bridge and keeps device selection editable.
- `apps/trakrai-device` reads runtime config, chooses edge or cloud mode, and keeps the UI static-export friendly.

If code is reusable across both surfaces, it probably does not belong in `apps/`.

### 2. Layered shared packages

The package stack is intentionally layered:

1. `@trakrai/design-system`
   Styling primitives and low-level UI building blocks.
2. `@trakrai/live-transport`
   Transport client, provider contexts, diagnostics panels, device runtime state, and WebRTC primitives.
3. Feature packages such as `@trakrai/live-viewer`, `@trakrai/ptz-controller`, and `@trakrai/audio-manager-ui`
   Typed packet helpers, feature hooks, and feature-specific UI.
4. `@trakrai/live-ui`
   Composition shell that arranges the shared feature packages into a workspace.

This keeps browser transport and runtime logic below feature logic, and feature logic below composition.

### 3. Providers own protocol state

Stateful protocol code lives in providers and hooks, not in large route components.

- `LiveTransportProvider`
  Owns the WebSocket client, reconnect behavior, message subscriptions, and device switching.
- `DeviceRuntimeProvider`
  Owns cached device status, heartbeat age, activity log entries, and runtime errors.
- `WebRtcProvider`
  Owns peer connection setup, ICE config fetching, offer/answer handling, stats collection, and disconnect recovery.

Feature hooks build on those providers:

- `useLiveViewer` maps live-view packets and WebRTC events into UI-friendly state.
- `usePtzController` maps PTZ command and response packets into control state.

Presentational components stay mostly prop-driven.

### 4. Shared components stay transport-agnostic

Cloud and edge differences are kept at the provider boundary.

The shared packages consume the same transport context whether the active bridge is:

- cloud: `CloudTransportProvider` -> `live-gateway`
- edge: `EdgeTransportProvider` -> device-hosted `cloud-comm`

A shared component should not decide between cloud and edge itself. It should read the active transport from context and render accordingly.

### 5. Typed envelopes and explicit routing

Communication uses a typed envelope plus explicit `service` and `subtopic` routing.

Browser bridge frames look like:

```json
{
  "kind": "packet",
  "service": "live-feed",
  "subtopic": "command",
  "envelope": {
    "type": "start-live",
    "msgId": "123",
    "timestamp": "2026-04-14T10:00:00Z",
    "payload": {
      "cameraName": "LP1-Main",
      "cameraNames": ["LP1-Main"],
      "frameSource": "raw",
      "layoutMode": "single",
      "requestId": "req-1"
    }
  }
}
```

Device switching uses a separate control frame:

```json
{
  "kind": "set-device",
  "deviceId": "hacklab@10.8.0.50"
}
```

Important routing rules:

- `service` decides which device-side service receives the packet.
- `subtopic` preserves the channel shape such as `command`, `response`, `status`, `webrtc/offer`, `webrtc/answer`, or `webrtc/ice`.
- `requestId` binds responses to the browser session that initiated the request.
- `sessionId` binds long-lived live-stream signaling to the owning browser session.

### 6. Feature packages own their packet helpers

Feature-specific packet builders and response readers live with the feature package:

- `trakrai-live-viewer/src/lib/live-viewer-transport.ts`
- `trakrai-ptz-controller/src/lib/ptz-transport.ts`

That keeps transport details close to the feature and avoids pushing feature semantics into the generic transport layer.

### 7. Services are browser bridges, not UI packages

`web/apps/live-gateway` exists because the browser cannot speak MQTT directly and because live-view signaling needs cloud-side session routing.

The service:

- exposes `/ws`
- exposes `/api/ice-config`
- subscribes to device MQTT topics
- routes packets to the right browser session
- caches the last known device status

It should not absorb reusable React UI logic, and it should not become a generic home for app features.

## Shared contract across cloud and edge

The current design deliberately keeps the browser contract the same in both modes.

Both cloud and edge expose:

- a WebSocket endpoint for transport packets
- an HTTP endpoint at `/api/ice-config`
- the same `kind: "packet"` browser frame
- the same `service` and `subtopic` routing rules
- the same typed payload shapes for live view and PTZ

That is why the same React workspace can run unchanged in both `apps/trakrai` and `apps/trakrai-device`.

The main differences are:

- cloud mode can switch between devices and routes through `live-gateway`
- edge mode targets exactly one device runtime and routes through the on-device `cloud-comm` HTTP and WebSocket server
- the device app reads runtime values from `public/runtime-config.js`, while the device runtime can also expose `/api/runtime-config` with the same shape

## Cloud communication flow

Cloud live view and PTZ currently follow this path:

1. The browser loads `apps/trakrai`.
2. The route creates `CloudTransportProvider`, `DeviceRuntimeProvider`, and `WebRtcProvider`.
3. `LiveTransportClient` opens a WebSocket to `apps/live-gateway`.
4. `live-gateway` subscribes to MQTT topics for the selected device and sends a status request.
5. `cloud-comm` on the device receives MQTT commands and routes them over Unix-socket IPC to a registered service such as `live-feed` or `ptz-control`.
6. The target service executes the command and publishes status, response, or WebRTC signaling back through IPC.
7. `cloud-comm` republishes those envelopes to MQTT.
8. `live-gateway` forwards only the relevant packets to the owning browser session by `requestId` and `sessionId`.
9. `WebRtcProvider` handles offer, answer, ICE, and browser stats locally in the browser.

## Edge communication flow

Edge mode intentionally reuses almost the same browser behavior:

1. The browser loads the static `apps/trakrai-device` build.
2. `public/runtime-config.js` decides whether the app uses `edge` or `cloud` transport mode.
3. In edge mode, `EdgeTransportProvider` opens a WebSocket directly to the device-hosted `cloud-comm` server.
4. The same `DeviceRuntimeProvider`, `WebRtcProvider`, `useLiveViewer`, and `usePtzController` logic runs on top of that transport.
5. The device-hosted edge server accepts `/ws`, `/api/ice-config`, `/api/runtime-config`, and optional static UI hosting.
6. Inbound browser packets are dispatched through the same `cloud-comm` routing path into IPC notifications for the target service.
7. Service responses are broadcast back to edge WebSocket clients, with the same request-owner and session-owner rules used by the cloud bridge.

One subtle but important detail: the device-side `TransportPublisher` can publish to both MQTT and edge WebSocket clients. Edge delivery succeeding does not require the cloud path to be the active UI path.

## Actual topic and service contracts

Current device MQTT subscriptions and publishes use:

- `trakrai/device/<deviceId>/command`
- `trakrai/device/<deviceId>/response`
- `trakrai/device/<deviceId>/status`
- `trakrai/device/<deviceId>/service/<service>/command`
- `trakrai/device/<deviceId>/service/<service>/response`
- `trakrai/device/<deviceId>/service/<service>/status`
- `trakrai/device/<deviceId>/service/<service>/webrtc/offer`
- `trakrai/device/<deviceId>/service/<service>/webrtc/answer`
- `trakrai/device/<deviceId>/service/<service>/webrtc/ice`

Current service names used by the shared UI stack:

- `live-feed`
- `ptz-control`

Current live-view command types:

- `get-status`
- `start-live`
- `update-live-layout`
- `stop-live`
- `sdp-offer`
- `sdp-answer`
- `ice-candidate`

Current PTZ command and response types:

- commands: `get-status`, `get-position`, `start-move`, `stop-move`, `set-zoom`, `go-home`
- responses: `ptz-status`, `ptz-position`, `ptz-command-ack`, `ptz-error`

## Where new code should go

Use these placement rules when extending the web side:

- `apps/*`
  Only for route shells, runtime config selection, env wiring, and app-only composition.
- `packages/trakrai-live-transport`
  For transport clients, provider contexts, generic runtime panels, diagnostics, and browser/device bridge primitives.
- `packages/trakrai-live-viewer`
  For live-view packet helpers, live-view hooks, and live-view UI.
- `packages/trakrai-ptz-controller`
  For PTZ packet helpers, PTZ hooks, and PTZ UI.
- `packages/trakrai-audio-manager-ui`
  For device-side audio queue actions, job inspection, and audio manager diagnostics.
- `packages/trakrai-live-ui`
  For assembling multiple feature packages into a workspace shell.
- `apps/live-gateway`
  For cloud-only browser bridge logic, MQTT subscriptions, and session routing.

## Extension rules that matter

- Keep `cloud-comm` generic. It routes packets but should not learn feature semantics.
- Keep feature packet formats close to the feature package that owns them.
- Keep environment-specific branching in app shells and runtime config, not inside shared components.
- Keep typed `requestId` and `sessionId` handling intact for any request that expects responses or long-lived signaling.
- Prefer generic `/service/<service>/...` MQTT topics for new services.
- Treat `trakrai-live-ui` as a composition shell, not as a new dumping ground for protocol logic.

## Related skill drafts

Repo-local skill drafts that build on this document live in:

- `docs/skills/add-workspace-package`
- `docs/skills/add-shared-device-communication-component`
