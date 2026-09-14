# Fediverse Federation (ActivityPub) Plan & Architecture

This document is the source of truth for connecting the DevBog blog backend to the fediverse, so users on Mastodon (and any other ActivityPub network) can follow the blog, receive published articles in their timeline, and reply, like, and boost — with replies landing as moderated comments in the existing `strapi-plugin-comments` collection.

> **Status: Phase 0 (spike) complete** on branch `feat/fediverse-phase-0`. Implementation is tracked in the [`fediverse-federation` milestone](https://github.com/ale9420/devbog-blog-backend/milestone/1) (one issue per phase, 0–5). Update the phase checklist in this document as work progresses so future agents always see the current state.

## Table of Contents

- [Goal & Decisions](#goal--decisions)
- [Architecture](#architecture)
- [Components](#components)
- [Federation Flows](#federation-flows)
- [Moderation & Security](#moderation--security)
- [Risks & Mitigations](#risks--mitigations)
- [Implementation Phases](#implementation-phases)
- [Future Work (Out of Scope)](#future-work-out-of-scope)
- [References](#references)

---

## Goal & Decisions

| Decision         | Choice                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Architecture     | **Fedify embedded in Strapi** as a local plugin — no sidecar service, single deploy unit                          |
| Protocol library | [`@fedify/fedify`](https://fedify.dev) + `@fedify/koa` Koa middleware (same stack Ghost uses for its ActivityPub) |
| Actor domain     | `api.bogdev.com.co` → handle `@devbog@api.bogdev.com.co` (served directly by Strapi; no reverse-proxy changes)    |
| Actor identity   | Single blog actor (not per-author)                                                                                |
| Replies storage  | Existing `strapi-plugin-comments` collection, entering as `PENDING` for the existing approval workflow            |
| MVP scope        | Follow + article federation + replies-as-comments **plus likes & boosts**                                         |
| i18n             | MVP federates the default locale only                                                                             |

Rejected alternatives (for context):

- **Sidecar microservice** (Ghost's exact `TryGhost/ActivityPub` architecture) — cleaner isolation but an extra Dokploy service, proxy config, and database.
- **Bridgy Fed + webmentions** — zero protocol code but a third-party hosted bridge, frontend microformats2 changes, and less control.
- **Cross-posting to an existing Mastodon account** — syndication, not federation; replies would not flow back as site comments.

---

## Architecture

```
Mastodon / Pleroma / Misskey / Friendica / any ActivityPub server
   │  WebFinger, HTTP signatures, inbox delivery (ActivityPub S2S)
   ▼
api.bogdev.com.co  (Strapi 5 = Koa)
   ┌──────────────────────────────────────────────────────────┐
   │  local plugin: src/plugins/fediverse/                    │
   │                                                          │
   │  @fedify/koa middleware mounted via strapi.server.use()  │
   │    /.well-known/webfinger                                │
   │    /.well-known/nodeinfo  +  /nodeinfo/2.1               │
   │    /fediverse/user/devbog          (actor)               │
   │    /fediverse/user/devbog/inbox     (personal inbox)     │
   │    /fediverse/inbox                 (shared inbox)       │
   │    /fediverse/user/devbog/followers                       │
   │    /fediverse/user/devbog/outbox                          │
   │    /fediverse/articles/:documentId (Article objects)     │
   ├──────────────────────────────────────────────────────────┤
   │  Strapi core                                             │
   │    api::article.article        (publish lifecycles → fan-out)      │
   │    plugin::comments.comment   (fediverse replies → PENDING)       │
   │    plugin content types: fediverse-follower, fediverse-interaction│
   │    GET /api/fediverse/articles/:documentId/stats (public)         │
   └──────────────────────────────────────────────────────────┘
                 │
                 ▼
   Article objects carry url → https://bogdev.com.co/blog/{slug}
   (humans click through to the frontend; the fediverse dereferences
    the JSON-LD object on api.bogdev.com.co)
```

Fedify handles the protocol hard parts: HTTP signatures (including Mastodon's draft-cavage vs RFC 9421 "double-knock" quirks), WebFinger server, NodeInfo, JSON-LD Activity Vocabulary, and inbox signature verification **before** any listener code runs.

**Path collisions:** Strapi already serves `/api/*`, `/admin`, `/upload/*`, `/_health`, `/mcp`, and static `/public`. Neither `/.well-known/*` (unused) nor `/fediverse/*` (new prefix) collide with anything.

---

## Components

### Local plugin `src/plugins/fediverse/`

| Part                      | Responsibility                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register()`              | Create the `Federation` instance and mount `@fedify/koa` middleware via `strapi.server.use()` (must be `register()`, not `bootstrap()` — see Phase 0 findings)          |
| `bootstrap()`             | Subscribe to `entry.publish` / `entry.unpublish` on `strapi.eventHub` (Strapi 5 does **not** emit publish lifecycles via `strapi.db.lifecycles` — see Phase 0 findings) |
| Actor dispatcher          | Serves `/fediverse/user/devbog` — name/avatar/bio derived from the `global`/`about` single types                                                                        |
| Key pairs dispatcher      | Reads keypairs from plugin store (`strapi.store({ type: 'plugin', name: 'fediverse' })`)                                                                                |
| Article object dispatcher | Serves `/fediverse/articles/:documentId` as an `Article` (title, excerpt, frontend `url`, cover image, lang)                                                            |
| Followers dispatcher      | Backed by the `fediverse-follower` content type                                                                                                                         |
| Inbox listeners           | `Follow`, `Undo(Follow)`, `Block`, `Create(Note)`, `Update(Note)`, `Delete(Note)`, `Like`, `Announce` + `Undo`                                                          |
| Services                  | `article-federation`, `reply-ingest`, `interactions`, `followers`                                                                                                       |

### Plugin content types

| Content type                    | Fields                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `plugin::fediverse.follower`    | `actorId` (string, unique, AP actor URI), `handle` (`@user@host`), `name`, `inbox`, `avatar`, `blocked` (boolean)                  |
| `plugin::fediverse.interaction` | `type` (enum `like`/`boost`), `actorId`, `handle`, `article` (manyToOne → `api::article.article`); unique (type, actorId, article) |

### Comment schema extension

`src/extensions/comments/content-types/comment/schema.json` — extends `strapi-plugin-comments` with:

| Field                  | Purpose                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| `fediverseUri`         | Remote Note object id (unique) — dedupe of ingested replies + thread resolution |
| `fediverseActorHandle` | `@user@host` of the remote author (display/source badge on frontend)            |

### Custom public route

`GET /api/fediverse/articles/:documentId/stats` → `{ likes: number, boosts: number }` (`auth: false`) so the frontend can render counts without plugin permissions.

### Dependencies

- `@fedify/fedify` (pin exact 2.x version — the framework moves fast)
- `@fedify/koa` (Koa v2/v3 middleware)

### Environment variables

| Variable                     | Default                 | Purpose                                                     |
| ---------------------------- | ----------------------- | ----------------------------------------------------------- |
| `FEDIVERSE_ENABLED`          | `false`                 | Master switch (enable explicitly, e.g. staging before prod) |
| `FEDIVERSE_ACTOR_IDENTIFIER` | `devbog`                | Actor username → `@devbog@api.bogdev.com.co`                |
| `FRONTEND_URL`               | `https://bogdev.com.co` | Human-facing `url` embedded in federated `Article` objects  |
| `FRONTEND_ARTICLE_PATH`      | `/blog/{slug}`          | Article URL pattern (confirm against the frontend repo)     |

### KV store

Fedify needs a `kv` for caches and inbox idempotency. **MVP: `MemoryKvStore`** — all persistent state (followers, keys, interactions, comments) lives in Strapi content types, so a restart only loses caches. Comment ingestion dedupes by `fediverseUri` regardless, so no duplicate comments can occur across restarts. Upgrade path: `@fedify/postgres` (note: it opens a second pool — watch Neon connection limits) or `@fedify/redis`.

---

## Federation Flows

### 1. Follow

1. Remote user searches `@devbog@api.bogdev.com.co` → WebFinger resolves → actor profile shown.
2. Inbox receives `Follow` → create `fediverse-follower` row → auto-send signed `Accept`.
3. `Undo(Follow)` or incoming `Block` → remove follower. Admin sets `blocked: true` → excluded from fan-out, their activities ignored.

### 2. Publish / update / delete articles

1. Plugin `bootstrap()` subscribes via `strapi.eventHub.on(...)`: `entry.publish` / `entry.unpublish` for publish state (payload `{ model, uid, entry }` with the sanitized entry), plus `entry.update` / `entry.delete` for edits and removals. Events fire **asynchronously, after the operation's transaction commits** — handlers must not assume the DB still holds the pre-operation state.
2. `entry.publish` → build `Article` object → signed `Create(Article)` fan-out to all accepted followers.
3. Mastodon renders `Article` as a link card (title, excerpt, cover image from `resources.bogdev.com.co`, link to frontend).
4. `Update(Article)` on content edits; `Delete(Article)` on unpublish/delete.
5. Article AP id is stable: `/fediverse/articles/{documentId}`.
6. **i18n:** only the default locale federates in the MVP.

### 3. Reply → comment

1. Inbox receives `Create(Note)` with `inReplyTo` pointing at:
   - our article AP id (`/fediverse/articles/{documentId}`) → top-level comment, or
   - the frontend article URL pattern (some clients use `url`), or
   - another note's URI matching a stored comment's `fediverseUri` → `threadOf` = that comment (one-hop resolution; unresolvable → attach as top-level, log warning).
2. Create `plugin::comments.comment` via `strapi.documents()`:

| Comment field          | Source                                                                     |
| ---------------------- | -------------------------------------------------------------------------- |
| `content`              | Remote Note content, sanitized to plain text (strip HTML)                  |
| `authorName`           | Actor `name` or `preferredUsername@host`                                   |
| `authorAvatar`         | Actor `icon.url`                                                           |
| `threadOf`             | Resolved parent (see above), else `null`                                   |
| `approvalStatus`       | `PENDING` — **the existing approval workflow moderates fediverse replies** |
| `fediverseUri`         | Note object id (dedupe key)                                                |
| `fediverseActorHandle` | `@user@host`                                                               |

3. Dedupe: skip if a comment with the same `fediverseUri` exists.
4. `Update(Note)` → edit comment content; `Delete(Note)` → set `removed`.
5. Admin approves/rejects in the existing comments moderation view — no new admin UI needed.

### 4. Likes & boosts

1. Inbox receives `Like(Article)` → upsert `fediverse-interaction` (type `like`).
2. `Announce(Article)` → upsert type `boost`.
3. `Undo(Like)` / `Undo(Announce)` → remove the row.
4. Stats endpoint aggregates counts for the frontend.

---

## Moderation & Security

- **Signature verification:** Fedify verifies HTTP signatures before listeners run — unsigned/forged activities never reach ingestion code.
- **Content sanitization:** remote Note content is HTML from untrusted servers — strip to plain text before storing.
- **Moderation:** all fediverse replies enter `PENDING` (existing `approvalScores` workflow in `config/plugins.ts`); followers can be `blocked`.
- **Public API surface unchanged:** fediverse endpoints are handled by Fedify's middleware outside Strapi's auth/permissions; the only new public REST route is the stats endpoint (`auth: false`). No seed/permission changes required.
- **SSRF:** Fedify fetches remote objects (standard fediverse behavior); keep Fedify updated to benefit from its fetch hardening.

---

## Risks & Mitigations

| #   | Risk                                                                                                                                                                                                                         | Mitigation                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Middleware ordering in Strapi's Koa stack** — Fedify middleware must intercept `/.well-known/*` and `/fediverse/*` before `strapi::router`, and ideally before `strapi::body` (raw body needed for signature verification) | **Resolved in Phase 0:** mounting via `strapi.server.use()` inside plugin `register()` runs before `initMiddlewares()` (so before `strapi::body`) and before the router (mounted at `listen()`). No fallback needed                                |
| 2   | **Comments schema extension** — extension fields could be dropped by the plugin's own services                                                                                                                               | Create/update comments via `strapi.documents('plugin::comments.comment')` directly; verify merge in Phase 3                                                                                                                                        |
| 3   | **Strapi 5 publish lifecycles** — confirm `afterPublish`/`afterUnpublish` fire via `strapi.db.lifecycles.subscribe`                                                                                                          | **Resolved in Phase 0:** they do **not**. Publish maps to `afterCreate` and unpublish to `afterDelete` at the DB layer; publish state changes are only observable via `strapi.eventHub` (`entry.publish` / `entry.unpublish`), emitted post-commit |
| 4   | **Fedify version churn**                                                                                                                                                                                                     | Pin exact 2.x versions in `package.json`                                                                                                                                                                                                           |
| 5   | **Neon connection limits** (only if Postgres KV is added later)                                                                                                                                                              | MVP uses `MemoryKvStore`; persistent state lives in Strapi content types                                                                                                                                                                           |

---

## Implementation Phases

Tracked as GitHub issues under the `fediverse-federation` milestone. Check off as completed.

### Phase 0 — Spike: mount Fedify in Strapi `[x]` (#3)

- [x] Local plugin skeleton + `@fedify/fedify`@2.3.6 / `@fedify/koa`@2.3.6 (pinned exact) installed and mounted via `strapi.server.use()` in `register()`
- [x] Verify `/.well-known/webfinger` responds on `npm run dev` (200 JRD, correct subject + self link)
- [x] Verify inbox `POST` is intercepted: unsigned and forged-signature deliveries are rejected with `401 Failed to verify the request signature.` **before any listener runs** (full signed delivery from a real server is verified manually in Phase 1 via a follow from activitypub.academy)
- [x] Resolve middleware-ordering risk (#1) — primary strategy confirmed, no fallback needed
- [x] Confirm publish lifecycle events (risk #3) — via `strapi.eventHub`, see below

**Phase 0 findings (binding for later phases):**

- **Plugin loading (Strapi 5):** local plugins are loaded through `loadConfigFile`, which only reads `.js`/`.json` — the plugin entry must be compiled JS. The root `tsconfig.json` excludes `src/plugins/**`, so the plugin ships its own esbuild bundle (`npm run build:fediverse`, wired into `predev`/`prebuild`/`pretest`). The plugin `package.json` must have **no `main` field** (it breaks the loader's `require.resolve` path) — only `exports: { "./strapi-server": "./dist/strapi-server.js", "./package.json": "./package.json" }` plus the `strapi.kind`/`strapi.name` marker.
- **Middleware order:** `strapi.server.use()` in plugin `register()` runs before `initMiddlewares()` (hence before `strapi::body`, whose parsed body would starve Fedify's raw-body signature verification) and before the router (mounted at `listen()`). Mounting in `bootstrap()` would be too late.
- **Publish events:** Strapi 5 emits `entry.publish`/`entry.unpublish`/`entry.update`/`entry.delete` on `strapi.eventHub` (payload `{ model, uid, entry }`, sanitized full entry), **asynchronously after the operation's transaction commits**. `strapi.db.lifecycles` only sees the underlying row CRUD (`afterCreate` for publish, `afterDelete` for unpublish) and cannot distinguish publish state. Phase 2 fan-out subscribes to `eventHub`.
- **Fedify 2.x API notes:** vocabulary types import from the `@fedify/fedify/vocab` subpath; `setKeyPairsDispatcher` takes a single `(contextData, identifier)` signature; `Person.assertionMethods` must be `keyPair.multikey` (a `Multikey`), not `cryptographicKey`.
- **Jest:** `@fedify/fedify` requires `structured-field-values`, an ESM-only `.js` package. Node ≥22 `require()`s it fine (dev/prod), but Jest cannot — `jest.config.js` now uses an esbuild transformer (`tests/helpers/esbuild-transformer.js`) with `transformIgnorePatterns` allowlisting that package.
- **Spike scope:** keypairs are in-memory (regenerated per boot — fine for the spike); Phase 1 persists them in the plugin store. `tests/fediverse.test.js` covers webfinger, actor document, content negotiation, unknown actor, unsigned inbox rejection, `/_health` isolation, and publish/unpublish event delivery.

### Phase 1 — Blog actor, keypairs, followers `[ ]` (#4)

- [ ] Actor dispatcher (profile from `global`/`about`), keypair generation + plugin-store persistence
- [ ] `fediverse-follower` content type; `Follow` → record + signed `Accept`; `Undo(Follow)`/`Block` → remove; `blocked` flag
- [ ] Followers collection + NodeInfo
- [ ] Verify: search `@devbog@api.bogdev.com.co` from a Mastodon account and follow successfully

### Phase 2 — Article federation `[ ]` (#5)

- [ ] Article object dispatcher (`/fediverse/articles/:documentId`, stable ids, frontend `url`, cover image)
- [ ] `entry.publish` → `Create(Article)` fan-out; `Update(Article)` on edit; `Delete(Article)` on unpublish/delete
- [ ] Verify: article appears in a follower's timeline as a link card

### Phase 3 — Fediverse replies → moderated comments `[ ]` (#6)

- [ ] Comment schema extension (`fediverseUri`, `fediverseActorHandle`)
- [ ] `reply-ingest` service: `Create(Note)` → comment with mapping table above; dedupe; one-hop `threadOf` resolution; plain-text sanitization
- [ ] `Update(Note)` → edit; `Delete(Note)` → `removed`
- [ ] Verify: reply from Mastodon → `PENDING` comment → approve → visible via comments REST API

### Phase 4 — Likes & boosts `[ ]` (#7)

- [ ] `fediverse-interaction` content type; `Like`/`Announce` + `Undo` handlers
- [ ] `GET /api/fediverse/articles/:documentId/stats` public route
- [ ] Verify: like/boost from Mastodon moves the counts

### Phase 5 — Tests, lint, docs, deployment `[ ]` (#8)

- [ ] Supertest coverage: webfinger, actor, stats routes; reply→comment mapping unit tests (existing Jest + isolated SQLite harness)
- [ ] `npm run lint`, `npm run typecheck`, `npm run test` green
- [ ] Update this document's status markers; add `.opencode/skills/strapi-fediverse/SKILL.md`
- [ ] Deployment notes: env vars (`FEDIVERSE_ENABLED`, `FRONTEND_URL`, ...) in `docs/CI_CD.md`/Dokploy config — no proxy changes required

---

## Future Work (Out of Scope for MVP)

- Locale-specific federation objects (`inLanguage` fan-out, per-locale handles)
- Blog-actor outbound replies into remote threads (admin replies federate back to Mastodon)
- `fediverse:creator` author attribution
- Admin UI panel in Strapi admin
- Postgres/Redis KV upgrade
- WebFinger on the frontend domain (`@devbog@bogdev.com.co`) via Dokploy proxy

---

## References

- [Fedify — ActivityPub server framework for TypeScript](https://fedify.dev) | [GitHub](https://github.com/fedify-dev/fedify)
- [Fedify × Koa integration docs](https://fedify.dev/manual/integration)
- [Fedify tutorial: Building a federated blog](https://fedify.dev/tutorial/blog) (actor setup, followers, `Create(Article)` on publish, replies as comments)
- [TryGhost/ActivityPub](https://github.com/TryGhost/ActivityPub) — Ghost's Fedify-based multi-tenant ActivityPub service (precedent)
- [Ghost's "Building ActivityPub" build log](https://activitypub.ghost.org) — practical federation lessons
- [Mastodon ActivityPub spec](https://docs.joinmastodon.org/spec/activitypub)
- [W3C ActivityPub](https://www.w3.org/TR/activitypub/) / [Activity Streams 2.0](https://www.w3.org/TR/activitystreams-core/)
- [Strapi 5 Server API — server-level middleware via `strapi.server.use()`](https://docs.strapi.io/cms/plugins-development/server-lifecycle)
