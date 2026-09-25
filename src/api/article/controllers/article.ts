/**
 *  article controller
 */

import { factories } from '@strapi/strapi';
import { SEARCH_DEFAULT_LIMIT, SEARCH_MIN_LENGTH } from '../services/article';

const TRUE_VALUES = new Set(['1', 'true', 'yes']);

export default factories.createCoreController('api::article.article', ({ strapi }) => ({
  /** GET /api/articles/search?q=…&locale=…&content=1&limit=… */
  async search(ctx) {
    const { q, locale, content, limit } = ctx.query as Record<string, string | undefined>;
    const query = typeof q === 'string' ? q.trim() : '';
    if (query.length < SEARCH_MIN_LENGTH) {
      return ctx.badRequest(`q must be at least ${SEARCH_MIN_LENGTH} characters long`);
    }

    const data = await strapi.service('api::article.article').search({
      query,
      locale: typeof locale === 'string' && locale ? locale : undefined,
      content: typeof content === 'string' && TRUE_VALUES.has(content.toLowerCase()),
      limit: Number.parseInt(String(limit ?? ''), 10) || SEARCH_DEFAULT_LIMIT,
    });
    return { data, meta: { query, count: data.length } };
  },
}));
