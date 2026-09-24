'use strict';

const { setupStrapi, cleanupStrapi } = require('./strapi');
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

async function categorySlugOf(documentId, status) {
  const article = await strapi
    .documents(ARTICLE)
    .findOne({ documentId, status, populate: ['category'] });
  return article?.category?.slug ?? null;
}

describe('consolidateCategories', () => {
  let report;
  let articles;

  beforeAll(async () => {
    await setupStrapi();

    for (const category of await strapi.documents(CATEGORY).findMany()) {
      await strapi.documents(CATEGORY).delete({ documentId: category.documentId });
    }

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

    report = await consolidateCategories(strapi);
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('leaves exactly the five redesign categories plus the ones it does not know', async () => {
    const all = await strapi.documents(CATEGORY).findMany({ sort: 'slug:asc' });
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
      expect(category.name).toBe(target.name);
      expect(category.description).toBe(target.description);
    }
    expect(report.created).toEqual(['diy']);
    expect(report.untouched).toEqual(['Tech culture']);
    expect(report.removed).toEqual(['tutorial']);
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
    expect(await strapi.documents(CATEGORY).count()).toBe(6);
  });
});
