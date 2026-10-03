import http from 'http';
import type { AddressInfo } from 'net';

/** `[path, visitors]` rows, as Umami's metrics endpoint pages them. */
type MetricRow = [string, number];

interface FakeUmamiState {
  allTime: MetricRow[];
  recent: MetricRow[];
  /** Totals per range length in days. */
  totals: Record<number, { pageviews: number; visitors: number }>;
  status: number;
  requests: { path: string; query: Record<string, string>; headers: http.IncomingHttpHeaders }[];
}

/**
 * Minimal Umami for the article-stat tests: answers
 * `GET /api/websites/:id/metrics?type=path` with `allTime` when `startAt=0` and
 * with `recent` otherwise, paginated with `limit`/`offset` like Umami, and
 * `GET /api/websites/:id/stats` with `totals[<days in the range>]`. Records
 * every request; `status` forces an error answer.
 */
async function startFakeUmami() {
  const state: FakeUmamiState = {
    allTime: [],
    recent: [],
    totals: {},
    status: 200,
    requests: [],
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://umami.test');
    state.requests.push({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
    });

    if (state.status !== 200) {
      res.writeHead(state.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'forced' }));
      return;
    }
    if (/^\/api\/websites\/[^/]+\/stats$/.test(url.pathname)) {
      const days = Math.round(
        (Number(url.searchParams.get('endAt')) - Number(url.searchParams.get('startAt'))) /
          86_400_000
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state.totals[days] ?? { pageviews: 0, visitors: 0 }));
      return;
    }
    if (
      !/^\/api\/websites\/[^/]+\/metrics$/.test(url.pathname) ||
      url.searchParams.get('type') !== 'path'
    ) {
      res.writeHead(404);
      res.end();
      return;
    }

    const rows = url.searchParams.get('startAt') === '0' ? state.allTime : state.recent;
    const limit = Number(url.searchParams.get('limit') ?? 500);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const page = rows.slice(offset, offset + limit).map(([x, y]) => ({ x, y }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(page));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A running fake Umami, as `startFakeUmami` returns it. */
type FakeUmami = Awaited<ReturnType<typeof startFakeUmami>>;

export { startFakeUmami, type FakeUmami, type MetricRow };
