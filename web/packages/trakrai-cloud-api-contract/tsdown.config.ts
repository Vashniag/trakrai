import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  dts: false,
  entry: ['./src/lib/package-artifacts.ts'],
  format: ['esm'],
  outDir: 'dist',
  sourcemap: true,
});
