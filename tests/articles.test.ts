import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setPublicPermissions } from './helpers/permissions';

describe('Articles API', () => {
  let article: { documentId: string } | undefined;

  beforeAll(async () => {
    await setupStrapi();
    await setPublicPermissions('article', ['find', 'findOne']);

    const draft = await strapi.documents('api::article.article').create({
      data: {
        title: 'Test article',
        description: 'A short description',
      },
    });

    article = await strapi
      .documents('api::article.article')
      .publish({ documentId: draft.documentId });
  });

  afterAll(async () => {
    if (article?.documentId) {
      await strapi.documents('api::article.article').delete({ documentId: article.documentId });
    }
    await cleanupStrapi();
  });

  it('GET /api/articles returns a list of published articles', async () => {
    const res = await request(strapi.server.httpServer)
      .get('/api/articles')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const ids = (res.body.data as { documentId: string }[]).map((entry) => entry.documentId);
    expect(ids).toContain(article?.documentId);
  });

  it('GET /api/articles/:id returns a single article', async () => {
    const res = await request(strapi.server.httpServer)
      .get(`/api/articles/${article?.documentId}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(res.body.data.documentId).toBe(article?.documentId);
    expect(res.body.data.title).toBe('Test article');
  });
});
