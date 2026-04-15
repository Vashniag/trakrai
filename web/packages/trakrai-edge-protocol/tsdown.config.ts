import { readdirSync } from 'fs';
import { defineConfig } from 'tsdown';

const createEntries = (directory: string, extension: '.ts' | '.tsx') =>
  readdirSync(new URL(`src/${directory}`, import.meta.url))
    .filter((fileName) => fileName.endsWith(extension))
    .reduce(
      (entries, fileName) => {
        const name = fileName.replace(extension, '');
        entries[`${directory}/${name}`] = `src/${directory}/${fileName}`;
        return entries;
      },
      {} as Record<string, string>,
    );

export default defineConfig({
  entry: {
    ...createEntries('providers', '.tsx'),
  },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  deps: {
    alwaysBundle: [],
    neverBundle: [
      '@trakrai/live-transport{,/**}',
      '@trakrai/webrtc{,/**}',
      'react{,/**}',
      'react-dom{,/**}',
    ],
    onlyBundle: false,
  },
  outExtensions: () => ({ js: '.js' }),
  outDir: 'dist',
  treeshake: true,
  clean: true,
  target: false as const,
  outputOptions: {
    banner: "'use client';",
  },
});
