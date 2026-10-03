import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';

describe('CORS (CORS_ORIGINS)', () => {
  beforeAll(async () => {
    // Read when Strapi loads its config, so it must be set before booting.
    process.env.CORS_ORIGINS = 'https://bogdev.com.co,http://localhost:3000';
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
    delete process.env.CORS_ORIGINS;
  });

  it.each(['https://bogdev.com.co', 'http://localhost:3000'])('allows %s', async (origin) => {
    const res = await request(strapi.server.httpServer)
      .options('/api/articles')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('does not allow other origins', async () => {
    const res = await request(strapi.server.httpServer)
      .options('/api/articles')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
