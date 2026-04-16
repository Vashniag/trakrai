import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  shared: {
    // Local source: shell env when running `pnpm --filter trakrai-device dev/build`.
    // Deployment source: the build environment used to export the edge UI bundle.
    NODE_ENV: z.enum(['development', 'test', 'production']),
  },
  client: {
    // Cloud app base URL used by the edge runtime page to query package catalogs over TRPC.
    // Local source: point this at the cloud dev server, usually `http://localhost:3000`.
    // Deployed source: set this to the deployed cloud app origin.
    NEXT_PUBLIC_TRAKRAI_CLOUD_API_URL: z.string().optional(),

    // Optional cloud bridge WebSocket URL when forcing the edge UI into cloud transport mode.
    // Get this from the deployed live-gateway WebSocket endpoint.
    NEXT_PUBLIC_TRAKRAI_CLOUD_BRIDGE_URL: z.string().optional(),

    // Default device ID used before runtime config is fetched.
    // Local source: set to the local emulator device id when needed.
    NEXT_PUBLIC_TRAKRAI_DEVICE_ID: z.string().optional(),

    // Chooses whether the edge UI should start in `cloud` or `edge` transport mode
    // before runtime config is loaded.
    NEXT_PUBLIC_TRAKRAI_DEVICE_TRANSPORT_MODE: z.enum(['cloud', 'edge']).optional(),

    // Optional explicit edge bridge URL override.
    // Usually omit this on deployed devices and let `/api/runtime-config` supply it.
    NEXT_PUBLIC_TRAKRAI_EDGE_BRIDGE_URL: z.string().optional(),

    // Enables extra UI diagnostics panels/logging.
    // Local source: shell env for dev builds; deployed source: only enable when debugging.
    NEXT_PUBLIC_TRAKRAI_ENABLE_DIAGNOSTICS: z.enum(['true', 'false']).optional(),

    // Local Docker-emulated device HTTP port.
    // Get this from `device/scripts/local_device_runtime.py` output or `device/.localdev/compose.env`.
    NEXT_PUBLIC_TRAKRAI_LOCAL_DEVICE_HTTP_PORT: z.string().optional(),

    // Optional explicit runtime-config endpoint override for local/dev setups.
    // Usually omit this and let the app derive `/api/runtime-config`.
    NEXT_PUBLIC_TRAKRAI_RUNTIME_CONFIG_URL: z.string().optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env['NODE_ENV'],
    NEXT_PUBLIC_TRAKRAI_CLOUD_API_URL: process.env['NEXT_PUBLIC_TRAKRAI_CLOUD_API_URL'],
    NEXT_PUBLIC_TRAKRAI_CLOUD_BRIDGE_URL: process.env['NEXT_PUBLIC_TRAKRAI_CLOUD_BRIDGE_URL'],
    NEXT_PUBLIC_TRAKRAI_DEVICE_ID: process.env['NEXT_PUBLIC_TRAKRAI_DEVICE_ID'],
    NEXT_PUBLIC_TRAKRAI_DEVICE_TRANSPORT_MODE:
      process.env['NEXT_PUBLIC_TRAKRAI_DEVICE_TRANSPORT_MODE'],
    NEXT_PUBLIC_TRAKRAI_EDGE_BRIDGE_URL: process.env['NEXT_PUBLIC_TRAKRAI_EDGE_BRIDGE_URL'],
    NEXT_PUBLIC_TRAKRAI_ENABLE_DIAGNOSTICS: process.env['NEXT_PUBLIC_TRAKRAI_ENABLE_DIAGNOSTICS'],
    NEXT_PUBLIC_TRAKRAI_LOCAL_DEVICE_HTTP_PORT:
      process.env['NEXT_PUBLIC_TRAKRAI_LOCAL_DEVICE_HTTP_PORT'],
    NEXT_PUBLIC_TRAKRAI_RUNTIME_CONFIG_URL: process.env['NEXT_PUBLIC_TRAKRAI_RUNTIME_CONFIG_URL'],
  },
  skipValidation:
    // Escape hatch for partial local builds.
    // Prefer setting the needed public env explicitly instead of relying on this.
    process.env['SKIP_ENV_VALIDATION'] !== undefined &&
    process.env['SKIP_ENV_VALIDATION'] === 'true',
  emptyStringAsUndefined: true,
});
