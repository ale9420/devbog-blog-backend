# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A more detailed `AGENTS.md` already exists in this repo with naming conventions, Strapi API patterns, and a list of `.opencode/skills/` — read it for anything not covered here.

## Project

Strapi 5 (TypeScript) headless CMS backend for the DevBog blog, deployed as a Docker image to a Hetzner VPS via Dokploy (see `docs/CI_CD.md`). Production DB is Neon Tech PostgreSQL; local dev defaults to SQLite.

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

**Standard Strapi content types** live in `src/api/<name>/{content-types,controllers,routes,services}`, generated via `strapi generate` or hand-written using `factories.createCoreController/Service/Router`. Business logic beyond CRUD goes in `services/`. `config/plugins.ts` wires up `strapi-plugin-comments` (moderation via `approvalScores` thresholds), `@notum-cz/strapi-plugin-seo`, and conditionally an S3-compatible (Cloudflare R2) vs. local upload provider based on whether `R2_BUCKET` is set.

**The `fediverse` plugin** (`src/plugins/fediverse/`) is a local Strapi plugin (not a workspace package) implementing ActivityPub federation with `@fedify/fedify` + `@fedify/koa`. It is gated by `FEDIVERSE_ENABLED` (default `false`) in `config/plugins.ts`. Before touching it, or `src/extensions/comments/` (which adds `fediverseUri`/`fediverseActorHandle` fields to the comments schema for reply ingestion/dedupe), read `docs/FEDIVERSE.md` — it's the living architecture doc and phase tracker (phases 0–5, tracked via GitHub milestone), and records non-obvious findings, e.g.:

- Fedify's middleware is mounted in plugin `register()` (not `bootstrap()`), via `strapi.server.use()` directly — this must run before Strapi's `initMiddlewares()` mounts `strapi::body`, since HTTP signature verification needs the raw request body, and before the router mounts at `listen()` time.
- Strapi 5 does **not** emit `afterPublish`/`afterUnpublish` through `strapi.db.lifecycles`; publish/unpublish state is only observable via `strapi.eventHub` (`entry.publish` / `entry.unpublish`), fired asynchronously after the transaction commits.
- All federation state that must survive a restart (followers, actor keys, interactions) is stored in Strapi content types, not Fedify's `MemoryKvStore` (which only backs transient caches/idempotency).

**Testing** (`tests/`) boots a real Strapi instance per suite (`tests/strapi.js`) against an isolated SQLite file (`.tmp/test.db`), not mocks — `setupStrapi()`/`cleanupStrapi()` in `beforeAll`/`afterAll`. Jest transforms TS/JS via `tests/helpers/esbuild-transformer.js` and selectively transforms the `structured-field-values` package inside `node_modules` (an ESM-only transitive dependency of Fedify that Jest can't `require()` natively). Fediverse tests force `FEDIVERSE_ENABLED=true` before Strapi boots since env vars are read at plugin-registration time.

## Deployment

`main` branch pushes trigger `.github/workflows/` → Docker build → push to GHCR → Dokploy deploy on the Hetzner VPS behind Traefik, health-checked at `/_health`. Full details, troubleshooting, and how to change the pipeline are in `docs/CI_CD.md`.
