# @trakrai/live-ui

Import `@trakrai/design-system/globals.css` and `@trakrai/live-ui/styles.css` once from the consuming app entrypoint so Tailwind picks up the composed workspace classes consistently in both cloud and edge builds.

This package is now the thin composition shell for the live workspace. The transport/WebRTC providers live in `@trakrai/live-transport`, the viewer layer lives in `@trakrai/live-viewer`, and PTZ controls live in `@trakrai/ptz-controller`.
