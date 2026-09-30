'use strict';

const http = require('http');

/**
 * Minimal Umami for the article-stat tests: answers
 * `GET /api/websites/:id/metrics?type=path` with `allTime` when `startAt=0` and
 * with `recent` otherwise, paginated with `limit`/`offset` like Umami, and
 * records every request. `status` forces an error answer.
 */
async function startFakeUmami() {
  const state = {
    allTime: [],
    recent: [],
    status: 200,
    requests: [],
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://umami.test');
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

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startFakeUmami };
