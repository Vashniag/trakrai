import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { config } from '@workspace/eslint-config/react-internal';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  ...config,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    ignores: [
      'eslint.config.mjs',
      'tsdown.config.ts',
      'dist/**',
      'src/runs/inngest-graphql/graphql.ts',
    ],
  },
];
