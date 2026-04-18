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

const useClientBanner = "'use client';";

const shared = {
  format: ['esm'] as ['esm'],
  dts: false,
  sourcemap: true,
  deps: createDependencyConfig([
    'react',
    'react-dom',
    '@trakrai/design-system',
    '@xyflow/react',
    '@tanstack/react-query',
    '@trpc/client',
    '@trpc/tanstack-react-query',
    '@dagrejs/dagre',
    'elkjs',
    'fast-deep-equal',
    'lucide-react',
    'superjson',
    'zod',
    '@trakrai-workflow/core',
  ]),
  outExtensions: () => ({ js: '.js' }),
  outDir: 'dist' as const,
  treeshake: true,
  target: false as const,
  outputOptions: {
    banner: useClientBanner,
  },
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
    },
    clean: true,
  },
  {
    ...shared,
    entry: {
      fluxery: 'src/fluxery.tsx',
      'ui/flow-context': 'src/ui/flow-context.tsx',
      'ui/nodes/handles-renderer': 'src/ui/nodes/handles-renderer.tsx',
      'ui/sidebar/sidebar-context': 'src/ui/sidebar/sidebar-context.tsx',
      'ui/sidebar/use-node-schema': 'src/ui/sidebar/use-node-schema.ts',
      'ui/nodes/labeled-handle': 'src/ui/nodes/labeled-handle.tsx',
      'ui/nodes/schema-node-shell': 'src/ui/nodes/schema-node-shell.tsx',
    },
    clean: false,
  },
]);
