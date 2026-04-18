---
name: add-shared-device-communication-component
description: Add a new shared device-facing dashboard or communication surface that reuses the existing TrakrAI transport stack. Use when wiring generated service contracts through `useTypedDeviceService`, exposing the feature in both cloud and edge routes, and verifying it locally with `devtool` plus browser automation.
---

# Add Shared Device Communication Component

Read [`docs/README.md`](/Users/hardikj/code/web-apps/trakrbi/trakrai/docs/README.md) first. It explains the transport and layering rules this workflow relies on.

## Use this skill when

- a feature talks to a device service over the shared browser transport
- the UI should work in both cloud and edge modes
- the service already has generated contracts under `trakrai-live-transport`
- local verification should happen against the emulator before pushing to a device

## Workflow

1. Find the generated contract and service docs first.
   Start with:
   - `web/packages/core/trakrai-live-transport/src/generated-contracts/<service>.ts`
   - the corresponding `device/` README, manifest, or local test definition

2. Mirror an existing feature package.
   For service dashboards, `trakrai-cloud-transfer-ui` is the default model.

3. Use only the shared transport helpers.
   Prefer:
   - `useTypedDeviceService`
   - `useDeviceServiceQuery`
   - `useDeviceServiceMutation`
   - `useLiveTransport`

4. Keep composition thin.
   - add a small adapter in `@trakrai/live-ui`
   - add minimal route pages in `apps/trakrai` and `apps/trakrai-device`
   - update navigation in the route shells

5. Invalidate related queries after mutations.
   Usual pattern:
   - invalidate service status
   - invalidate list queries
   - invalidate the selected detail query for the returned entity ID

6. Verify the local service behavior with `devtool` first.
   Typical commands:

```bash
python3 -m device.devtool emulator up --profile local-emulator-all --skip-build --skip-compose-build
python3 -m device.devtool test run --test-name <service-test-name>
```

7. Verify the browser flow locally.
   - run the edge dev server from `web/`
   - use `agent-browser` if available; otherwise fall back to the built-in browser automation tools
   - confirm the page loads, service status resolves, and the primary mutation path works

## Guardrails

- Do not add feature semantics to `cloud-comm`.
- Do not write direct fetch logic for device commands when a generated contract exists.
- Do not put route-specific environment logic into reusable components.

## Deliverables

- feature package under `web/packages`
- thin adapter in `web/packages/trakrai-live-ui`
- route wiring in edge and optional cloud app shells
- one short workflow doc capturing commands and verification notes
