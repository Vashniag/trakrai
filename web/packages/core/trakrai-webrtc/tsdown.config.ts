import { existsSync, readdirSync } from 'fs';
import { defineConfig } from 'tsdown';

const createEntries = (directory: string, extension: '.ts' | '.tsx') => {
  const directoryUrl = new URL(`src/${directory}`, import.meta.url);
  if (!existsSync(directoryUrl)) {
    return {} as Record<string, string>;
  }

  return readdirSync(directoryUrl)
    .filter((fileName) => fileName.endsWith(extension))
    .reduce(
      (entries, fileName) => {
        const name = fileName.replace(extension, '');
        entries[`${directory}/${name}`] = `src/${directory}/${fileName}`;
        return entries;
      },
      {} as Record<string, string>,
    );
};

export default defineConfig({
  entry: {
    ...createEntries('hooks', '.ts'),
    ...createEntries('lib', '.ts'),
    ...createEntries('providers', '.tsx'),
  },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  deps: {
    alwaysBundle: [],
    neverBundle: ['@trakrai/live-transport{,/**}', 'react{,/**}', 'react-dom{,/**}'],
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
