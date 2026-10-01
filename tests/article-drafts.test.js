'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { setRolePermissions } = require('./helpers/permissions');

// Issue #53, step 4: GET /api/articles/drafts lists, for editors only, the
// drafts with something to review: never published, or edited after publishing.

const ARTICLE_UID = 'api::article.article';
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('GET /api/articles/drafts', () => {
  const ids = {};
  const jwts = {};
  let fullAccessToken;

  const http = () => request(strapi.server.httpServer);
  const asEditor = () => ({ Authorization: `Bearer ${jwts.editor}` });
  const byTitle = (res) => Object.fromEntries(res.body.data.map((d) => [d.title, d]));

  async function createUser(username, roleType) {
    const role = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: roleType } });
    const user = await strapi
      .plugin('users-permissions')
      .service('user')
      .add({
        username,
        email: `${username}@example.com`,
        password: 'Password123!',
        provider: 'local',
        confirmed: true,
        role: role.id,
      });
    return strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
  }

  beforeAll(async () => {
    await setupStrapi();
    const locales = strapi.plugin('i18n').service('locales');
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' });
    }

    const articles = strapi.documents(ARTICLE_UID);
    const category = await strapi
      .documents('api::category.category')
      .create({ data: { name: 'Pruebas', slug: 'pruebas' } });
    const author = await strapi.documents('api::author.author').create({ data: { name: 'Ana' } });

    // Published and untouched since: nothing to review.
    const untouched = await articles.create({ data: { title: 'Untouched' } });
    await articles.publish({ documentId: untouched.documentId });

    // Published, then edited.
    const edited = await articles.create({
      data: { title: 'Edited', category: category.documentId, author: author.documentId },
    });
    ids.edited = edited.documentId;
    await articles.publish({ documentId: edited.documentId });
    await tick();
    await articles.update({ documentId: edited.documentId, data: { title: 'Edited v2' } });

    // Never published.
    await tick();
    const fresh = await articles.create({ data: { title: 'Fresh' } });
    ids.fresh = fresh.documentId;

    // Published in en; its es translation was never published.
    const translated = await articles.create({ data: { title: 'Translated' } });
    await articles.publish({ documentId: translated.documentId });
    await tick();
    await articles.update({
      documentId: translated.documentId,
      locale: 'es',
      data: { title: 'Traducido' },
    });
    ids.translated = translated.documentId;

    await setRolePermissions('authenticated', 'article', ['find', 'drafts']);
    jwts.editor = await createUser('editor', 'editor');
    jwts.reader = await createUser('reader', 'authenticated');
    fullAccessToken = (
      await strapi
        .service('admin::api-token')
        .create({ name: 'fa', type: 'full-access', lifespan: null })
    ).accessKey;
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('lists never published and modified drafts, last edited first', async () => {
    const res = await http().get('/api/articles/drafts').set(asEditor()).expect(200);

    expect(res.body.data.map((d) => d.title)).toEqual(['Traducido', 'Fresh', 'Edited v2']);
    expect(res.body.meta).toEqual({ count: 3 });
    expect(res.headers['cache-control']).toBe('private, no-store');

    const { 'Edited v2': edited, Fresh: fresh, Traducido: translated } = byTitle(res);
    expect(edited).toMatchObject({
      documentId: ids.edited,
      locale: 'en',
      state: 'modified',
      category: { name: 'Pruebas', slug: 'pruebas' },
      author: { name: 'Ana' },
    });
    expect(edited.publishedAt).toEqual(expect.any(String));
    expect(fresh).toMatchObject({
      documentId: ids.fresh,
      state: 'never-published',
      publishedAt: null,
      category: null,
      author: null,
    });
    // The en version is published, but not the es one: per locale.
    expect(translated).toMatchObject({
      documentId: ids.translated,
      locale: 'es',
      state: 'never-published',
      publishedAt: null,
    });
  });

  it('filters by locale', async () => {
    const res = await http().get('/api/articles/drafts?locale=es').set(asEditor()).expect(200);
    expect(res.body.data.map((d) => d.title)).toEqual(['Traducido']);
  });

  it('drops a draft once it is published', async () => {
    await strapi.documents(ARTICLE_UID).publish({ documentId: ids.fresh });
    const res = await http().get('/api/articles/drafts').set(asEditor()).expect(200);
    expect(res.body.data.map((d) => d.title)).not.toContain('Fresh');
  });

  it('is not reachable by anyone else', async () => {
    // Public has no permission; the reader has `drafts` but not the Editor
    // role; the full-access token has every permission but is no editor.
    expect((await http().get('/api/articles/drafts')).status).toBe(403);
    for (const auth of [`Bearer ${jwts.reader}`, `Bearer ${fullAccessToken}`]) {
      const res = await http().get('/api/articles/drafts').set({ Authorization: auth });
      expect(res.status).toBe(403);
      expect(res.body.data).toBeNull();
    }
  });

  it('does not shadow the core findOne route', async () => {
    await setRolePermissions('public', 'article', ['findOne']);
    const res = await http().get(`/api/articles/${ids.edited}`).expect(200);
    expect(res.body.data.title).toBe('Edited');
  });
});
