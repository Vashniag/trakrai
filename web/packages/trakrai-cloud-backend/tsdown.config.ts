import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  dts: false,
  entry: [
    './src/router.ts',
    './src/devices.ts',
    './src/package-artifacts.ts',
    './src/db/device-schema.ts',
    './src/storage/interface.ts',
    './src/storage/azure-provider.ts',
    './src/storage/s3-compatible-provider.ts',
  ],
  format: ['esm'],
  sourcemap: true,
  target: 'es2022',
});
