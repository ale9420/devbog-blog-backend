'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { startFakeUmami } = require('./helpers/fake-umami');

const ARTICLE_UID = 'api::article.article';
const STAT_UID = 'api::article-stat.article-stat';

describe('Article stats (Umami)', () => {
  let umami;
  const ids = {};

  const get = (query) =>
    request(strapi.server.httpServer).get('/api/articles/popular').query(query);
  const sync = () => strapi.service(STAT_UID).sync();
  const statRows = () =>
    strapi.db.query(STAT_UID).findMany({ orderBy: [{ articleLocale: 'asc' }, { views: 'desc' }] });

  async function article(slug, { locale = 'en', publish = true, documentId } = {}) {
    const data = { title: `Stats ${slug}`, slug, description: 'Summary.' };
    const entry = documentId
      ? await strapi.documents(ARTICLE_UID).update({ documentId, locale, data })
      : await strapi.documents(ARTICLE_UID).create({ locale, data });
    if (publish) {
      await strapi.documents(ARTICLE_UID).publish({ documentId: entry.documentId, locale });
    }
    return entry.documentId;
  }

  beforeAll(async () => {
    umami = await startFakeUmami();
    process.env.UMAMI_URL = umami.url;
    process.env.UMAMI_WEBSITE_ID = 'site-1';
    process.env.UMAMI_API_KEY = 'umami_test';
    process.env.UMAMI_PUBLIC_URL = 'https://analytics.example.test';
    await setupStrapi();

    const locales = strapi.plugin('i18n').service('locales');
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' });
    }

    ids.linux = await article('linux-hardening');
    await article('endurecer-linux', { locale: 'es', documentId: ids.linux });
    ids.vue = await article('vue-basics');
    ids.rust = await article('rust-intro');
    ids.draft = await article('draft-only', { publish: false });
  });

  afterAll(async () => {
    await cleanupStrapi();
    await umami.close();
    delete process.env.UMAMI_URL;
    delete process.env.UMAMI_WEBSITE_ID;
    delete process.env.UMAMI_API_KEY;
    delete process.env.UMAMI_PUBLIC_URL;
  });

  beforeEach(() => {
    umami.state.status = 200;
    umami.state.requests.length = 0;
  });

  it('writes the visitors of every published translation, adding up path variants', async () => {
    umami.state.allTime = [
      ['/blog/linux-hardening', 40],
      ['/blog/linux-hardening/', 2],
      ['/es/blog/endurecer-linux', 15],
      ['/blog/vue-basics', 25],
      ['/blog/draft-only', 9],
      ['/blog/unknown-article', 7],
      ['/', 100],
      ['/es/blog', 30],
    ];
    umami.state.recent = [
      ['/blog/vue-basics', 12],
      ['/blog/linux-hardening', 5],
    ];

    const report = await sync();

    expect(report).toEqual({ articles: 4, matchedPaths: 4, otherPaths: 4 });
    const rows = await statRows();
    expect(
      rows.map((row) => [row.articleDocumentId, row.articleLocale, row.views, row.views30d])
    ).toEqual([
      [ids.linux, 'en', 42, 5],
      [ids.vue, 'en', 25, 12],
      [ids.rust, 'en', 0, 0],
      [ids.linux, 'es', 15, 0],
    ]);
    expect(rows.every((row) => row.syncedAt)).toBe(true);
  });

  it('authenticates with the API key and asks for paths of the configured website', async () => {
    await sync();
    expect(umami.state.requests).toHaveLength(2);
    for (const req of umami.state.requests) {
      expect(req.path).toBe('/api/websites/site-1/metrics');
      expect(req.query).toMatchObject({ type: 'path', limit: '500', offset: '0' });
      expect(req.headers.authorization).toBe('Bearer umami_test');
    }
    const starts = umami.state.requests
      .map((req) => Number(req.query.startAt))
      .sort((a, b) => a - b);
    expect(starts[0]).toBe(0);
    const days = (Number(umami.state.requests[0].query.endAt) - starts[1]) / 86_400_000;
    expect(days).toBe(30);
  });

  it('follows Umami pagination', async () => {
    const saved = umami.state.allTime;
    const filler = Array.from({ length: 500 }, (_, i) => [`/other-${i}`, 1]);
    umami.state.allTime = [...filler, ['/blog/rust-intro', 3]];

    await sync();

    const offsets = umami.state.requests
      .filter((req) => req.query.startAt === '0')
      .map((req) => req.query.offset);
    expect(offsets).toEqual(['0', '500']);
    const rust = await strapi.db
      .query(STAT_UID)
      .findOne({ where: { articleDocumentId: ids.rust, articleLocale: 'en' } });
    expect(rust.views).toBe(3);

    umami.state.allTime = saved;
    await sync();
  });

  it('keeps the previous counts when Umami fails', async () => {
    const before = await statRows();
    umami.state.status = 401;

    await expect(sync()).rejects.toThrow('Umami answered 401');
    expect(await statRows()).toEqual(before);
  });

  it('removes duplicated rows and rows of unpublished articles', async () => {
    await strapi.db
      .query(STAT_UID)
      .create({ data: { articleDocumentId: ids.vue, articleLocale: 'en', views: 1, views30d: 1 } });
    await strapi.db.query(STAT_UID).create({
      data: { articleDocumentId: 'gone', articleLocale: 'en', views: 99, views30d: 99 },
    });

    await sync();

    const rows = await statRows();
    expect(rows.filter((row) => row.articleDocumentId === ids.vue)).toHaveLength(1);
    expect(rows.find((row) => row.articleDocumentId === 'gone')).toBeUndefined();
  });

  describe('GET /api/articles/popular', () => {
    it('lists the most visited articles of the last 30 days, without auth', async () => {
      const res = await get({ locale: 'en' }).expect(200);
      expect(res.body.data.map((entry) => [entry.slug, entry.views])).toEqual([
        ['vue-basics', 12],
        ['linux-hardening', 5],
      ]);
      expect(res.body.data[0]).toMatchObject({
        documentId: ids.vue,
        title: 'Stats vue-basics',
        locale: 'en',
        category: null,
      });
      expect(res.body.meta).toMatchObject({ period: '30d', locale: 'en' });
      expect(res.body.meta.syncedAt).toBeTruthy();
    });

    it('ranks by all-time visitors with period=all and honours limit', async () => {
      const res = await get({ locale: 'en', period: 'all', limit: 1 }).expect(200);
      expect(res.body.data.map((entry) => [entry.slug, entry.views])).toEqual([
        ['linux-hardening', 42],
      ]);
    });

    it('answers per locale and falls back to the default locale', async () => {
      const es = await get({ locale: 'es', period: 'all' }).expect(200);
      expect(es.body.data.map((entry) => [entry.slug, entry.views])).toEqual([
        ['endurecer-linux', 15],
      ]);
      const fallback = await get({}).expect(200);
      expect(fallback.body.meta.locale).toBe('en');
    });

    it('leaves out articles unpublished since the last sync', async () => {
      await strapi.documents(ARTICLE_UID).unpublish({ documentId: ids.vue, locale: 'en' });
      const res = await get({ locale: 'en' }).expect(200);
      expect(res.body.data.map((entry) => entry.slug)).toEqual(['linux-hardening']);
      await strapi.documents(ARTICLE_UID).publish({ documentId: ids.vue, locale: 'en' });
    });

    it('rejects an unknown period', async () => {
      await get({ period: '7d' }).expect(400);
    });
  });

  describe('admin homepage widget', () => {
    const summary = () => strapi.service(STAT_UID).summary();

    it('summarises the most read translations of every locale and the site totals', async () => {
      umami.state.totals = {
        7: { pageviews: 30, visitors: 10 },
        30: { pageviews: 120, visitors: 40 },
      };
      const result = await summary();
      expect(result).toMatchObject({
        configured: true,
        totals: {
          last7d: { visitors: 10, pageviews: 30 },
          last30d: { visitors: 40, pageviews: 120 },
        },
        dashboardUrl: 'https://analytics.example.test/websites/site-1',
      });
      expect(result.top).toEqual([
        { documentId: ids.vue, locale: 'en', title: 'Stats vue-basics', views30d: 12 },
        { documentId: ids.linux, locale: 'en', title: 'Stats linux-hardening', views30d: 5 },
      ]);
      expect(result.syncedAt).toBeTruthy();
    });

    it('keeps the list when Umami fails and only drops the totals', async () => {
      umami.state.status = 500;
      const result = await summary();
      expect(result.totals).toBeNull();
      expect(result.top).toHaveLength(2);
    });

    it('serves the summary on the admin API only to signed-in admins', async () => {
      const server = strapi.server.httpServer;
      await request(server).get('/article-stats/summary').expect(401);
      await request(server)
        .get('/article-stats/summary')
        .set('Authorization', 'Bearer not-a-token')
        .expect(401);

      const email = 'stats-admin@example.test';
      const password = 'Stats-admin-1';
      const superAdmin = await strapi.service('admin::role').getSuperAdmin();
      await strapi.service('admin::user').create({
        email,
        password,
        firstname: 'Stats',
        lastname: 'Admin',
        isActive: true,
        roles: [superAdmin.id],
      });
      const login = await request(server)
        .post('/admin/login')
        .send({ email, password })
        .expect(200);
      const token = login.body.data.token ?? login.body.data.accessToken;

      const res = await request(server)
        .get('/article-stats/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data.top.map((entry) => entry.title)).toEqual([
        'Stats vue-basics',
        'Stats linux-hardening',
      ]);
    });
  });

  it('does nothing without Umami configured', async () => {
    const url = strapi.config.get('umami.url');
    strapi.config.set('umami.url', '');
    try {
      expect(await sync()).toBeNull();
      expect(umami.state.requests).toHaveLength(0);
    } finally {
      strapi.config.set('umami.url', url);
    }
  });
});
