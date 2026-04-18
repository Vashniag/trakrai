import { readFileSync } from 'node:fs';

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

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  deps: createDependencyConfig([
    'react',
    'react-dom',
    '@trakrai/design-system',
    '@xyflow/react',
    'lucide-react',
    'zod',
    '@trakrai-workflow/core',
    '@trakrai-workflow/ui',
  ]),
  outExtensions: () => ({ js: '.js' }),
  outDir: 'dist',
  treeshake: true,
  clean: true,
  target: false as const,
});
