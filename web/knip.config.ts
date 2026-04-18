import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignoreDependencies: ['eslint-*'],
  drizzle: false,
  workspaces: {
    'apps/trakrai-device': {
      project: ['src/**/*.{ts,tsx}'],
      ignoreDependencies: ['@tailwindcss/postcss'],
    },
    'apps/trakrai': {
      project: ['src/**/*.{ts,tsx}'],
      ignoreDependencies: ['@tailwindcss/postcss'],
    },
    'apps/live-gateway': {
      entry: ['test/**/*.test.ts'],
      project: ['src/**/*.{ts,tsx}', 'test/**/*.ts'],
    },
    'packages/trakrai-backend': {
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/trakrai-cloud-transfer-ui': {
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/trakrai-design-system': {
      project: ['src/**/*.{ts,tsx}'],
      ignoreDependencies: ['postcss-load-config', '@tailwindcss/postcss', 'next-themes'],
    },
    'packages/trakrai-live-transport': {
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/trakrai-live-viewer': {
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/trakrai-ptz-controller': {
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/trakrai-roi-configurator': {
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/trakrai-runtime-manager-ui': {
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/trakrai-webrtc': {
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/eslint-config': {
      entry: ['*.js'],
      project: ['**/*.js'],
    },
    'packages/typescript-config': {
      entry: ['*.json'],
      ignoreDependencies: ['next'],
    },
  },
};

export default config;
