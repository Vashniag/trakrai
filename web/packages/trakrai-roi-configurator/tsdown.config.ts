import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  dts: false,
  deps: {
    alwaysBundle: [],
    neverBundle: ['react{,/**}', 'react-dom{,/**}'],
    onlyBundle: false,
  },
  entry: ['src/**/*.ts', 'src/**/*.tsx'],
  format: ['esm'],
  sourcemap: true,
  target: 'es2022',
});
