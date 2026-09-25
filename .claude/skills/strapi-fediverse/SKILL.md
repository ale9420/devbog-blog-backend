---
name: strapi-fediverse
description: Use when working on the ActivityPub/fediverse federation of the BogDev blog — the src/plugins/fediverse plugin, Fedify, followers, article federation, replies as comments, likes/boosts, the stats endpoint, FEDIVERSE_* env vars, or testing federation locally and on staging.
---

# Strapi Fediverse Skill

The blog is an ActivityPub actor (`@devbog@<api domain>`) served by a local Strapi plugin built on **Fedify**. Read `docs/FEDIVERSE.md` first: it is the architecture doc and records the findings behind every non-obvious decision. This skill is the quick map.

## When to use this skill

- Changing anything under `src/plugins/fediverse/`, `src/extensions/comments/`, or `src/middlewares/hide-unapproved-comments.ts`.
- Adding an activity type, a dispatcher, or a public route for federation.
- Debugging "the post never reached Mastodon", missing followers, or wrong URLs in activities.
- Enabling or configuring federation in an environment.

## Where things are

| Path (under `src/plugins/fediverse/server/src/`) | Responsibility                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `index.ts`                                       | Plugin entry: mounts the Fedify middleware in `register()`, subscribes the publisher in `bootstrap()`       |
| `federation.ts`                                  | Fedify `Federation`: actor, keys, followers, outbox, article object, NodeInfo dispatchers + inbox listeners |
| `services/articles.ts`                           | Loads published default-locale articles, builds `Article`/`Create`/`Update`/`Delete`, frontend URLs         |
| `services/publisher.ts`                          | `entry.publish/unpublish/delete` → fan-out to followers                                                     |
| `services/replies.ts`                            | `Create/Update/Delete(Note)` → moderated comments; HTML → plain text                                        |
| `services/interactions.ts`                       | Likes/boosts, dedupe, counts                                                                                |
| `services/{followers,keys,actor-profile}.ts`     | Follower rows, persisted actor key pair, actor name/bio from `global`/`about`                               |
| `services/stats.ts`                              | Batch counts and ranking as aggregate SQL (likes, boosts, approved fediverse replies)                       |
| `controllers/stats.ts`, `routes/`                | `GET /api/fediverse/articles/:documentId/stats`, `/articles/stats`, `/articles/ranking`                     |

Outside the plugin: `src/extensions/comments/strapi-server.ts` (adds `fediverseUri`, `fediverseActorHandle`) and `src/middlewares/hide-unapproved-comments.ts`.

The plugin is its own TypeScript project bundled by esbuild (`npm run build:fediverse`, run by the `pre*` hooks). After editing plugin code, rebuild before using `npx jest` directly.

## Environment variables

| Variable                                           | Default                 | Notes                                                                                    |
| -------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `FEDIVERSE_ENABLED`                                | `false`                 | Master switch, read at boot by `config/plugins.ts`. Off = no routes, no content types    |
| `URL`                                              | `http://localhost:1337` | Strapi's public origin. Activity ids built outside a request come from it: keep it right |
| `FEDIVERSE_ACTOR_IDENTIFIER`                       | `devbog`                | The `@user` part. Changing it after people follow breaks their follows                   |
| `FEDIVERSE_ACTOR_NAME` / `FEDIVERSE_ACTOR_SUMMARY` | unset                   | Fallbacks when `global`/`about` have no name/description                                 |
| `FRONTEND_URL`                                     | `https://bogdev.com.co` | Origin of the human-facing article links                                                 |
| `FRONTEND_ARTICLE_PATH`                            | `/blog/{slug}`          | Article path template                                                                    |
| `FRONTEND_DEFAULT_LOCALE`                          | `en`                    | Locale the frontend serves unprefixed; other locales get `/<locale>` in their links      |

## Endpoints

Served by Fedify, outside Strapi auth: `/.well-known/webfinger`, `/nodeinfo/2.1`, `/fediverse/user/:id` (actor), `/fediverse/user/:id/{inbox,outbox,followers}`, `/fediverse/inbox`, `/fediverse/articles/:documentId`. Public Strapi routes (aggregates only, cached 60 s where noted in `docs/FEDIVERSE.md`): `GET /api/fediverse/articles/:documentId/stats` → `{ likes, boosts }` (404 for unpublished); `GET /api/fediverse/articles/stats?documentIds=a,b,c` → `{ [documentId]: { likes, boosts, replies } }` (max 50); `GET /api/fediverse/articles/ranking?page&pageSize&locale` → most discussed first.

