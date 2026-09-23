# Fediverse Federation (ActivityPub) Plan & Architecture

This document is the source of truth for connecting the BogDev blog backend to the fediverse, so users on Mastodon (and any other ActivityPub network) can follow the blog, receive published articles in their timeline, and reply, like, and boost — with replies landing as moderated comments in the existing `strapi-plugin-comments` collection.

> **Status: Phases 0 and 1 complete** (Phase 1 verified live: a real Mastodon account followed the staging actor). **Phase 2 (article federation) is implemented and test-covered, pending live verification on staging.** Branch `develop` (staging deploys from it). Implementation is tracked in the [`fediverse-federation` milestone](https://github.com/ale9420/devbog-blog-backend/milestone/1) (one issue per phase, 0–5). Update the phase checklist in this document as work progresses so future agents always see the current state.

## Table of Contents

- [Goal & Decisions](#goal--decisions)
- [Architecture](#architecture)
- [Components](#components)
- [Federation Flows](#federation-flows)
- [Discoverability on Other Networks](#discoverability-on-other-networks)
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

| Part                      | Responsibility                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `register()`              | Create the `Federation` instance and mount `@fedify/koa` middleware via `strapi.server.use()` (must be `register()`, not `bootstrap()` — see Phase 0 findings)                                   |
| `bootstrap()`             | Subscribe to `entry.publish` / `entry.unpublish` on `strapi.eventHub` (Strapi 5 does **not** emit publish lifecycles via `strapi.db.lifecycles` — see Phase 0 findings)                          |
| Actor dispatcher          | Serves `/fediverse/user/devbog` — name/avatar/bio derived from the `global`/`about` single types                                                                                                 |
| Key pairs dispatcher      | Reads keypairs from plugin store (`strapi.store({ type: 'plugin', name: 'fediverse' })`)                                                                                                         |
| Article object dispatcher | Serves `/fediverse/articles/:documentId` as an `Article` (title, excerpt, frontend `url`, cover image, lang)                                                                                     |
| Outbox dispatcher         | Serves `/fediverse/user/devbog/outbox` — paginated, publicly-addressed `Create(Article)` activities, so a remote server can show/backfill recent posts before anyone there has followed the blog |
| Followers dispatcher      | Backed by the `fediverse-follower` content type                                                                                                                                                  |
| NodeInfo dispatcher       | Serves `/nodeinfo/2.1` with honest software/usage stats (published article count)                                                                                                                |
| Inbox listeners           | `Follow`, `Undo(Follow)`, `Block`, `Create(Note)`, `Update(Note)`, `Delete(Note)`, `Like`, `Announce` + `Undo`                                                                                   |
| Services                  | `articles` + `publisher` (Phase 2), `followers`/`keys`/`actor-profile` (Phase 1), `reply-ingest`, `interactions` (planned)                                                                       |

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

| Variable                     | Default                 | Purpose                                                                                                                                                                                 |
| ---------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FEDIVERSE_ENABLED`          | `false`                 | Master switch (enable explicitly, e.g. staging before prod)                                                                                                                             |
| `FEDIVERSE_ACTOR_IDENTIFIER` | `devbog`                | Actor username → `@devbog@api.bogdev.com.co`                                                                                                                                            |
| `FEDIVERSE_ACTOR_NAME`       | _(unset)_               | Actor display name fallback, used only when `global.siteName` and `about.title` are both empty                                                                                          |
| `FEDIVERSE_ACTOR_SUMMARY`    | _(unset)_               | Actor bio fallback, used only when `global.siteDescription` is empty                                                                                                                    |
| `FRONTEND_URL`               | `https://bogdev.com.co` | Human-facing `url` embedded in federated `Article` objects                                                                                                                              |
| `FRONTEND_ARTICLE_PATH`      | `/blog/{slug}`          | Article URL pattern (confirmed against the frontend repo: default locale, `prefix_except_default`)                                                                                      |
| `FRONTEND_DEFAULT_LOCALE`    | `en`                    | Locale the frontend serves without a URL prefix (Nuxt `prefix_except_default`); articles in any other locale get `/<locale>` in their link, e.g. `https://bogdev.com.co/es/blog/{slug}` |

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
2. `entry.publish` → build `Article` object → signed `Create(Article)` addressed **publicly** (`to: https://www.w3.org/ns/activitystreams#Public`, `cc:` the followers collection) and delivered to every accepted follower's inbox. Public addressing — not just `cc` to followers — is what makes the post eligible for a remote instance's local/federated timeline and public directories; addressing it only to followers would silently cap reach at people who already follow the blog, which undermines the "consumed on other networks" goal (see [Discoverability on Other Networks](#discoverability-on-other-networks)).
3. The same `Create(Article)` activities are also served from a public **outbox dispatcher** (`/fediverse/user/devbog/outbox`, paginated), so a remote server that discovers the actor — e.g. someone views the profile before deciding to follow — can backfill recent posts. Several Mastodon-derived UIs fetch the outbox on first contact with an unfollowed account.
4. Mastodon renders `Article` as a link card (title, excerpt, cover image from `resources.bogdev.com.co`, link to frontend).
5. `Update(Article)` on content edits; `Delete(Article)` on unpublish/delete.
6. Article AP id is stable: `/fediverse/articles/{documentId}`.
7. **i18n:** only the default locale federates in the MVP.

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

## Discoverability on Other Networks

The MVP's technical mechanism is accepting `Follow`s and fanning out to followers, but the actual goal — blog content **consumed on other social networks**, not only by people who already follow the blog — needs a bit more than that:

- **Public addressing** (Federation Flows §2) is required for posts to land in a remote instance's local/federated timeline and directories, not just in individual followers' home feeds. This is a correctness requirement for Phase 2, not a nice-to-have — without it, federation "works" (followers see posts) but the blog is effectively invisible to everyone else on that instance.
- **Outbox dispatcher** (`/fediverse/user/devbog/outbox`) lets remote servers and apps enumerate recent posts without requiring a follow first. The architecture diagram already lists this endpoint; the phase checklists below now call it out explicitly so it doesn't get skipped as "just an implementation detail" of the actor dispatcher.
- **`discoverable` actor flag** (`toot:discoverable: true`, from Mastodon's `toot` vocabulary extension namespace): opts the actor into Mastodon's public directory and "suggested accounts." Cheap to add to the `Person` object once the actor dispatcher exists — tracked as a Phase 1 task.
- **Cross-server verification**: ActivityPub implementations diverge in how they parse `Article` and `Person` objects. Mastodon is the reference target, but Pleroma/Akkoma, Misskey, Friendica, and GoToSocial are all realistic destinations for this blog's followers, and Meta's Threads has historically shipped partial/limited outbound federation. Before declaring the MVP done, verify against at least one non-Mastodon server (Phase 5), not only Mastodon accounts / activitypub.academy.
- **Fediverse relays** (submitting the actor's public posts to a relay so instances with no existing followers of this domain still see them) are a plausible reach multiplier beyond direct follows, but out of scope for the MVP — tracked under Future Work.

---

## Moderation & Security

- **Signature verification:** Fedify verifies HTTP signatures before listeners run — unsigned/forged activities never reach ingestion code.
- **Content sanitization:** remote Note content is HTML from untrusted servers — strip to plain text before storing.
- **Moderation:** all fediverse replies enter `PENDING` (existing `approvalScores` workflow in `config/plugins.ts`); followers can be `blocked`.
- **Public API surface unchanged:** fediverse endpoints are handled by Fedify's middleware outside Strapi's auth/permissions; the only new public REST route is the stats endpoint (`auth: false`). No seed/permission changes required.
- **SSRF:** Fedify fetches remote objects (standard fediverse behavior); keep Fedify updated to benefit from its fetch hardening.

---

## Risks & Mitigations

| #   | Risk                                                                                                                                                                                                                                                   | Mitigation                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Middleware ordering in Strapi's Koa stack** — Fedify middleware must intercept `/.well-known/*` and `/fediverse/*` before `strapi::router`, and ideally before `strapi::body` (raw body needed for signature verification)                           | **Resolved in Phase 0:** mounting via `strapi.server.use()` inside plugin `register()` runs before `initMiddlewares()` (so before `strapi::body`) and before the router (mounted at `listen()`). No fallback needed                                |
| 2   | **Comments schema extension** — extension fields could be dropped by the plugin's own services                                                                                                                                                         | Create/update comments via `strapi.documents('plugin::comments.comment')` directly; verify merge in Phase 3                                                                                                                                        |
| 3   | **Strapi 5 publish lifecycles** — confirm `afterPublish`/`afterUnpublish` fire via `strapi.db.lifecycles.subscribe`                                                                                                                                    | **Resolved in Phase 0:** they do **not**. Publish maps to `afterCreate` and unpublish to `afterDelete` at the DB layer; publish state changes are only observable via `strapi.eventHub` (`entry.publish` / `entry.unpublish`), emitted post-commit |
| 4   | **Fedify version churn**                                                                                                                                                                                                                               | Pin exact 2.x versions in `package.json`                                                                                                                                                                                                           |
| 5   | **Neon connection limits** (only if Postgres KV is added later)                                                                                                                                                                                        | MVP uses `MemoryKvStore`; persistent state lives in Strapi content types                                                                                                                                                                           |
| 6   | **Followers-only addressing silently caps reach** — if `Create(Article)` is only `cc`'d to followers (no public `to`), posts never reach federated/local timelines or directories on remote instances, defeating the "consumed on other networks" goal | Address publicly (`to: as:Public`) per Federation Flows §2, and implement the outbox dispatcher so a visitor who hasn't followed yet can still see posts — see [Discoverability on Other Networks](#discoverability-on-other-networks)             |

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

### Phase 1 — Blog actor, keypairs, followers `[x]` (#4)

- [x] Actor dispatcher (profile from `global`/`about`), keypair generation + plugin-store persistence
- [x] `fediverse-follower` content type; `Follow` → record + signed `Accept`; `Undo(Follow)`/`Block` → remove; `blocked` flag
- [x] Followers collection + NodeInfo
- [x] Actor opts into Mastodon's directory (`toot:discoverable: true`) — see [Discoverability on Other Networks](#discoverability-on-other-networks)
- [x] Verify: search `@devbog@api.bogdev.com.co` from a Mastodon account and follow successfully

**Phase 1 findings (verified 2026-09-23 against a live Mastodon account on `staging-api.bogdev.com.co`):** the actor dispatcher (now `discoverable: true`), RSA keypair generation + JWK persistence in the plugin store, the `fediverse-follower` content type, the followers dispatcher/counter, NodeInfo, and the `Follow`/`Undo`/`Block` inbox listeners (with signed `Accept`) live in `federation.ts` and `services/{keys,actor-profile,followers}.ts`. `tests/fediverse-phase1.test.js` covers them end-to-end, including a fully HTTP-signed `Follow` → `Accept` round trip against a fake remote actor (`tests/helpers/remote-actor.js`).

- **Behind Traefik, Koa must trust the proxy.** Strapi 5 reads `server.proxy.koa`; the old `proxy: true` (Strapi 4 syntax) left `ctx.protocol` as `http`, and `@fedify/koa` builds request URLs from it, so every ActivityPub id came out as `http://`. `config/server.ts` now sets `proxy: { koa: true }` (regression test included). Any new federated URL must be checked over HTTPS on staging, not only locally.
- **Staging** is the live test bed: `develop` → `:staging` image / Dokploy app on `staging-api.bogdev.com.co` (see `docs/CI_CD.md`). It needs `URL`, `FEDIVERSE_ENABLED=true` and `DATABASE_CLIENT=sqlite`; the app builds via Nixpacks (`npm start`), so `public/uploads` is created by the `prestart` script.

### Phase 2 — Article federation `[~]` (#5)

- [x] Article object dispatcher (`/fediverse/articles/:documentId`, stable ids, frontend `url`, cover image)
- [x] Outbox dispatcher (`/fediverse/user/devbog/outbox`, paginated), backed by the published articles, so remote servers can backfill posts without a prior follow
- [x] `entry.publish` → `Create(Article)` addressed **publicly** (`to: as:Public`, `cc:` followers) and fanned out to all accepted followers' inboxes; `Update(Article)` on re-publish; `Delete(Article)` on unpublish/delete
- [ ] Verify: article appears in a follower's timeline as a link card, **and** on the actor's public profile/outbox when viewed from an account that does not follow it

**Phase 2 findings:**

- **Code layout:** `services/articles.ts` (loading published default-locale articles, building `Article`/`Create`/`Update`/`Delete`, tracking which articles were federated) and `services/publisher.ts` (subscribes to `entry.publish` / `entry.unpublish` / `entry.delete` and sends to `'followers'`). The `Federation` instance is now one per Strapi instance (`getFederation(strapi)`), shared by the HTTP middleware and the publisher. `tests/fediverse-phase2.test.js` covers the dispatcher, outbox, and the fan-out against a fake remote inbox.
- **Editing = publishing again.** In Strapi 5 an edit only reaches the published version when the editor publishes it, which fires `entry.publish` again. The plugin store key `federatedArticles` records which documents already had a `Create` sent, so the second publish becomes `Update(Article)` instead of a duplicate `Create`. Articles published while the plugin was disabled are never retro-federated (no event, no record).
- **Delete is guarded.** Unpublish and delete both send `Delete(Article)` (with a `Tombstone`), but only if the article was federated _and_ no published default-locale version remains, so deleting a draft revision doesn't retract a live article.
- **Body shape.** `content` is self-contained HTML (bold title, escaped excerpt, link to the frontend) so it reads well on servers that ignore `name`/`image`, and the link lets Mastodon build a preview card. `summary` is intentionally **not** set — Mastodon renders it as a content warning. `image` (the cover) is used instead of an attachment so Mastodon keeps the link card rather than showing a bare media attachment. **This rendering is a hypothesis until verified live on Mastodon** (the last unchecked item).
- **Frontend URLs are locale-aware.** The frontend serves `en` unprefixed and `es` under `/es` (`prefix_except_default`), and the article page loads the post for the _current_ locale. The federated link therefore gets `/<locale>` whenever the article's locale differs from `FRONTEND_DEFAULT_LOCALE`; if Strapi's default locale is `es`, links become `https://bogdev.com.co/es/blog/{slug}`.
- **Delivery failures are logged.** Fedify reports outbox/inbox failures through LogTape, which isn't configured, so a rejected delivery (for example Mastodon answering 401/422) used to leave no trace. `onOutboxError` and the inbox `onError` now write `[fediverse] ...` entries to Strapi's log — look there first when a post doesn't reach a timeline.
- **Publish logs say who received it.** Each fan-out logs `[fediverse] Create(Article) for <id> (<slug>): delivered to N followers` or `no followers yet, nothing delivered`; with no followers nothing is sent at all. "The article never reached my timeline" is usually a missing follow — check that line first.
- **Staging state must persist.** Followers, the actor key pair and federated-article records live in the SQLite database. If `/app/.tmp` isn't a persistent volume, every deploy regenerates the actor key and drops all followers (visible as `hasAdmin: false` on `/admin/init` and a `generated and persisted a new actor key pair` log line), and remote servers keep a follow and a cached key that no longer match.
- **Background context origin.** Work not tied to a request (the publisher) builds ids from Strapi's public `URL` (`strapi.config.get('server.url')`), so `URL` must be correct in every deployed environment or activity ids will not match the ones served over HTTP.
- **`slug` is not autogenerated by the document service** (only by the admin UI). Articles without a slug or title are skipped with a `[fediverse] not federating article ...` warning, because there would be no frontend URL to link to. Tests must pass `slug` explicitly.
- **Test harness fix:** `tests/strapi.js` passed an absolute `DATABASE_FILENAME`, but `config/database.ts` joins it to the project root, so the real SQLite file landed in a stray `home/...` directory the harness never cleaned. Stale rows leaked between runs and eventually pushed articles off the first API page. The path is now relative to the project root.

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
- [ ] Cross-server verification against at least one non-Mastodon implementation (Pleroma/Akkoma, Misskey, or GoToSocial), not only Mastodon/activitypub.academy — see [Discoverability on Other Networks](#discoverability-on-other-networks)
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
- Fediverse relay submission for reach beyond direct followers

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
