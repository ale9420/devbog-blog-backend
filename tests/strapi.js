'use strict';

const fs = require('fs');
const path = require('path');
const { createStrapi, compileStrapi } = require('@strapi/strapi');

// One SQLite file per Jest worker: suites run in parallel workers and each one
// deletes/recreates its database, so a shared file makes them clobber each other.
// config/database.ts resolves DATABASE_FILENAME relative to the project root, so
// the env var must stay relative or the real file lands somewhere this harness
// never cleans up (stale rows then leak between runs).
const TEST_DB_RELATIVE_PATH = path.join('.tmp', `test-${process.env.JEST_WORKER_ID || '1'}.db`);
const TEST_DB_PATH = path.join(process.cwd(), TEST_DB_RELATIVE_PATH);

function setupEnvironment() {
  process.env.NODE_ENV = 'test';
  process.env.PORT = process.env.PORT || '0';
  process.env.STRAPI_TELEMETRY_DISABLED = 'true';
  process.env.STRAPI_DISABLE_CRON = 'true';

  // Required Strapi security values (dummy values are fine for tests)
  process.env.APP_KEYS = process.env.APP_KEYS || 'testKeyOne,testKeyTwo';
  process.env.API_TOKEN_SALT = process.env.API_TOKEN_SALT || 'test-api-token-salt';
  process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'test-admin-jwt-secret';
  process.env.TRANSFER_TOKEN_SALT = process.env.TRANSFER_TOKEN_SALT || 'test-transfer-token-salt';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';

  // Use an isolated SQLite database for tests
  process.env.DATABASE_CLIENT = 'sqlite';
  process.env.DATABASE_FILENAME = TEST_DB_RELATIVE_PATH;
}

let instance;

async function setupStrapi() {
  if (instance) {
    return instance;
  }

  setupEnvironment();

  // Clean up any leftover test database file
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  const appContext = await compileStrapi();
  instance = createStrapi(appContext);
  await instance.load();
  await instance.start();

  // Reduce noise in test output
  instance.log.level = 'error';

  return instance;
}

async function cleanupStrapi() {
  if (!instance) {
    return;
  }

  await instance.server.httpServer.close();

  const dbConnection = instance.db?.connection;
  if (dbConnection?.destroy) {
    await dbConnection.destroy();
  }

  await instance.destroy();
  instance = undefined;

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
}

module.exports = { setupStrapi, cleanupStrapi };
