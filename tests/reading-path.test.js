'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { setPublicPermissions } = require('./helpers/permissions');

const ARTICLE_UID = 'api::article.article';
const CATEGORY_UID = 'api::category.category';

describe('Reading path (article.pathOrder)', () => {
  const readingPath = (key) =>
    request(strapi.server.httpServer)
      .get('/api/articles')
      .query({
        filters: { category: { key: { $eq: key } }, pathOrder: { $notNull: true } },
        sort: 'pathOrder:asc',
      })
      .expect(200);

  async function article(title, category, { pathOrder, publish = true } = {}) {
    const draft = await strapi.documents(ARTICLE_UID).create({
      data: { title, category: category.documentId, pathOrder },
    });
    if (publish) await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });
    return draft;
  }

  beforeAll(async () => {
    await setupStrapi();
    await setPublicPermissions('article', ['find', 'findOne']);
    // Filtering through a relation needs read access to its target.
    await setPublicPermissions('category', ['find']);

    // The redesign categories (with their `key`) are created at boot.
    const [privacidad, ia] = await Promise.all(
      ['privacidad', 'ia'].map((key) =>
        strapi.documents(CATEGORY_UID).findFirst({ filters: { key } })
      )
    );

    // Created out of order so the result can't come from insertion order.
    await article('Third step', privacidad, { pathOrder: 3 });
    await article('First step', privacidad, { pathOrder: 1 });
    await article('Off the path', privacidad);
    await article('Second step', privacidad, { pathOrder: 2 });
    await article('Draft step', privacidad, { pathOrder: 4, publish: false });
    await article('Other category', ia, { pathOrder: 1 });
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('returns the published articles of the category on the path, in pathOrder', async () => {
    const res = await readingPath('privacidad');

    expect(res.body.data.map((entry) => entry.title)).toEqual([
      'First step',
      'Second step',
      'Third step',
    ]);
    expect(res.body.data.map((entry) => entry.pathOrder)).toEqual([1, 2, 3]);
  });

  it('leaves articles without pathOrder out of the path', async () => {
    const res = await request(strapi.server.httpServer)
      .get('/api/articles')
      .query({ filters: { category: { key: { $eq: 'privacidad' } } } })
      .expect(200);

    const offPath = res.body.data.find((entry) => entry.title === 'Off the path');
    expect(offPath.pathOrder).toBeNull();
    expect((await readingPath('privacidad')).body.data).not.toContainEqual(
      expect.objectContaining({ title: 'Off the path' })
    );
  });

  it('keeps each category on its own path', async () => {
    const res = await readingPath('ia');
    expect(res.body.data.map((entry) => entry.title)).toEqual(['Other category']);
  });

  it('shares pathOrder across locales', async () => {
    const locales = strapi.plugin('i18n').service('locales');
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' });
    }

    const [first] = await strapi.documents(ARTICLE_UID).findMany({
      filters: { title: 'First step' },
    });
    const localized = await strapi.documents(ARTICLE_UID).update({
      documentId: first.documentId,
      locale: 'es',
      data: { title: 'Primer paso' },
    });

    expect(localized.pathOrder).toBe(1);
  });

  it('describes the field in the admin', async () => {
    const { metadatas } = await strapi
      .plugin('content-manager')
      .service('content-types')
      .findConfiguration({ uid: ARTICLE_UID });

    expect(metadatas.pathOrder.edit.description).toMatch(/ruta de lectura/);
  });
});
