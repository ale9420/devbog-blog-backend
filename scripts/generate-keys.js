'use strict';

const crypto = require('crypto');

const generateKey = (bytes = 32) => {
  return crypto.randomBytes(bytes).toString('base64');
};

const keys = {
  APP_KEYS: `"${generateKey()},${generateKey()}"`,
  API_TOKEN_SALT: generateKey(),
  ADMIN_JWT_SECRET: generateKey(),
  TRANSFER_TOKEN_SALT: generateKey(),
  JWT_SECRET: generateKey(),
  ENCRYPTION_KEY: generateKey(),
};

const maxLength = Math.max(...Object.keys(keys).map((k) => k.length));

for (const [key, value] of Object.entries(keys)) {
  console.log(`${key.padEnd(maxLength)} = ${value}`);
}
