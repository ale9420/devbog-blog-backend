'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { createStrapi, compileStrapi } = require('@strapi/strapi');

// One SQLite file per Jest worker: suites run in parallel workers and each one
// deletes/recreates its database, so a shared file makes them clobber each other.
// config/database.ts resolves DATABASE_FILENAME relative to the project root, so
// the env var must stay relative or the real file lands somewhere this harness
// never cleans up (stale rows then leak between runs).
const TEST_DB_RELATIVE_PATH = path.join('.tmp', `test-${process.env.JEST_WORKER_ID || '1'}.db`);
const TEST_DB_PATH = path.join(process.cwd(), TEST_DB_RELATIVE_PATH);

// Set TEST_DATABASE_URL (e.g. postgres://user:pass@127.0.0.1:5432/postgres) to run
// the suites against PostgreSQL, which is what production uses, instead of SQLite.
// Each Jest worker gets its own database (strapi_test_<worker>) inside that server.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function postgresTarget() {
  const url = new URL(TEST_DATABASE_URL);
  const database = `strapi_test_${process.env.JEST_WORKER_ID || '1'}`;
  return {
    admin: TEST_DATABASE_URL,
    database,
    host: url.hostname,
    port: url.port || '5432',
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    url: `${url.protocol}//${url.username}:${url.password}@${url.host}/${database}`,
  };
}

/** Recreates this worker's database so every run starts from an empty schema. */
async function resetPostgresDatabase() {
  const target = postgresTarget();
  const admin = new Client({ connectionString: target.admin });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${target.database}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${target.database}"`);
  } finally {
    await admin.end();
  }
}

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

  if (TEST_DATABASE_URL) {
    const target = postgresTarget();
    process.env.DATABASE_CLIENT = 'postgres';
    process.env.DATABASE_URL = target.url;
    process.env.DATABASE_HOST = target.host;
    process.env.DATABASE_PORT = target.port;
    process.env.DATABASE_NAME = target.database;
    process.env.DATABASE_USERNAME = target.username;
    process.env.DATABASE_PASSWORD = target.password;
    process.env.DATABASE_SSL = 'false';
    return;
  }

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

  // Start from an empty database
  if (TEST_DATABASE_URL) {
    await resetPostgresDatabase();
  } else if (fs.existsSync(TEST_DB_PATH)) {
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

  if (!TEST_DATABASE_URL && fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
}

module.exports = { setupStrapi, cleanupStrapi };
