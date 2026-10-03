import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';

// A route without permission must answer 403. When two @strapi/utils versions
// are installed, the errors middleware does not recognise the ForbiddenError
// thrown by the other copy and answers 500 instead.
describe('Routes without permission', () => {
  beforeAll(async () => {
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it.each(['/api/users', '/api/subscribers'])('anonymous GET %s → 403', async (path) => {
    const res = await request(strapi.server.httpServer).get(path);
    expect(res.status).toBe(403);
    expect(res.body.error.name).toBe('ForbiddenError');
  });
});
