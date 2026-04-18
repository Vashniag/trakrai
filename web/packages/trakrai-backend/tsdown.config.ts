import { readdirSync } from 'node:fs';

import { defineConfig } from 'tsdown';

const createEntries = (directory: string, extension: '.ts' | '.tsx') =>
  readdirSync(new URL(`./src/${directory}`, import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .reduce(
      (entries, entry) => {
        const fileName = entry.name.slice(0, -extension.length);
        entries[`${directory}/${fileName}`] = `src/${directory}/${entry.name}`;
        return entries;
      },
      {} as Record<string, string>,
    );

export default defineConfig({
  clean: true,
  dts: false,
  entry: {
    ...createEntries('db', '.ts'),
    'lib/request-context': 'src/lib/request-context.ts',
    'lib/storage/azure-provider': 'src/lib/storage/azure-provider.ts',
    'lib/storage/interface': 'src/lib/storage/interface.ts',
    'lib/storage/s3-compatible-provider': 'src/lib/storage/s3-compatible-provider.ts',
    'server/routers/index': 'src/server/routers/index.ts',
    'server/trpc': 'src/server/trpc.ts',
  },
  format: ['esm'],
  outDir: 'dist',
  outExtensions: () => ({ js: '.js' }),
  sourcemap: true,
});
