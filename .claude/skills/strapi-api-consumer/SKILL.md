---
name: strapi-api-consumer
description: Use when the user asks how front-end or mobile apps consume this Strapi backend, including REST endpoints, populate, filters, sorting, pagination, localization, public permissions, CORS, or API tokens.
---

# Strapi API Consumer Skill

This backend is designed to be consumed by external apps over **REST**. The default base path for content APIs is `/api/<plural-name>`.

## When to use this skill

- Building or documenting a front-end/mobile consumer.
- Deciding which fields/relations to expose.
- Troubleshooting 403/404 responses from the API.
- Adding CORS, API tokens, or public permissions.

## Default REST endpoints

For a content type with `pluralName: articles`:

| Method | Endpoint            | Action                 |
| ------ | ------------------- | ---------------------- |
| GET    | `/api/articles`     | List                   |
| GET    | `/api/articles/:id` | Single entry           |
| POST   | `/api/articles`     | Create (authenticated) |
| PUT    | `/api/articles/:id` | Update (authenticated) |
| DELETE | `/api/articles/:id` | Delete (authenticated) |

### Article search

`GET /api/articles/search?q=…&locale=es&content=1&limit=10` is public (`auth: false`) and returns only published articles, newest first. Without `content` it searches the title; with `content=1` also the description and the body (the private `plainText` field, computed from `blocks` on every save and backfilled at bootstrap). `q` needs at least 3 characters; `limit` caps at 50. Each result has `documentId`, `slug`, `title`, `description`, `publishedAt`, `locale`, `category { slug, name }`, `matchedIn` (`title` | `description` | `content`) and a plain-text `snippet` around the match. The snippet is **not** escaped: escape it before wrapping the match in `<mark>`.

Single types use the same path but return one object:

- `GET /api/global`
- `GET /api/about`

## Population

Strapi does **not** return relations or media by default. Populate them explicitly:

```http
GET /api/articles?populate=*
GET /api/articles?populate[author][fields][0]=name&populate[author][fields][1]=avatar
GET /api/articles?populate[cover][fields][0]=url
GET /api/articles?populate[blocks][populate][file][fields][0]=url
```

For dynamic-zone media blocks (`shared.media`, `shared.slider`), populate the nested `file` field so consumers receive real URLs.

## Filtering, sorting, and pagination

Filter:

```http
GET /api/articles?filters[slug][$eq]=hello-world
GET /api/articles?filters[category][name][$eq]=Tech
```

Sort:

```http
GET /api/articles?sort[0]=publishedAt:desc
```

Categories: the redesign has five, kept in sync on every boot by `src/migrations/consolidate-categories.ts`. Paint and filter them by `key`, a stable enumeration that does not depend on the visible `name`:

```http
GET /api/categories?sort=order&locale=es
GET /api/categories?sort=order&locale=en
GET /api/articles?locale=en&filters[category][key][$eq]=privacidad
```

| `key` / `slug` | `name` (es)             | English name            | `bird`                                                 | `pillar` | `order` |
| -------------- | ----------------------- | ----------------------- | ------------------------------------------------------ | -------- | ------- |
| `privacidad`   | Privacidad              | Privacy                 | Pinchaflor (Diglossa cyanea)                           | true     | 1       |
| `diy`          | DIY · Hazlo tú mismo    | DIY · Do it yourself    | Golondrina (Pygochelidon cyanoleuca)                   | true     | 2       |
| `ia`           | Inteligencia artificial | Artificial intelligence | Colibrí chillón (Colibri coruscans)                    | false    | 3       |
| `software`     | Desarrollo de software  | Software development    | Mirla patinaranja (Turdus fuscater)                    | false    | 4       |
| `linux`        | Linux y código abierto  | Linux and open source   | Monjita bogotana (Chrysomus icterocephalus bogotensis) | false    | 5       |

Categories are localized: `name` and `description` change with `locale` (`es` is the default), while `slug`, `key`, `bird`, `pillar` and `order` are shared by every locale. An article populates the category row of its own locale. Categories outside the redesign have `key` and `order` set to `null` and may exist only in Spanish.

Pagination (`config/api.ts` sets `defaultLimit: 25`, `maxLimit: 100`):

```http
GET /api/articles?pagination[page]=1&pagination[pageSize]=10
```

## Localization

Content types with `"i18n": { "localized": true }` accept a `locale` query param:

```http
GET /api/articles?locale=en
GET /api/articles?locale=es
```

## Public permissions

The seed script (`scripts/seed.js`) grants read access for public consumers:

```javascript
await setPublicPermissions({
  article: ['find', 'findOne'],
  category: ['find', 'findOne'],
  author: ['find', 'findOne'],
  global: ['find', 'findOne'],
  about: ['find', 'findOne'],
  subscriber: ['create'],
});
```

If a public request returns 403, add the missing action here and re-run `npm run seed:example`.

## Authenticated endpoints

For write/update/delete operations, use **API tokens** or the **Users & Permissions** plugin:

1. Generate an API token in the Strapi admin: **Settings → API Tokens → Create new API Token**.
2. Send it as `Authorization: Bearer <token>`.
3. Assign the appropriate role permissions.

## CORS

`strapi::cors` is enabled by default in `config/middlewares.ts`. For stricter rules, configure the `cors` object in `config/middlewares.ts` or via `config/plugins.ts`.

## Response shape

Collection responses wrap data in `data` and metadata in `meta`:

```json
{
  "data": [...],
  "meta": {
    "pagination": { "page": 1, "pageSize": 25, "pageCount": 1, "total": 5 }
  }
}
```

Single responses return `data` directly.

## Health check

Use the custom endpoint for uptime checks:

```http
GET /_health
```

Response: `{ "status": "ok", "timestamp": "..." }`

## Do not

- Expose internal fields such as `confirmationToken` or draft entries to public consumers.
- Rely on default responses to include media or relations — always design population explicitly.
