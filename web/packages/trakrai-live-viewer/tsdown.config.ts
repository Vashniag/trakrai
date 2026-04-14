import { readFileSync, readdirSync } from 'fs';
import { defineConfig } from 'tsdown';

type PackageJsonDependencies = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const packagePattern = (name: string) => `${name}{,/**}`;

const createDependencyConfig = (neverBundle: readonly string[] = []) => {
  const packageJson = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
  ) as PackageJsonDependencies;
  const declaredDependencies = new Set<string>([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ]);

  for (const dependency of neverBundle) {
    declaredDependencies.delete(dependency);
  }

  return {
    alwaysBundle: [...declaredDependencies].sort().map(packagePattern),
    neverBundle: neverBundle.map(packagePattern),
    onlyBundle: false as const,
  };
};

const useClientBanner = "'use client';";

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
    ...createEntries('components', '.tsx'),
    ...createEntries('hooks', '.ts'),
    ...createEntries('lib', '.ts'),
  },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  deps: createDependencyConfig(['react', 'react-dom']),
  outExtensions: () => ({ js: '.js' }),
  outDir: 'dist',
  treeshake: true,
  clean: true,
  target: false as const,
  outputOptions: {
    banner: useClientBanner,
  },
});
