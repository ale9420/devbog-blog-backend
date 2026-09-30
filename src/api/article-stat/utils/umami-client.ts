import type { UmamiConfig, WebsiteTotals } from '../../../types/article-stat';

/** Umami's own default page size for metrics. */
const PAGE_SIZE = 500;
const TIMEOUT_MS = 15_000;

export interface PathVisitors {
  /** URL path without the query string. */
  path: string;
  /** Distinct sessions that viewed the path in the range. */
  visitors: number;
}

export function isUmamiConfigured(config: UmamiConfig | undefined): config is UmamiConfig {
  return Boolean(config?.url && config.websiteId && config.apiKey);
}

async function getJson<T>(config: UmamiConfig, url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Umami answered ${response.status} for ${url.pathname}`);
  }
  return (await response.json()) as T;
}

/** Umami 3 answers plain numbers; older versions wrapped them in `{ value }`. */
function numberOf(value: unknown): number {
  const raw = value && typeof value === 'object' ? (value as { value?: unknown }).value : value;
  return Number(raw) || 0;
}

/** Whole-site visitors and page views in [startAt, endAt] (ms), from `/api/websites/:id/stats`. */
export async function fetchWebsiteTotals(
  config: UmamiConfig,
  range: { startAt: number; endAt: number }
): Promise<WebsiteTotals> {
  const url = new URL(`/api/websites/${encodeURIComponent(config.websiteId)}/stats`, config.url);
  url.search = new URLSearchParams({
    startAt: String(range.startAt),
    endAt: String(range.endAt),
  }).toString();
  const stats = await getJson<Record<string, unknown>>(config, url);
  return { visitors: numberOf(stats.visitors), pageviews: numberOf(stats.pageviews) };
}

/**
 * Visitors per path in [startAt, endAt] (ms), from Umami's
 * `/api/websites/:id/metrics?type=path`, following its pagination.
 * Throws on any non-2xx answer, so a failed sync never overwrites good counts.
 */
export async function fetchPathVisitors(
  config: UmamiConfig,
  range: { startAt: number; endAt: number }
): Promise<PathVisitors[]> {
  const result: PathVisitors[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(
      `/api/websites/${encodeURIComponent(config.websiteId)}/metrics`,
      config.url
    );
    url.search = new URLSearchParams({
      type: 'path',
      startAt: String(range.startAt),
      endAt: String(range.endAt),
      limit: String(PAGE_SIZE),
      offset: String(offset),
    }).toString();

    const page = await getJson<{ x: string; y: number | string }[]>(config, url);
    for (const row of page) result.push({ path: row.x, visitors: Number(row.y) || 0 });
    if (page.length < PAGE_SIZE) return result;
  }
}
