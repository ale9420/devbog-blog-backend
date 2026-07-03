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
- Understanding the GitHub Actions → GHCR → Dokploy flow.

## Pipeline overview

1. Push to `main` triggers `.github/workflows/deploy.yml`.
2. GitHub Actions builds a Docker image and pushes it to GHCR.
3. The image is tagged with the commit SHA and `latest`.
4. Dokploy is triggered via API and pulls the new image.
5. Dokploy waits for `GET /_health` to return 200 before switching traffic.
6. If the health check fails, Dokploy rolls back automatically.

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
