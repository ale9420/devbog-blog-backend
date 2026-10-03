# Analytics (Umami)

The blog's analytics run on a self-hosted [Umami](https://umami.is) 3.4 in Dokploy, on the same VPS. This backend only **reads** from it, to rank the most read articles. Infrastructure (DNS, Umami's database, its backup) lives in `bogdev-infra`; the tracker lives in the frontend.

```
visitor ──► bogdev.com.co/bd.js, /api/bd ──(Nuxt proxy, x-real-ip)──► Umami ◄──(hourly, API key)── Strapi
                                                                                                   │
                                                          GET /api/articles/popular ◄── article_stats
```

## How it works

- **Sync** (`src/api/article-stat/services/article-stat.ts`, `sync()`): every `UMAMI_SYNC_CRON` (hourly by default) and once right after boot, Strapi asks Umami for the visitors of every path, `GET /api/websites/:id/metrics?type=path`, twice: since the beginning (`startAt=0`) and for the last 30 days. It follows Umami's pagination (500 rows per page).
- **Paths to articles** (`src/utils/frontend-url.ts`): each path is matched against the frontend's article URL (`FRONTEND_ARTICLE_PATH`, with the `/<locale>` prefix for non-default locales, as in the fediverse plugin). `/blog/x` and `/blog/x/` are added up. Paths that aren't a published article (home, lists, drafts, deleted slugs) are counted as `otherPaths` in the log and ignored.
- **Storage** (`api::article-stat.article-stat`, table `article_stats`): one row per published article translation with `views` (all time), `views30d` and `syncedAt`. It is hidden from the Content Manager and has no public CRUD routes. It isn't a field on `article` on purpose: writing there every hour would run the article document middlewares, bump `updatedAt` (read by the fediverse and SEO) and fight draft/publish and i18n.
- **Numbers are unique visitors.** Umami's path metric counts distinct sessions per path, not raw page views, so reloads don't inflate it. They match the _Pages_ table in Umami's dashboard for the same range.
- **Failures**: if Umami answers an error or times out (15 s), the sync throws before writing, the cron logs `[umami] sync failed, keeping the previous counts` and the next run tries again.
- **Upserts** go through `strapi.db.query`. `unique` isn't a database index in Strapi, so each sync also removes duplicated rows and rows of articles that are no longer published.

## Endpoint

`GET /api/articles/popular` (public, no token), registered in `src/api/article/routes/02-popular.ts` so it goes before `/articles/:id`.

| Query    | Default        | Meaning                                   |
| -------- | -------------- | ----------------------------------------- |
| `locale` | default locale | Translations to rank                      |
| `period` | `30d`          | `30d` or `all`; anything else answers 400 |
| `limit`  | 5              | 1 to 50                                   |

```json
{
  "data": [
    {
      "documentId": "…",
      "slug": "linux-hardening",
      "title": "…",
      "description": "…",
      "publishedAt": "…",
      "locale": "en",
      "category": { "slug": "linux", "name": "Linux" },
      "views": 42
    }
  ],
  "meta": { "period": "30d", "locale": "en", "syncedAt": "2026-09-30T20:00:00.000Z" }
}
```

Articles with 0 visitors in the period are left out, and so are articles unpublished since the last sync.

## Admin homepage widget

`src/admin/app.tsx` registers a **Visitors** widget on the admin homepage (`app.widgets.register`, Strapi 5.13+). It shows the site's visitors and page views for the last 7 and 30 days, the 5 most visited article translations of the last 30 days (each one links to its edit view) and when the counts were last synced, plus a link to Umami's dashboard when `UMAMI_PUBLIC_URL` is set.

Its data comes from `GET /article-stats/summary` on the **admin** API (admin session required, `admin::isAuthenticatedAdmin`). Routes under `src/api` are always registered as content API, so this one is added with `strapi.server.routes({ type: 'admin' })` in `register()` (`src/index.ts`). The top list comes from `article_stats`; the totals are read live from Umami (`/api/websites/:id/stats`) and, if Umami fails, the widget still shows the list. The API key never reaches the browser.

## Configuration

| Variable           | Meaning                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UMAMI_URL`        | Internal address of the Umami app in `dokploy-network` (`http://<app name>:3000`), not the public domain                                                                              |
| `UMAMI_WEBSITE_ID` | Website id of `bogdev.com.co` in Umami                                                                                                                                                |
| `UMAMI_API_KEY`    | API key (`umami_…`) of the **View only** user `strapi-reader`, which sees the website through the `BogDev` team. Umami API keys can't reach `/api/auth`, `/api/users` or `/api/admin` |
| `UMAMI_SYNC_CRON`  | Optional, default `0 * * * *`                                                                                                                                                         |

Without `UMAMI_URL`, `UMAMI_WEBSITE_ID` and `UMAMI_API_KEY` the sync never runs. `STRAPI_DISABLE_CRON=true` (set by the test harness) turns off every cron task.

## Known limitations

- Changing an article's slug loses the history of the old path: the counts start again from the new one.
- Visits blocked by the browser (ad blockers that also filter first-party paths, disabled JavaScript) aren't counted.

## Tests

`tests/article-stats.test.ts` runs against `tests/helpers/fake-umami.ts`, which answers the metrics endpoint and records requests: path matching per locale, pagination, the API key header, Umami failures, duplicate cleanup and the endpoint. The widget's summary and its admin route (401 without an admin session) are covered in the same suite. `tests/frontend-url.test.ts` covers the path parser.
