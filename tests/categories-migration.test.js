'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { setPublicPermissions } = require('./helpers/permissions');
const {
  consolidateCategories,
  hasChanges,
  CATEGORY_TARGETS,
} = require('../src/migrations/consolidate-categories');

const CATEGORY = 'api::category.category';
const ARTICLE = 'api::article.article';

async function createCategory(data) {
  return strapi.documents(CATEGORY).create({ data });
}

async function createArticle(title, category, { publish = true } = {}) {
  const draft = await strapi.documents(ARTICLE).create({
    data: { title, description: `${title} description`, category: category.documentId },
  });
  if (publish) await strapi.documents(ARTICLE).publish({ documentId: draft.documentId });
  return draft;
}

/** Links every English row of an article straight to a category row, bypassing the Document Service. */
async function linkEnglishRows(article, categoryRowId) {
  const joinTable = strapi.db.metadata.get(ARTICLE).attributes.category.joinTable;
  const rows = await strapi.db
    .query(ARTICLE)
    .findMany({ where: { documentId: article.documentId, locale: 'en' }, select: ['id'] });
  await strapi.db
    .connection(joinTable.name)
    .whereIn(
      joinTable.joinColumn.name,
      rows.map((row) => row.id)
    )
    .del();
  for (const row of rows) {
    await strapi.db.connection(joinTable.name).insert({
      [joinTable.joinColumn.name]: row.id,
      [joinTable.inverseJoinColumn.name]: categoryRowId,
    });
  }
}

/**
 * An English localization of an article, linked to the Spanish row of its
 * category: the state production is in, since categories were not localized
 * when these articles were written.
 */
async function addEnglishLocalization(article, category) {
  await strapi.documents(ARTICLE).update({
    documentId: article.documentId,
    locale: 'en',
    data: { title: `${article.title} (en)`, description: 'English description' },
  });
  await strapi.documents(ARTICLE).publish({ documentId: article.documentId, locale: 'en' });
  await linkEnglishRows(article, category.id);
}

async function categoryOf(documentId, status, locale = 'es') {
  const article = await strapi
    .documents(ARTICLE)
    .findOne({ documentId, status, locale, populate: ['category'] });
  return article?.category ?? null;
}

async function categorySlugOf(documentId, status, locale) {
  return (await categoryOf(documentId, status, locale))?.slug ?? null;
}

