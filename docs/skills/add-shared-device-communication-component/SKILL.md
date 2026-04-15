---
name: add-shared-device-communication-component
description: Add or extend shared React components, hooks, and helpers that work with TrakrAI device communication in both cloud and edge modes. Use when building live-view, PTZ, diagnostics, inventory, or future device-control UI that must run unchanged in `apps/trakrai` and `apps/trakrai-device`, and when deciding whether code belongs in transport, a feature package, or an app shell.
---

# Add Shared Device Communication Component

Build shared device-facing UI without hard-coding cloud or edge assumptions into the component itself.

Read `../../README.md` first. It explains the actual browser, bridge, MQTT, IPC, and device-service flow for this repo.

## Placement rules

Put the code in the narrowest package that still keeps it reusable:

- `@trakrai/live-transport`
  Generic bridge-facing code, provider extensions, diagnostics, runtime panels, transport hooks, or reusable packet primitives.
- `@trakrai/live-viewer`
  Live-view-specific packet helpers, hooks, and UI.
- `@trakrai/ptz-controller`
  PTZ-specific packet helpers, hooks, and UI.
- `@trakrai/live-ui`
  Composition-only workspace pieces that arrange multiple feature packages together.
- `apps/*`
  App-specific endpoint selection, runtime config loading, or route wiring only.
- `services/live-gateway`
  Cloud-only bridge behavior, not shared React components.

If the component should run in both cloud and edge modes without changing its behavior, it usually belongs in a package, not an app route.

## Keep environment differences at the provider boundary

The existing architecture already separates the active bridge from the shared UI:

- cloud uses `CloudTransportProvider`
- edge uses `EdgeTransportProvider`

Your shared component should consume context from hooks such as:

- `useLiveTransport`
- `useDeviceRuntime`
- `useWebRtc`
- `useLiveViewer`
- `usePtzController`

Do not make the component choose between cloud and edge by reading:

- `window.location`
- app-specific env vars
- hard-coded ports
- ad hoc URL parsing

Those choices belong in the app shell and runtime config.

## Follow the current component pattern

Prefer this structure:

1. A feature hook maps packets and runtime state into UI-friendly values.
2. A presentational component renders props and callbacks.
3. A higher-level shared workspace shell composes multiple panels.

Examples already in the repo:

- `useLiveViewer` + `LiveViewerPanel`
- `usePtzController` + `PtzControlPanel`
- `DeviceRuntimeProvider` + `DeviceServicesPanel`

If you find yourself putting WebSocket lifecycle management directly into a large visual component, stop and move that work into a hook or provider.

## Use the existing device communication contract

Shared components should respect the repo's current transport rules:

- browser packets use `kind: "packet"` frames with `service`, `subtopic`, and `envelope`
- live-view traffic uses the `live-feed` service
- PTZ traffic uses the `ptz-control` service
- request-response correlation uses `requestId`
- long-lived live signaling ownership uses `sessionId`

Common subtopics are:

- `command`
- `response`
- `status`
- `webrtc/offer`
- `webrtc/answer`
- `webrtc/ice`

Do not invent alternate packet shapes when an existing feature helper can be extended instead.

## Decide whether the component is transport-generic or feature-specific

Put it in `live-transport` when it:

- shows runtime status, heartbeat age, diagnostics, or route details
- consumes generic device status
- works for multiple services without knowing their detailed semantics

Put it in a feature package when it:

- sends or interprets feature-specific commands
- understands feature-specific packet payloads
- renders feature-specific controls such as live layout or PTZ movement

Put it in `live-ui` only when it is mostly composing existing shared components together.

## Guardrails for cloud and edge compatibility

- Depend on the shared hook and provider contract, not on a specific bridge implementation.
- Assume the same component may run against `live-gateway` or the device-hosted `cloud-comm` edge server.
- Keep the HTTP contract to `/api/ice-config` and the WebSocket packet contract unchanged unless the change is coordinated across both bridge implementations.
- Preserve `requestId` and `sessionId` when adding commands that need routed responses.
- Prefer extending the existing typed helper files before adding one-off packet builders inside a component.

## Verification checklist

Run the checks for the package you touched:

```powershell
cd D:\trakrbi\trakrai\web
pnpm --filter <package-name> lint
pnpm --filter <package-name> typecheck
pnpm --filter <package-name> build
```

If the change affects the shared workspace path, also run:

```powershell
pnpm --filter trakrai typecheck
pnpm --filter trakrai-device typecheck
```

If the change alters packet flow or provider wiring, verify both surfaces if feasible:

- cloud app through `apps/trakrai`
- device app through `apps/trakrai-device`

## Anti-patterns to avoid

- branching inside a shared component on cloud versus edge
- putting feature packet parsing directly into app route files
- teaching `live-gateway` about reusable UI concerns
- teaching the generic transport package about PTZ- or live-view-only business rules unless the contract is truly generic
- bypassing the shared hooks with ad hoc WebSocket code in a component
