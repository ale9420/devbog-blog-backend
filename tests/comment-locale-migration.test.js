'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { getPublicRole } = require('./helpers/permissions');
const { backfillCommentLocale } = require('../src/migrations/comment-locale');

const ARTICLE_UID = 'api::article.article';
const COMMENT_UID = 'plugin::comments.comment';

describe('Comment locale backfill', () => {
  let defaultLocale;
  let otherLocale;
  let relation;

  /** Inserts a comment row as the plugin did before comments had a locale. */
  const insertComment = (data) =>
    strapi.db.query(COMMENT_UID).create({ data: { approvalStatus: 'APPROVED', ...data } });

  const localeOf = async (id) =>
    (await strapi.db.query(COMMENT_UID).findOne({ where: { id }, select: ['locale'] })).locale;

  const contentsIn = async (locale) => {
    const res = await request(strapi.server.httpServer)
      .get(`/api/comments/${relation}/flat?locale=${locale}`)
      .expect(200);
    const items = Array.isArray(res.body) ? res.body : res.body.data;
    return items.map((item) => item.content);
  };

  beforeAll(async () => {
    await setupStrapi();

    const publicRole = await getPublicRole();
    await strapi.query('plugin::users-permissions.permission').create({
      data: { action: 'plugin::comments.client.findAllFlat', role: publicRole.id },
    });
    await strapi.service('plugin::users-permissions.users-permissions').initialize();

    defaultLocale = await strapi.plugin('i18n').service('locales').getDefaultLocale();
    otherLocale = defaultLocale === 'es' ? 'en' : 'es';

    const draft = await strapi
      .documents(ARTICLE_UID)
      .create({ data: { title: 'Locale target', slug: 'locale-target' } });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });
    relation = `${ARTICLE_UID}:${draft.documentId}`;
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('gives article comments without a locale the default one, and leaves the rest alone', async () => {
    const legacy = await insertComment({ content: 'legacy comment', related: relation });
    const localized = await insertComment({
      content: 'already localized',
      related: relation,
      locale: otherLocale,
    });
    const elsewhere = await insertComment({
      content: 'not on an article',
      related: 'api::about.about:whatever',
    });

    expect(await contentsIn(defaultLocale)).not.toContain('legacy comment');

    expect(await backfillCommentLocale(strapi)).toBeGreaterThanOrEqual(1);

    expect(await localeOf(legacy.id)).toBe(defaultLocale);
    expect(await localeOf(localized.id)).toBe(otherLocale);
    expect(await localeOf(elsewhere.id)).toBeNull();

    expect(await contentsIn(defaultLocale)).toContain('legacy comment');
    expect(await contentsIn(defaultLocale)).not.toContain('already localized');
    expect(await contentsIn(otherLocale)).toContain('already localized');
    expect(await contentsIn(otherLocale)).not.toContain('legacy comment');
  });

  it('is idempotent', async () => {
    await backfillCommentLocale(strapi);
    expect(await backfillCommentLocale(strapi)).toBe(0);
  });
});
