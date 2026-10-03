import { describe, it, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';

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
