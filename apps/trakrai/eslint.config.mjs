import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { nextJsConfig } from '@workspace/eslint-config/next-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [
  ...nextJsConfig,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'postcss.config.mjs'],
  },
];

export default eslintConfig;
