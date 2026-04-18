import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@trakrai/design-system': path.resolve(__dirname, '../../core/trakrai-design-system/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/_tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.config.{ts,js}', '**/*.d.ts', '**/types.ts'],
    },
    css: false,
  },
});