describe('consolidateCategories', () => {
  let report;
  let articles;

  beforeAll(async () => {
    await setupStrapi();

    // Like production: Spanish is the default locale and English is also configured.
    const locales = strapi.plugin('i18n').service('locales');
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' });
    }
    await locales.setDefaultLocale({ code: 'es' });

    await strapi.db.query(CATEGORY).deleteMany({});

    const legacy = {
      linux: await createCategory({ name: 'linux', description: 'Articles related to GNU/Linux' }),
      ia: await createCategory({ name: 'IA', description: 'Articles related to IA' }),
      foss: await createCategory({ name: 'foss' }),
      tutorial: await createCategory({ name: 'tutorial' }),
      web: await createCategory({ name: 'web-development', slug: 'web-development' }),
      devops: await createCategory({ name: 'devops', slug: 'devops' }),
      mobile: await createCategory({ name: 'mobile', slug: 'mobile' }),
      privacy: await createCategory({ name: 'privacy', slug: 'privacy' }),
      rag: await createCategory({ name: 'RAG' }),
      other: await createCategory({ name: 'Tech culture', slug: 'tech-culture' }),
    };

    articles = {
      rag: await createArticle('Qué es RAG', legacy.rag),
      ia: await createArticle('Soberanía digital', legacy.ia),
      foss: await createArticle('Licencias libres', legacy.foss),
      mobile: await createArticle('React Native', legacy.mobile, { publish: false }),
      privacy: await createArticle('Autoalojamiento', legacy.privacy),
      tutorial: await createArticle('Paso a paso', legacy.tutorial),
      other: await createArticle('Trabajo remoto', legacy.other),
    };
    await addEnglishLocalization(articles.rag, legacy.rag);
    await addEnglishLocalization(articles.other, legacy.other);

    report = await consolidateCategories(strapi);
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('leaves exactly the five redesign categories plus the ones it does not know', async () => {
    const all = await strapi.documents(CATEGORY).findMany({ locale: 'es', sort: 'slug:asc' });
    expect(all.map((category) => category.slug)).toEqual([
      'diy',
      'ia',
      'linux',
      'privacidad',
      'software',
      'tech-culture',
    ]);
    for (const target of CATEGORY_TARGETS) {
      const category = all.find((entry) => entry.slug === target.slug);
      expect(category.name).toBe(target.text.es.name);
      expect(category.description).toBe(target.text.es.description);
    }
    expect(report.created).toEqual(['diy']);
    expect(report.untouched).toEqual(['Tech culture']);
    expect(report.removed).toEqual(['tutorial']);
  });

  it('translates the five categories into English, sharing the non-localized fields', async () => {
    const english = await strapi.documents(CATEGORY).findMany({ locale: 'en', sort: 'order:asc' });
    expect(english.map((category) => category.slug)).toEqual(
      CATEGORY_TARGETS.map((target) => target.slug)
    );
    for (const target of CATEGORY_TARGETS) {
      const category = english.find((entry) => entry.key === target.key);
      expect(category.name).toBe(target.text.en.name);
      expect(category.description).toBe(target.text.en.description);
      expect(category.bird).toBe(target.bird);
      expect(category.pillar).toBe(target.pillar);
      expect(category.order).toBe(target.order);
    }
  });

  it('moves the draft and the published version of merged articles together', async () => {
    expect(await categorySlugOf(articles.rag.documentId, 'published')).toBe('ia');
    expect(await categorySlugOf(articles.rag.documentId, 'draft')).toBe('ia');
    expect(await categorySlugOf(articles.ia.documentId, 'published')).toBe('ia');
    expect(await categorySlugOf(articles.foss.documentId, 'published')).toBe('linux');
    expect(await categorySlugOf(articles.privacy.documentId, 'published')).toBe('privacidad');
    expect(await categorySlugOf(articles.mobile.documentId, 'draft')).toBe('software');
    expect(await categorySlugOf(articles.other.documentId, 'published')).toBe('tech-culture');
  });

  it('links English articles to the English category', async () => {
    for (const status of ['published', 'draft']) {
      const category = await categoryOf(articles.rag.documentId, status, 'en');
      expect(category.locale).toBe('en');
      expect(category.name).toBe('Artificial intelligence');
    }
    // No English localization to move to: stays on the Spanish row.
    expect(await categorySlugOf(articles.other.documentId, 'published', 'en')).toBe('tech-culture');
    expect(report.relinked).toBe(2);
  });

  it('keeps the published article published and unchanged apart from its category', async () => {
    const published = await strapi
      .documents(ARTICLE)
      .findOne({ documentId: articles.rag.documentId, status: 'published' });
    expect(published.title).toBe('Qué es RAG');
    expect(published.publishedAt).toBeTruthy();
  });

  it('leaves articles of removed categories without a category', async () => {
    expect(await categorySlugOf(articles.tutorial.documentId, 'published')).toBeNull();
    expect(await categorySlugOf(articles.tutorial.documentId, 'draft')).toBeNull();
    expect(report.uncategorized).toBe(2);
  });

  it('is idempotent', async () => {
    const second = await consolidateCategories(strapi);
    expect(hasChanges(second)).toBe(false);
    expect(await strapi.documents(CATEGORY).count({ locale: 'es' })).toBe(6);
    expect(await strapi.documents(CATEGORY).count({ locale: 'en' })).toBe(5);
  });

  it('fills and translates categories consolidated before localization and the new fields', async () => {
    // Production ran the first version of the migration: right slugs, Spanish only,
    // no new fields, and English articles pointing at the Spanish rows.
    const ia = await strapi.db.query(CATEGORY).findOne({ where: { slug: 'ia', locale: 'es' } });
    await linkEnglishRows(articles.rag, ia.id);
    await strapi.db.query(CATEGORY).deleteMany({ where: { locale: 'en' } });
    await strapi.db.query(CATEGORY).updateMany({
      where: { slug: { $in: CATEGORY_TARGETS.map((target) => target.slug) } },
      data: { key: null, bird: null, pillar: false, order: null },
    });

    const refill = await consolidateCategories(strapi);
    expect(refill.updated.sort()).toEqual(['diy', 'ia', 'linux', 'privacidad', 'software']);
    expect(refill.localized).toHaveLength(5);
    expect(refill.created).toEqual([]);
    expect(refill.relinked).toBe(2);
    expect(await categorySlugOf(articles.rag.documentId, 'published')).toBe('ia');
    expect((await categoryOf(articles.rag.documentId, 'published', 'en')).locale).toBe('en');
    expect(hasChanges(await consolidateCategories(strapi))).toBe(false);
  });

  it('GET /api/categories?sort=order returns the five keys with bird, pillar and order', async () => {
    await setPublicPermissions('category', ['find', 'findOne']);
    const query = { sort: 'order', filters: { key: { $notNull: true } } };
    const spanish = await request(strapi.server.httpServer)
      .get('/api/categories')
      .query(query)
      .expect(200);
    const english = await request(strapi.server.httpServer)
      .get('/api/categories')
      .query({ ...query, locale: 'en' })
      .expect(200);

    const fields = ({ key, bird, pillar, order }) => ({ key, bird, pillar, order });
    const expected = [
      { key: 'privacidad', bird: 'Pinchaflor (Diglossa cyanea)', pillar: true, order: 1 },
      { key: 'diy', bird: 'Golondrina (Pygochelidon cyanoleuca)', pillar: true, order: 2 },
      { key: 'ia', bird: 'Colibrí chillón (Colibri coruscans)', pillar: false, order: 3 },
      { key: 'software', bird: 'Mirla patinaranja (Turdus fuscater)', pillar: false, order: 4 },
      {
        key: 'linux',
        bird: 'Monjita bogotana (Chrysomus icterocephalus bogotensis)',
        pillar: false,
        order: 5,
      },
    ];
    expect(spanish.body.data.map(fields)).toEqual(expected);
    expect(english.body.data.map(fields)).toEqual(expected);
    expect(spanish.body.data[0].name).toBe('Privacidad');
    expect(english.body.data[0].name).toBe('Privacy');
  });
});
