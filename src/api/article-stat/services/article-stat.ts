/**
 * article-stat service: visitors per article translation, synced from Umami.
 */

import { factories } from '@strapi/strapi';
import { ARTICLE_STAT_UID, ARTICLE_UID } from '../../../constants/uids';
import type {
  PopularArticle,
  PopularOptions,
  StatsSummary,
  SyncReport,
  UmamiConfig,
} from '../../../types/article-stat';
import { parseFrontendArticlePath } from '../../../utils/frontend-url';
import {
  fetchPathVisitors,
  fetchWebsiteTotals,
  isUmamiConfigured,
  type PathVisitors,
} from '../utils/umami-client';

export const POPULAR_DEFAULT_LIMIT = 5;
export const POPULAR_MAX_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_WINDOW_MS = 30 * DAY_MS;
const SUMMARY_TOP = 5;

interface StatRow {
  id: number;
  articleDocumentId: string;
  articleLocale: string;
  views: number | null;
  views30d: number | null;
  syncedAt: string | null;
}

interface ArticleRow {
  documentId: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  locale: string | null;
  category?: { slug: string | null; name: string | null } | null;
}

const keyOf = (documentId: string, locale: string) => `${documentId}\u0000${locale}`;

export default factories.createCoreService(ARTICLE_STAT_UID, ({ strapi }) => ({
  /**
   * Pulls the visitors of every path from Umami (all time and last 30 days)
   * and writes one row per published article translation. Returns null when
   * Umami isn't configured; throws when Umami fails, leaving the rows as they were.
   */
  async sync(now = Date.now()): Promise<SyncReport | null> {
    const config = strapi.config.get<UmamiConfig>('umami');
    if (!isUmamiConfigured(config)) return null;

    const [allTime, recent] = await Promise.all([
      fetchPathVisitors(config, { startAt: 0, endAt: now }),
      fetchPathVisitors(config, { startAt: now - RECENT_WINDOW_MS, endAt: now }),
    ]);

    // Published translations by locale + slug. db.query returns draft and
    // published rows; only the published ones have publishedAt.
    const published = (await strapi.db.query(ARTICLE_UID).findMany({
      select: ['documentId', 'slug', 'locale'],
      where: { publishedAt: { $notNull: true } },
    })) as { documentId: string; slug: string | null; locale: string }[];
    const byPath = new Map<string, string>();
    const counts = new Map<string, { views: number; views30d: number }>();
    for (const row of published) {
      if (!row.slug) continue;
      const key = keyOf(row.documentId, row.locale);
      byPath.set(`${row.locale}\u0000${row.slug}`, key);
      counts.set(key, { views: 0, views30d: 0 });
    }

    let matchedPaths = 0;
    let otherPaths = 0;
    const add = (rows: PathVisitors[], field: 'views' | 'views30d') => {
      for (const { path, visitors } of rows) {
        const parsed = parseFrontendArticlePath(path);
        const key = parsed && byPath.get(`${parsed.locale}\u0000${parsed.slug}`);
        if (!key) {
          if (field === 'views') otherPaths += 1;
          continue;
        }
        if (field === 'views') matchedPaths += 1;
        // `/blog/x` and `/blog/x/` are separate paths in Umami: add them up.
        counts.get(key)![field] += visitors;
      }
    };
    add(allTime, 'views');
    add(recent, 'views30d');

    const syncedAt = new Date(now).toISOString();
    const stats = strapi.db.query(ARTICLE_STAT_UID);
    const existing = (await stats.findMany({ orderBy: { id: 'asc' } })) as StatRow[];
    const seen = new Set<string>();
    const stale: number[] = [];

    for (const row of existing) {
      const key = keyOf(row.articleDocumentId, row.articleLocale);
      const next = counts.get(key);
      // Unpublished or deleted articles, and duplicates of a key already seen.
      if (!next || seen.has(key)) {
        stale.push(row.id);
        continue;
      }
      seen.add(key);
      await stats.update({ where: { id: row.id }, data: { ...next, syncedAt } });
    }
    for (const [key, next] of counts) {
      if (seen.has(key)) continue;
      const [articleDocumentId, articleLocale] = key.split('\u0000');
      await stats.create({ data: { articleDocumentId, articleLocale, ...next, syncedAt } });
    }
    if (stale.length > 0) await stats.deleteMany({ where: { id: { $in: stale } } });

    return { articles: counts.size, matchedPaths, otherPaths };
  },

  /** Published articles of a locale, most visited first; articles without visitors are left out. */
  async popular({ locale, period = '30d', limit = POPULAR_DEFAULT_LIMIT }: PopularOptions = {}) {
    const resolvedLocale =
      locale || (await strapi.plugin('i18n').service('locales').getDefaultLocale());
    const column = period === 'all' ? 'views' : 'views30d';

    const stats = (await strapi.db.query(ARTICLE_STAT_UID).findMany({
      where: { articleLocale: resolvedLocale, [column]: { $gt: 0 } },
      orderBy: [{ [column]: 'desc' }, { id: 'asc' }],
    })) as StatRow[];
    const syncedAt = stats.reduce<string | null>(
      (latest, row) => (row.syncedAt && (!latest || row.syncedAt > latest) ? row.syncedAt : latest),
      null
    );
    if (stats.length === 0) return { data: [], locale: resolvedLocale, syncedAt };

    const articles = (await strapi.documents(ARTICLE_UID).findMany({
      status: 'published',
      locale: resolvedLocale,
      fields: ['slug', 'title', 'description', 'publishedAt', 'locale'],
      populate: { category: { fields: ['slug', 'name'] } },
      filters: { documentId: { $in: stats.map((row) => row.articleDocumentId) } },
    })) as unknown as ArticleRow[];
    const byId = new Map(articles.map((article) => [article.documentId, article]));

    const data: PopularArticle[] = [];
    for (const row of stats) {
      const article = byId.get(row.articleDocumentId);
      if (!article) continue;
      data.push({
        documentId: article.documentId,
        slug: article.slug,
        title: article.title,
        description: article.description,
        publishedAt: article.publishedAt,
        locale: article.locale,
        category: article.category
          ? { slug: article.category.slug, name: article.category.name }
          : null,
        views: row[column] ?? 0,
      });
      if (data.length >= Math.min(Math.max(1, limit), POPULAR_MAX_LIMIT)) break;
    }
    return { data, locale: resolvedLocale, syncedAt };
  },

  /**
   * Admin homepage widget: the most visited translations of the last 30 days
   * (every locale, from the synced rows) and the whole site's totals for the
   * last 7 and 30 days, read live from Umami. A failing Umami only drops the totals.
   */
  async summary(now = Date.now()): Promise<StatsSummary> {
    const config = strapi.config.get<UmamiConfig>('umami');
    const configured = isUmamiConfigured(config);

    const stats = (await strapi.db.query(ARTICLE_STAT_UID).findMany({
      where: { views30d: { $gt: 0 } },
      orderBy: [{ views30d: 'desc' }, { id: 'asc' }],
    })) as StatRow[];
    const syncedAt = stats.reduce<string | null>(
      (latest, row) => (row.syncedAt && (!latest || row.syncedAt > latest) ? row.syncedAt : latest),
      null
    );

    const titles = new Map<string, string | null>();
    if (stats.length > 0) {
      const rows = (await strapi.db.query(ARTICLE_UID).findMany({
        select: ['documentId', 'locale', 'title'],
        where: {
          publishedAt: { $notNull: true },
          documentId: { $in: stats.map((row) => row.articleDocumentId) },
        },
      })) as { documentId: string; locale: string; title: string | null }[];
      for (const row of rows) titles.set(keyOf(row.documentId, row.locale), row.title);
    }
    const top = stats
      .filter((row) => titles.has(keyOf(row.articleDocumentId, row.articleLocale)))
      .slice(0, SUMMARY_TOP)
      .map((row) => ({
        documentId: row.articleDocumentId,
        locale: row.articleLocale,
        title: titles.get(keyOf(row.articleDocumentId, row.articleLocale)) ?? null,
        views30d: row.views30d ?? 0,
      }));

    let totals: StatsSummary['totals'] = null;
    if (configured) {
      try {
        const [last7d, last30d] = await Promise.all([
          fetchWebsiteTotals(config, { startAt: now - 7 * DAY_MS, endAt: now }),
          fetchWebsiteTotals(config, { startAt: now - RECENT_WINDOW_MS, endAt: now }),
        ]);
        totals = { last7d, last30d };
      } catch (error) {
        strapi.log.warn(`[umami] could not read the site totals: ${error}`);
      }
    }

    const dashboardUrl =
      configured && config.publicUrl
        ? new URL(`/websites/${encodeURIComponent(config.websiteId)}`, config.publicUrl).href
        : null;

    return { configured, top, totals, syncedAt, dashboardUrl };
  },
}));
