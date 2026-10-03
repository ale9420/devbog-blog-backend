const ESM_PACKAGES = [
  'structured-field-values',
  'htmlparser2',
  'domhandler',
  'domutils',
  'dom-serializer',
  'domelementtype',
  'entities',
];

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.[jt]s'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/',
    '/.tmp/',
    '/.cache/',
    '/.strapi/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/build/'],
  setupFilesAfterEnv: ['./tests/jest.setup.ts'],
  transform: {
    '^.+\\.[cm]?[jt]sx?$': '<rootDir>/tests/helpers/esbuild-transformer.js',
  },
  // Transform node_modules only for ESM-only packages that CJS code requires
  // (Node can `require()` ESM since v22, Jest cannot): structured-field-values
  // from Fedify, and htmlparser2 and its dom* deps from sanitize-html (comments
  // plugin). Nested node_modules count: the last segment decides.
  transformIgnorePatterns: [
    `node_modules/(?!(?:[^/]+/node_modules/)*(?:${ESM_PACKAGES.join('|')})/)`,
  ],
};
