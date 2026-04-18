# Audio Manager Dashboard Draft

This document captures the workflow used to draft the new `audio-manager` dashboard package and wire it into the edge and cloud device consoles.

## Goal

Create a reusable browser package for the device-side `audio-manager` service that follows the same composition pattern as the transfers manager UI:

- feature package owns typed contract usage and rendering
- `@trakrai/live-ui` stays a thin composition shell
- app routes stay minimal and only mount the shared page
- verification uses local `devtool` and browser automation rather than patching a remote device first

## Components Inspected First

Before editing, the implementation reviewed:

- `web/packages/trakrai-cloud-transfer-ui`
  The closest current example of a service dashboard package using the generated contracts and typed query/mutation helpers.
- `web/packages/trakrai-runtime-manager-ui`
  The current managed-service panel pattern and query invalidation style.
- `web/packages/trakrai-live-ui`
  The thin composition-shell layer used by both cloud and edge apps.
- `web/apps/trakrai-device/src/components/edge-console-surface.tsx`
  The edge navigation and provider mounting pattern.
- `web/packages/trakrai-live-transport/src/generated-contracts/audio_manager.ts`
  The generated method names and payload shapes.
- `device/python/audio_manager/README.md`
  Runtime responsibilities and user-facing service behavior.
- `device/manifests/tests/audio-service-local.json`
  Existing end-to-end verification path already maintained by `devtool`.

## Package Shape

The drafted package lives at:

- `web/packages/trakrai-audio-manager-ui`

It mirrors the transfers manager split:

- `src/types.ts`
  Aliases generated contract types so the UI package stays readable.
- `src/components/audio-manager-utils.ts`
  Input normalization, error extraction, timestamp formatting, and client-side filtering helpers.
- `src/components/audio-manager-status-card.tsx`
  `get-status` query + device service health summary.
- `src/components/play-audio-card.tsx`
  `play-audio` mutation + invalidation of status/job queries.
- `src/components/audio-manager-job-browser.tsx`
  `list-jobs` query with local search and state filters.
- `src/components/audio-manager-selected-job-card.tsx`
  `get-job` query for a selected record.
- `src/components/audio-manager-panel.tsx`
  The orchestration shell that coordinates selection and refresh.

## App Wiring

Thin page adapters were added in:

- `web/packages/trakrai-live-ui/src/components/device-audio-manager-page.tsx`
- `web/apps/trakrai-device/src/app/audio/page.tsx`
- `web/apps/trakrai/src/app/devices/[id]/audio/page.tsx`

Navigation was updated in both app shells so the new dashboard is reachable from:

- edge UI: `/audio`
- cloud device UI: `/devices/[id]/audio`

## Verification Workflow

Use the existing local emulator path first.

### 1. Start or refresh the local emulator

```bash
python3 -m device.devtool emulator up --profile local-emulator-all --skip-build --skip-compose-build
python3 -m device.devtool emulator status
```

### 2. Confirm the service-level audio workflow still works

```bash
python3 -m device.devtool test run --test-name audio-service-local
```

### 3. Run the edge UI locally

From `web/`:

```bash
NEXT_PUBLIC_TRAKRAI_LOCAL_DEVICE_HTTP_PORT=18080 pnpm --filter trakrai-device dev
```

### 4. Verify in a browser automation flow

Target:

- `http://127.0.0.1:3001/audio` or the port reported by Next dev

Check:

- page shell loads
- audio manager status card resolves
- recent jobs list renders
- queue form can submit a `play-audio` request
- selected job details update after submission

## Why This Pattern

- It reuses the generated device contracts instead of hand-rolling request logic.
- It keeps transport ownership in `@trakrai/live-transport`.
- It keeps apps thin and makes the feature reusable across edge and cloud surfaces.
- It matches the transfers manager package closely enough that future service dashboards can be cloned from the same structure with minimal rework.
