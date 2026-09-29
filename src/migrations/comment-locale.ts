import type { Core } from '@strapi/strapi';

const COMMENT_UID = 'plugin::comments.comment';
const ARTICLE_RELATION_PREFIX = 'api::article.article:';

/**
 * Gives article comments saved before comments were split by language the
 * default locale, so they stay visible when the frontend asks for
 * `?locale=<default>`. Every comment in production up to this change was
 * written on the Spanish (default) version. Idempotent: comments that already
 * have a locale are left alone.
 */
export async function backfillCommentLocale(strapi: Core.Strapi): Promise<number> {
  const locale = (await strapi.plugin('i18n').service('locales').getDefaultLocale()) as string;
  const { count } = await strapi.db.query(COMMENT_UID).updateMany({
    where: { related: { $startsWith: ARTICLE_RELATION_PREFIX }, locale: { $null: true } },
    data: { locale },
  });
  return count;
}
