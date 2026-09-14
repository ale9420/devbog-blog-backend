/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/',
    '/.tmp/',
    '/.cache/',
    '/.strapi/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/build/'],
  setupFilesAfterEnv: ['./tests/jest.setup.js'],
  transform: {
    '^.+\\.[cm]?[jt]sx?$': '<rootDir>/tests/helpers/esbuild-transformer.js',
  },
  // Transform node_modules only for ESM-only packages required by the
  // Fedify dependency tree (Node can `require()` ESM since v22, Jest cannot).
  transformIgnorePatterns: ['node_modules/(?!structured-field-values/)'],
};
