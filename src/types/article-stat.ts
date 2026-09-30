/** Contracts of the article-stat service (visitors synced from Umami). */

export interface UmamiConfig {
  url: string;
  websiteId: string;
  apiKey: string;
  syncCron: string;
}

/** `30d`: visitors of the last 30 days; `all`: since Umami started counting. */
export type PopularPeriod = '30d' | 'all';

export interface PopularOptions {
  locale?: string;
  period?: PopularPeriod;
  limit?: number;
}

export interface PopularArticle {
  documentId: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  locale: string | null;
  category: { slug: string | null; name: string | null } | null;
  /** Unique visitors (distinct Umami sessions) of the article's path. */
  views: number;
}

export interface SyncReport {
  /** Published article translations whose counts were written. */
  articles: number;
  /** Umami paths that point to one of them. */
  matchedPaths: number;
  /** Umami paths that aren't an article (home, blog list, about…). */
  otherPaths: number;
}
