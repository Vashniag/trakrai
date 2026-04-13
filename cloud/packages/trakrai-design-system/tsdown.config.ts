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

const components = readdirSync(new URL('src/components', import.meta.url))
  .filter((f) => f.endsWith('.tsx'))
  .reduce(
    (acc, f) => {
      const name = f.replace('.tsx', '');
      acc[`components/${name}`] = `src/components/${f}`;
      return acc;
    },
    {} as Record<string, string>,
  );

const libs = readdirSync(new URL('src/lib', import.meta.url))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .reduce(
    (acc, f) => {
      const name = f.replace('.ts', '');
      acc[`lib/${name}`] = `src/lib/${f}`;
      return acc;
    },
    {} as Record<string, string>,
  );

const hooks = readdirSync(new URL('src/hooks', import.meta.url))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .reduce(
    (acc, f) => {
      const name = f.replace('.ts', '');
      acc[`hooks/${name}`] = `src/hooks/${f}`;
      return acc;
    },
    {} as Record<string, string>,
  );

export default defineConfig({
  entry: {
    ...components,
    ...libs,
    ...hooks,
  },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  deps: createDependencyConfig([
    '@dnd-kit/core',
    '@dnd-kit/modifiers',
    '@dnd-kit/sortable',
    '@dnd-kit/utilities',
    'react',
    'react-dom',
    'react-hook-form',
    'next-themes',
    '@tanstack/react-table',
    'class-variance-authority',
    'clsx',
    'cmdk',
    'date-fns',
    'embla-carousel-react',
    'input-otp',
    'lucide-react',
    'motion',
    'nuqs',
    'nuqs/server',
    'radix-ui',
    '@radix-ui/react-label',
    '@radix-ui/react-slot',
    'react-day-picker',
    'recharts',
    'sonner',
    'tailwind-merge',
    'vaul',
    'zod',
  ]),
  outExtensions: () => ({ js: '.js' }),
  outDir: 'dist',
  treeshake: true,
  clean: true,
  target: false as const,
  outputOptions: {
    banner: useClientBanner,
  },
});
