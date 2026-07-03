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
};
