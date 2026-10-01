'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { setRolePermissions } = require('./helpers/permissions');

// Issue #53: `?status=draft` on the content API is only for editors. Before
// the restriction, any caller with `find`/`findOne` (Public included) read
// drafts, directly or through populated relations.

const ARTICLE_UID = 'api::article.article';
const READ = ['find', 'findOne'];
const RELATED = ['category', 'author', 'tag'];

describe('Article drafts are only for editors', () => {
  let edited;
  let neverPublished;
  const jwts = {};
  const tokens = {};

  const http = () => request(strapi.server.httpServer);
  const titles = (res) => (res.body.data ?? []).map((entry) => entry.title).sort();

  async function createUser(username, roleId) {
    const user = await strapi
      .plugin('users-permissions')
      .service('user')
      .add({
        username,
        email: `${username}@example.com`,
        password: 'Password123!',
        provider: 'local',
        confirmed: true,
        role: roleId,
      });
    return strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
  }

  beforeAll(async () => {
    await setupStrapi();

    // The Editor role and its read permissions come from the bootstrap
    // migration (src/migrations/editor-role.ts), not from this test.
    const [editorRole, authenticatedRole] = await Promise.all(
      ['editor', 'authenticated'].map((type) =>
        strapi.query('plugin::users-permissions.role').findOne({ where: { type } })
      )
    );

    for (const roleType of ['public', 'authenticated']) {
      for (const type of ['article', ...RELATED]) await setRolePermissions(roleType, type, READ);
    }

    const [category, author, tag] = await Promise.all([
      strapi.documents('api::category.category').create({ data: { name: 'Cat', slug: 'cat' } }),
      strapi.documents('api::author.author').create({ data: { name: 'Ana' } }),
      strapi.documents('api::tag.tag').create({ data: { name: 'Tag', slug: 'tag' } }),
    ]);
    const relations = {
      category: category.documentId,
      author: author.documentId,
      tags: [tag.documentId],
    };

    const draft = await strapi.documents(ARTICLE_UID).create({
      data: { title: 'Published title', description: 'd', ...relations },
    });
    edited = await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });
    // An unpublished change on top of the published version.
    await strapi.documents(ARTICLE_UID).update({
      documentId: draft.documentId,
      data: { title: 'Unpublished edit' },
    });
    neverPublished = await strapi.documents(ARTICLE_UID).create({
      data: { title: 'Never published', description: 'd', ...relations },
    });

    jwts.authenticated = await createUser('reader', authenticatedRole.id);
    jwts.editor = await createUser('editor', editorRole.id);

    const apiTokens = strapi.service('admin::api-token');
    for (const type of ['read-only', 'full-access']) {
      tokens[type] = (await apiTokens.create({ name: type, type, lifespan: null })).accessKey;
    }
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  const forbidden = {
    Public: () => ({}),
    Authenticated: () => ({ Authorization: `Bearer ${jwts.authenticated}` }),
    'read-only API token': () => ({ Authorization: `Bearer ${tokens['read-only']}` }),
    'full-access API token': () => ({ Authorization: `Bearer ${tokens['full-access']}` }),
  };
  const asEditor = () => ({ Authorization: `Bearer ${jwts.editor}` });

  describe.each(Object.keys(forbidden))('%s', (caller) => {
    it('gets 403 listing articles with status=draft', async () => {
      const res = await http().get('/api/articles?status=draft').set(forbidden[caller]());
      expect(res.status).toBe(403);
      expect(res.body.data).toBeNull();
    });

    it('gets 403 reading one article with status=draft', async () => {
      for (const { documentId } of [edited, neverPublished]) {
        const res = await http()
          .get(`/api/articles/${documentId}?status=draft`)
          .set(forbidden[caller]());
        expect(res.status).toBe(403);
      }
    });

    it('still reads published articles', async () => {
      for (const query of ['', '?status=published']) {
        const res = await http().get(`/api/articles${query}`).set(forbidden[caller]());
        expect(res.status).toBe(200);
        expect(titles(res)).toEqual(['Published title']);
      }
    });
  });

  it.each(['categories', 'authors', 'tags'])(
    'Public gets 403 populating %s.articles with status=draft',
    async (path) => {
      const res = await http().get(`/api/${path}?populate=articles&status=draft`);
      expect(res.status).toBe(403);
    }
  );

  it('rejects status sent as an array', async () => {
    const res = await http().get('/api/articles?status[0]=draft');
    expect(res.status).not.toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('Unpublished edit');
  });

  it('Editor lists drafts, never published and edited ones', async () => {
    const res = await http().get('/api/articles?status=draft').set(asEditor()).expect(200);
    expect(titles(res)).toEqual(['Never published', 'Unpublished edit']);
  });

  it('Editor reads the draft of an article with unpublished changes', async () => {
    const res = await http()
      .get(`/api/articles/${edited.documentId}?status=draft`)
      .set(asEditor())
      .expect(200);
    expect(res.body.data.title).toBe('Unpublished edit');
    expect(res.body.data.publishedAt).toBeNull();
  });

  it('Editor reads drafts through populated relations', async () => {
    const res = await http()
      .get('/api/categories?populate=articles&status=draft')
      .set(asEditor())
      .expect(200);
    const articles = res.body.data.flatMap((entry) => entry.articles ?? []);
    expect(articles.map((a) => a.title).sort()).toEqual(['Never published', 'Unpublished edit']);
  });

  it('Editor without status still gets the published version', async () => {
    const res = await http().get('/api/articles').set(asEditor()).expect(200);
    expect(titles(res)).toEqual(['Published title']);
  });

  it('the admin panel (content-manager) still reads drafts', async () => {
    const superAdmin = await strapi.service('admin::role').getSuperAdmin();
    await strapi.service('admin::user').create({
      email: 'admin@example.com',
      firstname: 'Admin',
      password: 'Password123!',
      isActive: true,
      registrationToken: null,
      roles: [superAdmin.id],
    });
    const login = await http()
      .post('/admin/login')
      .send({ email: 'admin@example.com', password: 'Password123!' })
      .expect(200);

    const res = await http()
      .get(`/content-manager/collection-types/${ARTICLE_UID}/${edited.documentId}`)
      .set({ Authorization: `Bearer ${login.body.data.token}` })
      .expect(200);
    expect(res.body.data.title).toBe('Unpublished edit');
  });

  it('server-side code outside a request still reads drafts', async () => {
    const drafts = await strapi.documents(ARTICLE_UID).findMany({ status: 'draft' });
    expect(drafts.map((a) => a.title).sort()).toEqual(['Never published', 'Unpublished edit']);
  });
});
