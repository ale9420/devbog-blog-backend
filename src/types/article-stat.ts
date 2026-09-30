/** Contracts of the article-stat service (visitors synced from Umami). */

export interface UmamiConfig {
  url: string;
  websiteId: string;
  apiKey: string;
  syncCron: string;
  publicUrl: string;
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

export interface WebsiteTotals {
  visitors: number;
  pageviews: number;
}

/** What the admin homepage widget shows. */
export interface StatsSummary {
  /** Whether Umami is configured at all. */
  configured: boolean;
  /** Most visited article translations of the last 30 days, every locale. */
  top: {
    documentId: string;
    locale: string;
    title: string | null;
    views30d: number;
  }[];
  /** Whole site, read live from Umami; null when it isn't configured or fails. */
  totals: { last7d: WebsiteTotals; last30d: WebsiteTotals } | null;
  syncedAt: string | null;
  /** Umami's dashboard for the website, when `UMAMI_PUBLIC_URL` is set. */
  dashboardUrl: string | null;
}
