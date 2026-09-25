'use strict';

// Enable the fediverse plugin before Strapi boots (config/plugins.ts reads it).
process.env.FEDIVERSE_ENABLED = 'true';
process.env.FEDIVERSE_ACTOR_IDENTIFIER = process.env.FEDIVERSE_ACTOR_IDENTIFIER || 'devbog';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');

const ARTICLE_UID = 'api::article.article';
const COMMENT_UID = 'plugin::comments.comment';
const FOLLOWER_UID = 'plugin::fediverse.follower';

const BLOCKED_ACTOR = 'https://spam.example/users/troll';

describe('Fediverse batch stats and ranking', () => {
  const articles = {};
  let actorCounter = 0;

  const get = (path, query) => request(strapi.server.httpServer).get(path).query(query);

  /** A published article whose published rows get a fixed `publishedAt`, so ties sort predictably. */
  async function publishedArticle(name, publishedAt, { english = false } = {}) {
    const draft = await strapi.documents(ARTICLE_UID).create({
      data: { title: `Stats ${name}`, slug: `stats-${name}`, description: 'Excerpt.' },
    });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });
    if (english) {
      await strapi.documents(ARTICLE_UID).update({
        documentId: draft.documentId,
        locale: 'en',
        data: { title: `Stats ${name} (en)`, description: 'Excerpt.' },
      });
      await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId, locale: 'en' });
    }
    await strapi.db.query(ARTICLE_UID).updateMany({
      where: { documentId: draft.documentId, publishedAt: { $notNull: true } },
      data: { publishedAt },
    });
    return draft.documentId;
  }

  async function interact(documentId, type, actorId) {
    actorCounter += 1;
    await strapi
      .plugin('fediverse')
      .service('interactions')
      .recordInteraction(strapi, {
        type,
        actorId: actorId ?? `https://remote.example/users/fan${actorCounter}`,
        articleDocumentId: documentId,
      });
  }

  async function comment(
    documentId,
    { approvalStatus = 'APPROVED', fediverse = true, ...extra } = {}
  ) {
    actorCounter += 1;
    const actorId = `https://remote.example/users/replier${actorCounter}`;
    await strapi.documents(COMMENT_UID).create({
      data: {
        content: 'A reply',
        related: `${ARTICLE_UID}:${documentId}`,
        approvalStatus,
        authorId: actorId,
        authorName: 'Replier',
        ...(fediverse
          ? {
              fediverseActorHandle: `@replier${actorCounter}@remote.example`,
              fediverseUri: `${actorId}/notes/1`,
            }
          : {}),
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    await setupStrapi();
    const locales = strapi.plugin('i18n').service('locales');
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' });
    }

    // Default locale ('en' in tests). Totals: a = 4, b = 2, c = 2 (newer than b), d = 0 (newest).
    articles.a = await publishedArticle('a', '2026-01-01T00:00:00.000Z');
    articles.b = await publishedArticle('b', '2026-02-01T00:00:00.000Z');
    articles.c = await publishedArticle('c', '2026-03-01T00:00:00.000Z');
    articles.d = await publishedArticle('d', '2026-04-01T00:00:00.000Z');

    await interact(articles.a, 'like');
    await interact(articles.a, 'like');
    await interact(articles.a, 'boost');
    await comment(articles.a);

    await interact(articles.b, 'like');
    await comment(articles.b);
    await comment(articles.b, { approvalStatus: 'PENDING' });
    await comment(articles.b, { approvalStatus: 'REJECTED' });
    await comment(articles.b, { fediverse: false });
    await comment(articles.b, { removed: true });

    await interact(articles.c, 'boost');
    await interact(articles.c, 'boost');

    // Blocked actors count for nothing, likes or replies.
    await strapi.db.query(FOLLOWER_UID).create({ data: { actorId: BLOCKED_ACTOR, blocked: true } });
    await interact(articles.d, 'like', BLOCKED_ACTOR);
    await comment(articles.d, { authorId: BLOCKED_ACTOR });

    // Never listed: a draft with interactions.
    const draft = await strapi
      .documents(ARTICLE_UID)
      .create({ data: { title: 'Stats draft', slug: 'stats-draft', description: 'Excerpt.' } });
    articles.draft = draft.documentId;
    await interact(articles.draft, 'like');
    await interact(articles.draft, 'boost');

    // Spanish: only `e` is published in it.
    const es = await strapi.documents(ARTICLE_UID).create({
      locale: 'es',
      data: { title: 'Stats e', slug: 'stats-e', description: 'Resumen.' },
    });
    await strapi.documents(ARTICLE_UID).publish({ documentId: es.documentId, locale: 'es' });
    articles.e = es.documentId;
    await interact(articles.e, 'like');
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  describe('GET /api/fediverse/articles/stats', () => {
    it('returns likes, boosts and approved fediverse replies for each published article', async () => {
      const res = await get('/api/fediverse/articles/stats', {
        documentIds: [articles.a, articles.b, articles.c, articles.d].join(','),
      }).expect(200);

      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.body).toEqual({
        [articles.a]: { likes: 2, boosts: 1, replies: 1 },
        [articles.b]: { likes: 1, boosts: 0, replies: 1 },
        [articles.c]: { likes: 0, boosts: 2, replies: 0 },
        [articles.d]: { likes: 0, boosts: 0, replies: 0 },
      });
    });

    it('leaves out unpublished and unknown articles', async () => {
      const res = await get('/api/fediverse/articles/stats', {
        documentIds: `${articles.a},${articles.draft},does-not-exist`,
      }).expect(200);
      expect(Object.keys(res.body)).toEqual([articles.a]);
    });

    it('rejects a missing list or more than 50 ids', async () => {
      await get('/api/fediverse/articles/stats').expect(400);
      const ids = Array.from({ length: 51 }, (_, index) => `id-${index}`).join(',');
      await get('/api/fediverse/articles/stats', { documentIds: ids }).expect(400);
    });

    it('keeps the per-article route working', async () => {
      const res = await get(`/api/fediverse/articles/${articles.a}/stats`).expect(200);
      expect(res.body).toEqual({ likes: 2, boosts: 1 });
    });
  });

  describe('GET /api/fediverse/articles/ranking', () => {
    it('orders by likes + boosts + replies, newest first on ties, zeros last', async () => {
      const res = await get('/api/fediverse/articles/ranking', { pageSize: 10 }).expect(200);

      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.body.data).toEqual([
        { documentId: articles.a, likes: 2, boosts: 1, replies: 1 },
        { documentId: articles.c, likes: 0, boosts: 2, replies: 0 },
        { documentId: articles.b, likes: 1, boosts: 0, replies: 1 },
        { documentId: articles.d, likes: 0, boosts: 0, replies: 0 },
      ]);
      expect(res.body.meta.pagination).toEqual({ page: 1, pageSize: 10, pageCount: 1, total: 4 });
    });

    it('paginates over the whole blog', async () => {
      const first = await get('/api/fediverse/articles/ranking', { page: 1, pageSize: 3 }).expect(
        200
      );
      const second = await get('/api/fediverse/articles/ranking', { page: 2, pageSize: 3 }).expect(
        200
      );

      expect(first.body.data.map((row) => row.documentId)).toEqual([
        articles.a,
        articles.c,
        articles.b,
      ]);
      expect(second.body.data.map((row) => row.documentId)).toEqual([articles.d]);
      expect(second.body.meta.pagination).toEqual({ page: 2, pageSize: 3, pageCount: 2, total: 4 });
    });

    it('defaults to six per page', async () => {
      const res = await get('/api/fediverse/articles/ranking').expect(200);
      expect(res.body.meta.pagination.pageSize).toBe(6);
    });

    it('lists the articles published in the requested locale', async () => {
      const res = await get('/api/fediverse/articles/ranking', { locale: 'es' }).expect(200);
      expect(res.body.data).toEqual([{ documentId: articles.e, likes: 1, boosts: 0, replies: 0 }]);
      expect(res.body.meta.pagination.total).toBe(1);
    });
  });
});
