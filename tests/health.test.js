'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');

describe('Health check', () => {
  beforeAll(async () => {
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('GET /_health returns 204', async () => {
    await request(strapi.server.httpServer).get('/_health').expect(204);
  });
});
