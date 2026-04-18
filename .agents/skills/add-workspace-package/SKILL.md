---
name: add-workspace-package
description: Create or extend reusable packages inside `web/packages` for the TrakrAI web workspace. Use when adding a new shared React or TypeScript package, moving cross-app logic out of `apps/`, creating a new feature package, or matching the repo's established package.json, tsconfig, tsdown, export, style, and Next.js transpilation patterns.
---

# Add Workspace Package

Create packages that feel native to this workspace rather than generic monorepo packages.

Read `../../README.md` first. That file explains the current package layering and tells you when a new package is actually warranted.

## Decide whether a package is the right move

Create a new package only when at least one of these is true:

- the code will be used by both `apps/trakrai` and `apps/trakrai-device`
- the code is a reusable feature slice with its own hooks, packet helpers, or components
- the code is shared infrastructure that should not live in a route file
- the code has a clean boundary that matches the existing workspace layering

Do not create a package if the code is:

- route-only composition for a single app
- cloud-service logic that belongs in `web/apps`
- a tiny helper that is still local to one feature and one app

## Pick the correct package layer

Mirror the existing stack:

- `@trakrai/design-system`
  Presentational primitives and styling helpers.
- `@trakrai/live-transport`
  Transport clients, providers, runtime state, diagnostics, and generic browser-device bridge logic.
- `@trakrai/live-viewer`
  Live-view packet helpers, hooks, and feature UI.
- `@trakrai/ptz-controller`
  PTZ packet helpers, hooks, and feature UI.
- `@trakrai/live-ui`
  Composition-only workspace shell that assembles feature packages.

If the new code spans multiple features but still depends on the device communication contract, prefer a transport or feature package over stuffing it into `live-ui`.

## Build the package in the house style

Start from the closest existing package and copy its shape.

Every new package should normally include:

- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`
- `eslint.config.mjs`
- `tsdown.config.ts`
- `README.md`
- `src/`

Use these conventions:

- name packages as `@trakrai/<name>`
- keep `"type": "module"`
- use workspace dependencies for other internal packages
- keep `react` and `react-dom` as peer dependencies for browser packages
- keep `build`, `dev`, `lint`, `typecheck`, and `clean` scripts aligned with sibling packages
- use `tsdown` for ESM output and `tsc -p tsconfig.build.json` for declarations
- add `sideEffects: ["*.css"]` when the package ships styles
- export source paths in `exports`, and mirror them with built paths in `publishConfig.exports`
- add a small README that tells consuming apps which CSS file to import

## Match the current source layout

Use only the directories the package actually needs:

- `src/components`
  UI components.
- `src/hooks`
  React hooks.
- `src/lib`
  packet helpers, types, and non-React utilities.
- `src/providers`
  provider contexts for stateful transport or runtime primitives.
- `src/styles.css`
  package-scoped styles when the package renders UI.

Keep feature packet helpers beside the feature that owns them. Do not centralize every transport detail into one package by default.

## Wire the package into the apps

If a Next.js app imports the package directly, add it to `transpilePackages` in:

- `web/apps/trakrai/next.config.ts`
- `web/apps/trakrai-device/next.config.ts`

If the package ships CSS, import its stylesheet once from the consuming app or from a higher-level shared package README-prescribed entrypoint.

Do not add app-specific environment branching inside the package unless the whole purpose of the package is app-specific.

## Verification checklist

Run the narrowest checks that cover the new package:

```powershell
cd D:\trakrbi\trakrai\web
pnpm --filter <package-name> lint
pnpm --filter <package-name> typecheck
pnpm --filter <package-name> build
```

If either Next.js app consumes the package directly, also run the relevant app check:

```powershell
pnpm --filter trakrai typecheck
pnpm --filter trakrai-device typecheck
```

## Practical guardrails

- Prefer extracting a coherent slice over creating "misc" or "shared-utils" packages.
- Keep browser transport code in transport or feature packages, not inside the apps.
- Keep cloud bridge logic in `web/apps`, not in reusable browser packages.
- When in doubt, copy the nearest existing package and change only what the new package genuinely needs.
