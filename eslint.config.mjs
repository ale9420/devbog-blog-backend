import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'build/',
      'node_modules/',
      '.tmp/',
      '.cache/',
      '.strapi/',
      'public/uploads/',
    'coverage/',
    'database/',
    'data/',
    'types/generated/',
  ],
  },
  tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['**/*.ts', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        strapi: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  }
);
