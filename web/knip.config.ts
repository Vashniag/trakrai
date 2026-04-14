import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignoreDependencies: ['eslint-*'],
  drizzle: false,
  workspaces: {
    'apps/trakrai-device': {
      entry: ['src/app/page.tsx'],
      project: ['src/**/*.{ts,tsx}'],
      ignoreDependencies: ['@tailwindcss/postcss'],
    },
    'apps/trakrai': {
      entry: ['src/db/schema.ts', 'src/scripts/**/*.ts'],
      project: ['src/**/*.{ts,tsx}'],
      ignoreDependencies: ['@tailwindcss/postcss'],
    },
    'packages/trakrai-design-system': {
      project: ['src/**/*.{ts,tsx}'],
      ignoreDependencies: [
        'postcss-load-config',
        '@tailwindcss/postcss',
        'next-themes',
        'react-hook-form',
      ],
    },
    'packages/trakrai-live-ui': {
      project: ['src/**/*.{ts,tsx}'],
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
    'packages/eslint-config': {
      entry: ['*.js'],
      project: ['**/*.js'],
    },
    'packages/typescript-config': {
      entry: ['*.json'],
      project: ['**/*.json'],
      ignoreDependencies: ['next'],
    },
  },
};

export default config;
