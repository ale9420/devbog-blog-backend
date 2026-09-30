/**
 *  article-stat controller
 */

import { factories } from '@strapi/strapi';
import { ARTICLE_STAT_UID } from '../../../constants/uids';
import type { PopularPeriod } from '../../../types/article-stat';
import { POPULAR_DEFAULT_LIMIT } from '../services/article-stat';

const PERIODS: readonly PopularPeriod[] = ['30d', 'all'];

export default factories.createCoreController(ARTICLE_STAT_UID, ({ strapi }) => ({
  /** GET /api/articles/popular?locale=…&period=30d|all&limit=… */
  async popular(ctx) {
    const { locale, period, limit } = ctx.query as Record<string, string | undefined>;
    const resolvedPeriod = (typeof period === 'string' && period ? period : '30d') as PopularPeriod;
    if (!PERIODS.includes(resolvedPeriod)) {
      return ctx.badRequest(`period must be one of ${PERIODS.join(', ')}`);
    }

    const result = await strapi.service(ARTICLE_STAT_UID).popular({
      locale: typeof locale === 'string' && locale ? locale : undefined,
      period: resolvedPeriod,
      limit: Number.parseInt(String(limit ?? ''), 10) || POPULAR_DEFAULT_LIMIT,
    });
    return {
      data: result.data,
      meta: { period: resolvedPeriod, locale: result.locale, syncedAt: result.syncedAt },
    };
  },

  /** GET /article-stats/summary (admin API, see src/index.ts) */
  async summary() {
    return { data: await strapi.service(ARTICLE_STAT_UID).summary() };
  },
}));
