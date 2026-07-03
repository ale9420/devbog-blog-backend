'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { setPublicPermissions } = require('./helpers/permissions');

describe('Articles API', () => {
  let article;

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
    expect(res.body.data.some((entry) => entry.documentId === article.documentId)).toBe(true);
  });

  it('GET /api/articles/:id returns a single article', async () => {
    const res = await request(strapi.server.httpServer)
      .get(`/api/articles/${article.documentId}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(res.body.data.documentId).toBe(article.documentId);
    expect(res.body.data.title).toBe('Test article');
  });
});
