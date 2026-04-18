---
name: add-workspace-package
description: Create a new reusable package under `web/packages` in the TrakrAI web workspace. Use when adding a new feature UI package, copying an existing package pattern such as transfers or runtime manager, wiring exports and package metadata, and documenting the package shape before app routes consume it.
---

# Add Workspace Package

Read [`docs/README.md`](/Users/hardikj/code/web-apps/trakrbi/trakrai/docs/README.md) first. It defines the app-shell vs package layering used in this repo.

## Use this skill when

- a new device or cloud feature should live in `web/packages/*`
- an existing package like `trakrai-cloud-transfer-ui` or `trakrai-runtime-manager-ui` is the template
- the work should stay reusable across `apps/trakrai` and `apps/trakrai-device`

## Workflow

1. Inspect the nearest existing package first.
   For service dashboards, start with:
   - `web/packages/trakrai-apps/trakrai-cloud-transfer-ui`
   - `web/packages/trakrai-apps/trakrai-runtime-manager-ui`

2. Keep package responsibilities narrow.
   - Feature packages own rendering, typed service calls, local filters, and UI helpers.
   - Do not move provider setup or cloud-vs-edge branching into the package.

3. Scaffold the standard package files.
   Include:
   - `package.json`
   - `README.md`
   - `tsconfig.json`
   - `tsconfig.build.json`
   - `tsdown.config.ts`
   - `eslint.config.mjs`

4. Prefer generated contract types.
   For device-backed features, alias types from:
   - `web/packages/core/trakrai-live-transport/src/generated-contracts/*`

5. Follow the common feature split.
   Use:
   - `src/types.ts`
   - `src/components/<feature>-utils.ts`
   - focused cards or panels for status, actions, lists, and detail
   - one top-level `<feature>-panel.tsx` orchestrator

6. Keep `react` and `react-dom` as peer dependencies for browser packages.

7. Update consuming package dependencies explicitly.
   Commonly:
   - `web/packages/trakrai-live-ui/package.json`

8. Update Tailwind source scanning in consuming apps when the new package contains classes.
   Check:
   - `web/apps/trakrai/src/app/globals.css`
   - `web/apps/trakrai-device/src/app/globals.css`

## Guardrails

- Do not put app route code in the package.
- Do not put transport providers in the package.
- Do not bypass generated service contracts with ad hoc request code.
- Keep the public surface small: export components and shared types only when needed.

## Verification

Run at minimum from `web/`:

```bash
pnpm --filter <new-package-name> lint
pnpm --filter <new-package-name> typecheck
pnpm --filter @trakrai/live-ui typecheck
```
