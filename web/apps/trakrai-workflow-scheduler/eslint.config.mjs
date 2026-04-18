import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { config as baseConfig } from '@workspace/eslint-config/base';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    rules: {
      'no-magic-numbers': 'off',
    },
  },
  {
    ignores: ['dist/**'],
  },
  {
    ignores: ['eslint.config.mjs'],
  },
];

export default eslintConfig;