## How it behaves

- **Follow:** `Follow` → follower row + signed `Accept`. `Undo(Follow)`/`Block` remove it. A blocked actor's activities are ignored and their interactions stop counting.
- **Articles:** publishing sends `Create(Article)` (public `to`, followers in `cc`); publishing an already-sent article again is an `Update`; unpublish/delete is a `Delete`. Only the default locale, only published, and only articles with a `slug`. Each fan-out logs how many followers it reached (`no followers yet` means nothing was sent).
- **Replies:** a `Create(Note)` replying to an article (by ActivityPub id or frontend URL) or to a stored reply becomes a `PENDING` comment. Content is stripped to plain text. Edits go back to `PENDING`; deletes set `removed`. Anything else is ignored.
- **Moderation:** approve/reject in the admin comments moderation view. The global middleware hides `PENDING`/`REJECTED` comments from `GET /api/comments/*`; never remove it.
- **Likes/boosts:** `Like`/`Announce` of a published article are recorded once per (type, actor, article); `Undo` removes only the sender's own.

## Pitfalls that cost time before

- Strapi's `unique: true` creates **no database index**; `db.query` can insert duplicates. Dedupe after insert if a race matters (see `services/interactions.ts`).
- `strapi-plugin-comments` config keys other than `enabledCollections` are inert, and its public API shows pending comments unless the middleware hides them. Extend its schema through `strapi-server.ts`, never with an extension `schema.json` (shallow merge replaces all attributes).
- Behind Traefik `config/server.ts` needs `proxy: { koa: true }`, or every generated URL is `http://`.
- Only the outer activity's actor is signature-verified: check embedded actors/authors against it (`Undo`, `Note.attributedTo`).
- The document service does not autogenerate `slug` (only the admin UI does); articles without one are skipped with a warning.
- Fedify reports delivery errors through LogTape (unconfigured); `onOutboxError`/inbox `onError` write them to Strapi's log — look for `[fediverse]` lines.
- The Fedify Koa middleware must only run for federation paths (`/fediverse/*`, `/.well-known/*`, `/nodeinfo/*`): it consumes the request stream of every non-GET request it sees, which hangs any large POST/PUT elsewhere (long articles in the admin). Keep the path guard in `mountFediverseMiddleware`.
- A staging database that is wiped on deploy drops followers and regenerates the actor key. `/app/.tmp` must be a persistent volume.

## Testing

```bash
npm test                     # all suites, SQLite, one database file per Jest worker
npx jest tests/fediverse-phase3.test.js --forceExit   # one suite (run npm run build:fediverse first)
TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres npm test   # PostgreSQL, as in production
```

- Suites boot a real Strapi; they set `FEDIVERSE_ENABLED` at the top of the file, and `tests/fediverse-disabled.test.js` covers the switched-off case.
- `tests/helpers/remote-actor.js` starts a fake remote server (signed actor + recording inbox); `postSignedActivity()` signs a POST with Fedify's `signRequest`. `allowPrivateAddress` is on only when `NODE_ENV=test`, so 127.0.0.1 actors can be dereferenced.
- Wait for async work with `tests/helpers/wait-until.js`; for "nothing happened" assertions use a short settle delay.
- Same-origin forgery cases matter: Fedify already refuses embedded objects from a different origin, so test forgery with ids on the sender's own origin.

## Testing against the real fediverse

- **Staging** (`staging-api.bogdev.com.co`, see `docs/CI_CD.md`): follow `@devbog@staging-api.bogdev.com.co` from a Mastodon account, publish an article with a slug, reply/like/boost, and read the app logs for `[fediverse]` lines. Do not redeploy between following and publishing unless `/app/.tmp` is persistent.
- **Fedify CLI** (same library as the plugin, so it checks the wire format, not other servers' behaviour): `npx @fedify/cli webfinger @devbog@<domain>`, `npx @fedify/cli lookup @devbog@<domain> <article-url>`, `npx @fedify/cli nodeinfo <domain>`, and `npx @fedify/cli inbox` for an ephemeral inbox behind a tunnel.
- Cross-server behaviour (Pleroma/Akkoma, Misskey, GoToSocial) still needs a manual check against a real instance.

## Do not

- Enable `FEDIVERSE_ENABLED` in an environment whose `URL` is not its real public origin.
- Add a listener that trusts an embedded actor/author without comparing it to the verified sender.
- Show pending comments or interaction actors on a public route.
- Rely on `MemoryKvStore` for anything that must survive a restart.
