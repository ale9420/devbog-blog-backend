---
name: strapi-deployment
description: Use when the user asks about deploying, Docker, Dokploy, CI/CD, production environment variables, health checks, or build issues for the devbog Strapi backend.
---

# Strapi Deployment Skill

This project is deployed as a Docker container managed by **Dokploy** on a Hetzner VPS. The full pipeline is documented in `docs/CI_CD.md`.

## When to use this skill

- Changing the Dockerfile or `.dockerignore`.
- Adding production environment variables.
- Debugging failed deployments or health checks.
- Understanding the GitHub Actions → GHCR → Dokploy flow, or the staging environment.

## Pipeline overview

1. A push to `main` (production) or `develop` (staging) triggers `.github/workflows/deploy.yml`.
2. GitHub Actions builds a Docker image and pushes it to GHCR, tagged with the commit SHA plus `latest` (`main`) or `staging` (`develop`).
3. The deploy job picks the Dokploy application from the branch (`DOKPLOY_APPLICATION_ID` for `main`, `DOKPLOY_STAGING_APPLICATION_ID` otherwise) and calls Dokploy's API.
4. Dokploy waits for `GET /_health` to return 200 before switching traffic, and rolls back if it fails.

The `curl` in the deploy job has no `-f`, so a green run does not prove Dokploy accepted the deploy — check the Deployments tab.

## Staging

- App at `staging-api.bogdev.com.co`, SQLite (`DATABASE_CLIENT=sqlite`), started and stopped on demand with `.github/workflows/staging-toggle.yml`. See `docs/CI_CD.md` → Staging Environment.
- The staging app in Dokploy **builds from the `develop` branch with Nixpacks** (`npm start`), so the `Dockerfile` does not apply there. Anything the app needs at boot must therefore be done by `npm` scripts: `prestart` creates `public/uploads`, and `.dockerignore` (which excludes `public/uploads`) is honoured by that build too.
- Needs `URL=https://staging-api.bogdev.com.co`, `FEDIVERSE_ENABLED=true`, fresh security keys, and a persistent volume on `/app/.tmp`. Without the volume every deploy wipes the SQLite database: users, followers and the actor's key pair.
- Behind Traefik, `config/server.ts` must use `proxy: { koa: true }` (Strapi 5 syntax) or Koa sees `http` and federated URLs are generated with the wrong scheme.

## Dockerfile rules

The multi-stage `Dockerfile` copies **compiled JavaScript** from `dist/`, not TypeScript source:

- `dist/config` and `dist/src` → runtime code
- `dist/build` → admin panel build
- `database/` and `scripts/` → already JavaScript

Always run `npm run build` before building the Docker image. The final stage installs `curl` for the health check.

## Required production environment variables

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=1337
URL=https://api.bogdev.com.co

APP_KEYS=<comma-separated>
API_TOKEN_SALT=<salt>
ADMIN_JWT_SECRET=<secret>
TRANSFER_TOKEN_SALT=<salt>
JWT_SECRET=<secret>
ENCRYPTION_KEY=<key>

DATABASE_CLIENT=postgres
DATABASE_HOST=strapi-db
DATABASE_PORT=5432
DATABASE_NAME=strapi
DATABASE_USERNAME=strapi
DATABASE_PASSWORD=<password>

UPLOAD_PATH=/app/public/uploads
```

Generate secret values with:

```bash
node scripts/generate-keys.js
```

## Health check

The custom endpoint `GET /_health` is used by Dokploy:

```javascript
// src/api/health/controllers/health.ts
index(ctx) {
  ctx.body = { status: 'ok', timestamp: new Date().toISOString() };
}
```

Dokploy config:

- Interval: 30s
- Timeout: 10s
- Start period: 60s
- Retries: 3

If deployment rolls back, check the application logs first — the health check likely failed because the app crashed or could not reach the database.

## Upload persistence

In Dokploy, mount a host volume:

| Host path                 | Container path        |
| ------------------------- | --------------------- |
| `../files/strapi-uploads` | `/app/public/uploads` |

Without this, uploaded media is lost on every redeployment.

## Local build check

Before pushing, verify the production build locally:

```bash
npm run build
docker build -t devbog-backend:test .
docker run -p 1337:1337 --env-file .env devbog-backend:test
curl http://localhost:1337/_health
```

## Do not

- Commit real secrets in `.env` files.
- Copy `.ts` files into the production image.
- Forget to set `UPLOAD_PATH` and the upload volume in production.
- Run staging without a persistent volume for `/app/.tmp`.
