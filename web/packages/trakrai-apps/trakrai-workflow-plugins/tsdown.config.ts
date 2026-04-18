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

const shared = {
  format: ['esm'] as ['esm'],
  dts: false,
  sourcemap: true,
  outDir: 'dist' as const,
  treeshake: true,
  deps: createDependencyConfig([
    'react',
    'react-dom',
    '@trakrai/design-system',
    '@tanstack/react-query',
    '@xyflow/react',
    'lucide-react',
    'zod',
    'ai',
    '@monaco-editor/react',
    'monaco-editor',
    'cronstrue',
    'date-fns',
    'graphql-request',
    'html-to-image',
    'png-chunks-encode',
    'png-chunks-extract',
    'quickjs-emscripten',
    'sucrase',
    '@trakrai-workflow/core',
    '@trakrai-workflow/ui',
  ]),
  outExtensions: () => ({ js: '.js' }),
  target: false as const,
};

export default defineConfig([
  {
    ...shared,
    entry: {
      'ai/index': 'src/ai/index.ts',
      'backup-restore/index': 'src/backup-restore/index.ts',
      'code-runner/index': 'src/code-runner/index.ts',
      'cron-builder/index': 'src/cron-builder/index.ts',
      'email/index': 'src/email/index.ts',
      'layout/index': 'src/layout/index.ts',
      'runs/index': 'src/runs/index.ts',
      'triggers/index': 'src/triggers/index.ts',
    },
    clean: true,
  },
]);
