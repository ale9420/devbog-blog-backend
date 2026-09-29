'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { getPublicRole, setPublicPermissions } = require('./helpers/permissions');
const { grantPublicTagPermissions } = require('../src/migrations/public-tag-permissions');

const ARTICLE_UID = 'api::article.article';
const TAG_UID = 'api::tag.tag';

describe('Tags', () => {
  const articles = {};
  let vue;

  const get = (path, query) => request(strapi.server.httpServer).get(path).query(query);

  async function article(slug, { tags, publish = true } = {}) {
    const draft = await strapi.documents(ARTICLE_UID).create({
      locale: 'es',
      data: { title: `Tags ${slug}`, slug: `tags-${slug}`, description: 'Resumen.', tags },
    });
    if (publish) {
      await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId, locale: 'es' });
    }
    return draft.documentId;
  }

  beforeAll(async () => {
    await setupStrapi();
    await setPublicPermissions('article', ['find', 'findOne']);
    const locales = strapi.plugin('i18n').service('locales');
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' });
    }

    // One tag in both languages: the slug is shared, the name is translated.
    vue = (
      await strapi.documents(TAG_UID).create({ locale: 'es', data: { name: 'Vue', slug: 'vue' } })
    ).documentId;
    await strapi
      .documents(TAG_UID)
      .update({ documentId: vue, locale: 'en', data: { name: 'Vue', slug: 'vue' } });
    const privacy = (
      await strapi
        .documents(TAG_UID)
        .create({ locale: 'es', data: { name: 'Privacidad', slug: 'privacidad' } })
    ).documentId;

    articles.vue = await article('vue', { tags: [vue] });
    articles.both = await article('both', { tags: [vue, privacy] });
    articles.untagged = await article('untagged');
    articles.draft = await article('draft', { tags: [vue], publish: false });
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('grants the public role read access to tags on bootstrap, once', async () => {
    const role = await getPublicRole();
    const actions = await strapi.db.query('plugin::users-permissions.permission').findMany({
      where: { role: role.id, action: { $startsWith: 'api::tag.tag.' } },
    });
    expect(actions.map((permission) => permission.action).sort()).toEqual([
      'api::tag.tag.find',
      'api::tag.tag.findOne',
    ]);
    expect(await grantPublicTagPermissions(strapi)).toBe(0);
  });

  it('filters articles by tag slug and populates their tags', async () => {
    const res = await get('/api/articles', {
      'filters[tags][slug][$eq]': 'vue',
      'populate[tags][fields][0]': 'name',
      'populate[tags][fields][1]': 'slug',
      locale: 'es',
    }).expect(200);

    const byId = Object.fromEntries(res.body.data.map((entry) => [entry.documentId, entry]));
    expect(Object.keys(byId).sort()).toEqual([articles.vue, articles.both].sort());
    expect(byId[articles.vue].tags).toEqual([
      expect.objectContaining({ name: 'Vue', slug: 'vue' }),
    ]);
    expect(byId[articles.both].tags.map((tag) => tag.slug).sort()).toEqual(['privacidad', 'vue']);
  });

  it('lists the tags of a locale with only their published articles', async () => {
    const res = await get('/api/tags', {
      locale: 'es',
      'fields[0]': 'name',
      'fields[1]': 'slug',
      'pagination[pageSize]': 100,
      'populate[articles][fields][0]': 'id',
      'populate[articles][filters][locale][$eq]': 'es',
    }).expect(200);

    const bySlug = Object.fromEntries(res.body.data.map((tag) => [tag.slug, tag]));
    expect(Object.keys(bySlug).sort()).toEqual(['privacidad', 'vue']);
    expect(bySlug.vue.name).toBe('Vue');
    expect(bySlug.vue.articles.map((entry) => entry.documentId).sort()).toEqual(
      [articles.vue, articles.both].sort()
    );
    expect(bySlug.privacidad.articles.map((entry) => entry.documentId)).toEqual([articles.both]);
  });

  it('keeps the slug in every locale', async () => {
    const res = await get('/api/tags', { locale: 'en' }).expect(200);
    expect(res.body.data.map((tag) => tag.slug)).toEqual(['vue']);
  });
});
