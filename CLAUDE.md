# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A more detailed `AGENTS.md` already exists in this repo with naming conventions and Strapi API patterns — read it for anything not covered here. Project skills live in `.claude/skills/` (content types, API consumers, media, seeding, deployment, subscribers, comments) and MCP servers (Strapi, Dokploy) are declared in `.mcp.json`; their secrets are read from `~/.claude/secrets/`, never from the repo.

## Project

Strapi 5 (TypeScript) headless CMS backend for the BogDev blog, deployed as a Docker image to a Hetzner VPS via Dokploy (see `docs/CI_CD.md`). Production DB is Neon Tech PostgreSQL; local dev defaults to SQLite.

## Commands

```bash
npm run develop         # dev server with hot reload (alias: dev)
npm run start           # production server, no reload
npm run build           # build the admin panel
npm run typecheck       # tsc --noEmit for root, then again for the fediverse plugin (two separate projects)
npm run lint / lint:fix
npm run format / format:check
npm run test             # jest --forceExit --detectOpenHandles
npm run test:watch
npm run generate:keys    # generate Strapi secrets into .env
npm run seed:example     # run scripts/seed.js
```

Run a single test file: `npx jest tests/fediverse.test.js` (matches `**/tests/**/*.test.js`).

**`build:fediverse` runs automatically** as a `pre*` hook (`predev`, `predevelop`, `prebuild`, `pretest`) — it esbuild-bundles `src/plugins/fediverse/server/src/index.ts` into `src/plugins/fediverse/dist/strapi-server.js`. This is necessary because the fediverse plugin is its own TypeScript project (`src/plugins/fediverse/tsconfig.json`), excluded from the root `tsconfig.json` compilation, and depends on ESM-only packages (`@fedify/*`) that Strapi's own CJS build pipeline can't handle directly. If you edit plugin source and don't see changes, check that this bundle step ran.

## Architecture

**Standard Strapi content types** live in `src/api/<name>/{content-types,controllers,routes,services}`, generated via `strapi generate` or hand-written using `factories.createCoreController/Service/Router`. Business logic beyond CRUD goes in `services/`. `config/plugins.ts` wires up `strapi-plugin-comments`, `@notum-cz/strapi-plugin-seo`, and conditionally an S3-compatible (Cloudflare R2) vs. local upload provider based on whether `R2_BUCKET` is set.

**The `fediverse` plugin** (`src/plugins/fediverse/`) is a local Strapi plugin (not a workspace package) implementing ActivityPub federation with `@fedify/fedify` + `@fedify/koa`. It is gated by `FEDIVERSE_ENABLED` (default `false`) in `config/plugins.ts`. Before touching it, or `src/extensions/comments/` (which adds `fediverseUri`/`fediverseActorHandle` fields to the comments schema for reply ingestion/dedupe), read `docs/FEDIVERSE.md` — it's the living architecture doc and phase tracker (phases 0–5, tracked via GitHub milestone), and records non-obvious findings, e.g.:

- Fedify's middleware is mounted in plugin `register()` (not `bootstrap()`), via `strapi.server.use()` directly — this must run before Strapi's `initMiddlewares()` mounts `strapi::body`, since HTTP signature verification needs the raw request body, and before the router mounts at `listen()` time.
- Strapi 5 does **not** emit `afterPublish`/`afterUnpublish` through `strapi.db.lifecycles`; publish/unpublish state is only observable via `strapi.eventHub` (`entry.publish` / `entry.unpublish`), fired asynchronously after the transaction commits.
- All federation state that must survive a restart (followers, actor keys, interactions) is stored in Strapi content types, not Fedify's `MemoryKvStore` (which only backs transient caches/idempotency).
- Strapi's `unique: true` is only Document Service validation — there is no database index, so `db.query` writes can create duplicates. Race-prone inserts (see `services/interactions.ts`) dedupe after inserting.
- The Fedify Koa middleware is guarded to federation paths only (`mountFediverseMiddleware`): unguarded, it stalls any non-GET request with a body over ~16 KB on other routes, because it consumes the request stream before `strapi::body` can.
- Behind Traefik, `config/server.ts` needs `proxy: { koa: true }`; otherwise `ctx.protocol` is `http` and every ActivityPub URL is generated with the wrong scheme.
- `strapi-plugin-comments` returns pending comments from its public endpoints; `src/middlewares/hide-unapproved-comments.ts` hides them. Extend the comments schema through `src/extensions/comments/strapi-server.ts` (a `schema.json` would replace all the plugin's attributes). Most keys in the `comments` block of `config/plugins.ts` are inert.
- Fediverse code paths are split across `federation.ts` (Fedify dispatchers and inbox listeners) and `services/` (`articles`, `publisher`, `replies`, `interactions`, `followers`, `keys`, `actor-profile`); `docs/FEDIVERSE.md` has the per-phase findings.

**Testing** (`tests/`) boots a real Strapi instance per suite (`tests/strapi.js`) against an isolated SQLite file per Jest worker (`.tmp/test-<worker>.db`; `DATABASE_FILENAME` must stay relative to the project root), not mocks — `setupStrapi()`/`cleanupStrapi()` in `beforeAll`/`afterAll`. Jest transforms TS/JS via `tests/helpers/esbuild-transformer.js` and selectively transforms the `structured-field-values` package inside `node_modules` (an ESM-only transitive dependency of Fedify that Jest can't `require()` natively). Fediverse tests force `FEDIVERSE_ENABLED=true` before Strapi boots since env vars are read at plugin-registration time, and run against `tests/helpers/remote-actor.js`, a fake remote server that serves a signed actor and records what the plugin delivers to its inbox (`allowPrivateAddress` is enabled only when `NODE_ENV=test`). Run `npm run build:fediverse` first when using `npx jest` directly — the `pretest` hook only runs with `npm test`.

## Deployment

`main` deploys to production (`api.bogdev.com.co`) and `develop` to staging (`staging-api.bogdev.com.co`): `.github/workflows/deploy.yml` builds and pushes a Docker image to GHCR and calls the Dokploy API on the Hetzner VPS behind Traefik, health-checked at `/_health`. Staging runs SQLite, is started/stopped with `staging-toggle.yml`, and builds from the branch with Nixpacks (`npm start`, so `prestart` creates `public/uploads`). It needs a persistent volume on `/app/.tmp` or every deploy wipes users, followers and the actor key. Full details, troubleshooting, and how to change the pipeline are in `docs/CI_CD.md`.
