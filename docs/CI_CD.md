# CI/CD Pipeline Documentation

This document explains how the continuous integration and deployment pipeline works for the DevBog Blog Backend.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Workflow Steps](#workflow-steps)
- [Key Files](#key-files)
- [Dokploy Configuration](#dokploy-configuration)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Making Changes](#making-changes)

---

## Overview

When you push code to the `main` branch, an automated pipeline builds a Docker image, pushes it to GitHub Container Registry (GHCR), and triggers a deployment to our Hetzner VPS running Dokploy.

**Key benefits:**
- Zero-downtime deployments (health checks ensure the new version is healthy before switching)
- Automatic rollback if deployment fails
- Consistent, reproducible builds
- No manual SSH or server management required

---

## Architecture

```
┌─────────────────┐
│   Developer     │
│   git push      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│   GitHub Actions                        │
│   .github/workflows/deploy.yml          │
│                                         │
│   1. Checkout code                      │
│   2. Build Docker image                 │
│   3. Push to GHCR                       │
│   4. Trigger Dokploy API                │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│   GitHub Container Registry (GHCR)      │
│   ghcr.io/<org>/devbog-blog-backend     │
│                                         │
│   - Tagged with commit SHA              │
│   - Tagged with "latest" (on main)      │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│   Hetzner VPS (Dokploy)                 │
│                                         │
│   ┌───────────────────────────────────┐ │
│   │  Traefik (Reverse Proxy)          │ │
│   │  - SSL/TLS termination            │ │
│   │  - Routes to Strapi container     │ │
│   └───────────────────────────────────┘ │
│                                         │
│   ┌───────────────────────────────────┐ │
│   │  Strapi App (Docker Container)    │ │
│   │  - Pulls image from GHCR          │ │
│   │  - Health check: /_health         │ │
│   │  - Port: 1337                     │ │
│   └───────────────────────────────────┘ │
│                                         │
│   ┌───────────────────────────────────┐ │
│   │  PostgreSQL (Dokploy-managed)     │ │
│   │  - Internal Docker network        │ │
│   │  - Persistent volume              │ │
│   └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│   Production                            │
│   https://api.bogdev.com.co             │
└─────────────────────────────────────────┘
```

---

## Workflow Steps

### 1. Trigger
The workflow triggers automatically on every push to the `main` branch.

**File:** `.github/workflows/deploy.yml`

```yaml
on:
  push:
    branches: ["main"]
```

### 2. Build Job

The `build-and-push` job runs on GitHub's Ubuntu runners:

1. **Checkout code**: Downloads the repository
2. **Login to GHCR**: Authenticates using `GITHUB_TOKEN`
3. **Build Docker image**: Multi-stage build (see [Dockerfile](#dockerfile))
4. **Push to GHCR**: Tags with commit SHA and `latest`

**Image tags created:**
- `ghcr.io/<org>/devbog-blog-backend:<commit-sha>` (e.g., `abc1234`)
- `ghcr.io/<org>/devbog-blog-backend:latest` (only on main branch)

### 3. Deploy Job

After the image is pushed, the `deploy` job triggers Dokploy:

1. **Call Dokploy API**: Uses `benbristow/dokploy-deploy-action@0.2.2`
2. **Dokploy pulls image**: Fetches the new image from GHCR
3. **Health check**: Dokploy waits for `/_health` endpoint to return 200
4. **Switch traffic**: If healthy, routes traffic to new container
5. **Rollback on failure**: If health check fails, automatically reverts to previous version

### 4. Zero-Downtime Deployment

Dokploy uses Docker Swarm health checks to ensure zero downtime:

- **Health check endpoint**: `GET /_health`
- **Interval**: 30 seconds
- **Timeout**: 10 seconds
- **Start period**: 60 seconds (time for Strapi to initialize)
- **Retries**: 3 attempts before marking unhealthy

If the new container fails health checks, Dokploy automatically rolls back to the previous version.

---

## Key Files

### Dockerfile

**Location:** `Dockerfile`

Multi-stage build optimized for production:

1. **Base stage**: Node 20 Alpine with production environment
2. **Deps stage**: Installs production dependencies only
3. **Build stage**: Installs all dependencies and builds Strapi
4. **Production stage**: 
   - Copies only necessary files (dist, config, src, etc.)
   - Installs `curl` for health checks
   - Exposes port 1337
   - Defines health check

**Why multi-stage?**
- Smaller final image (no build tools or dev dependencies)
- Faster deployments
- More secure (no source code or secrets in final image)

### .dockerignore

**Location:** `.dockerignore`

Excludes unnecessary files from the Docker image:
- `node_modules` (rebuilt inside container)
- `.git` (not needed at runtime)
- `.env` files (secrets injected via Dokploy)
- `public/uploads` (mounted as volume)
- Test/coverage files

### GitHub Actions Workflow

**Location:** `.github/workflows/deploy.yml`

Two jobs:
1. `build-and-push`: Builds and pushes Docker image
2. `deploy`: Triggers Dokploy deployment (depends on build success)

### Health Check Endpoint

**Location:** `src/api/health/`

- **Route**: `GET /_health`
- **Response**: `{ "status": "ok", "timestamp": "..." }`
- **Purpose**: Allows Dokploy to verify the app is running and ready

This is a custom Strapi API endpoint (not a content type).

---

## Dokploy Configuration

### Project Structure in Dokploy

```
Project: devbog
├── Environment: production
│   ├── Application: strapi-backend
│   │   ├── Source: Docker Registry (GHCR)
│   │   ├── Domain: api.bogdev.com.co
│   │   ├── Port: 1337
│   │   └── Volume: ../files/strapi-uploads → /app/public/uploads
│   └── Database: strapi-db (PostgreSQL)
│       ├── Internal host: strapi-db
│       ├── Port: 5432
│       └── Database: strapi
```

### Application Settings

**General:**
- Source Type: Docker Registry
- Docker Image: `ghcr.io/<org>/devbog-blog-backend:latest`
- Registry: GHCR (credentials configured in Dokploy → Registry)

**Domain:**
- Host: `api.bogdev.com.co`
- Container Port: `1337`
- HTTPS: Enabled (Let's Encrypt)

**Environment Variables:**
See [Environment Variables](#environment-variables) section below.

**Volume (Advanced → Mounts):**
- Type: Bind Mount
- Host Path: `../files/strapi-uploads`
- Container Path: `/app/public/uploads`
- Purpose: Persist uploaded media files across deployments

**Health Check (Advanced → Swarm Settings):**
```json
{
  "Test": ["CMD", "curl", "-f", "http://localhost:1337/_health"],
  "Interval": 30000000000,
  "Timeout": 10000000000,
  "StartPeriod": 60000000000,
  "Retries": 3
}
```

**Update Config (for auto-rollback):**
```json
{
  "Parallelism": 1,
  "Delay": 10000000000,
  "FailureAction": "rollback",
  "Order": "start-first"
}
```

### GitHub Secrets

Required secrets in GitHub repository (Settings → Secrets → Actions):

| Secret | Description | Where to Find |
|--------|-------------|---------------|
| `DOKPLOY_SERVER_URL` | Dokploy panel URL | `https://dokploy.bogdev.com.co` |
| `DOKPLOY_API_KEY` | API authentication token | Dokploy → Profile → API Keys |
| `DOKPLOY_APPLICATION_ID` | Application identifier | Dokploy → App → General tab (in URL) |

---

## Environment Variables

All environment variables are configured in Dokploy UI (not in `.env` files).

### Required Variables

```env
# Application
NODE_ENV=production
HOST=0.0.0.0
PORT=1337
URL=https://api.bogdev.com.co

# Security (generate with: node scripts/generate-keys.js)
APP_KEYS=<comma-separated-keys>
API_TOKEN_SALT=<salt>
ADMIN_JWT_SECRET=<secret>
TRANSFER_TOKEN_SALT=<salt>
JWT_SECRET=<secret>
ENCRYPTION_KEY=<key>

# Database (Dokploy-managed PostgreSQL)
DATABASE_CLIENT=postgres
DATABASE_HOST=strapi-db
DATABASE_PORT=5432
DATABASE_NAME=strapi
DATABASE_USERNAME=strapi
DATABASE_PASSWORD=<password>

# File uploads
UPLOAD_PATH=/app/public/uploads
```

### Generating Security Keys

Run locally:
```bash
node scripts/generate-keys.js
```

Copy the output values into Dokploy's environment variables.

**Important:** Never commit `.env` files with real secrets. The `.env.example` file contains placeholder values only.

---

## Troubleshooting

### Deployment Fails at Build Stage

**Symptom:** GitHub Actions fails with "Build and push Docker image" error.

**Common causes:**
1. **TypeScript errors**: Run `npm run build` locally to catch errors
2. **Missing dependencies**: Ensure `package-lock.json` is committed
3. **Docker build context**: Check `.dockerignore` isn't excluding needed files

**Solution:**
```bash
# Test build locally
npm run build

# Check what's included in the image
docker build -t test-build .
```

### Deployment Fails at Deploy Stage

**Symptom:** Build succeeds but Dokploy deployment fails.

**Common causes:**
1. **GHCR authentication**: Verify Dokploy has GHCR credentials
2. **Health check fails**: App crashes on startup or `/_health` returns non-200
3. **Environment variables missing**: Check Dokploy app env vars
4. **Database connection**: Verify DB credentials and internal hostname

**Solution:**
1. Check Dokploy deployment logs (Deployments tab)
2. Check application logs (Logs tab)
3. Verify health endpoint manually:
   ```bash
   curl https://api.bogdev.com.co/_health
   ```

### App is Running but Returns 502 Bad Gateway

**Symptom:** Deployment succeeds but site shows 502 error.

**Common causes:**
1. **Wrong port**: Dokploy domain configured with wrong container port
2. **Traefik routing**: Domain not properly linked to app
3. **SSL certificate**: Let's Encrypt certificate not issued

**Solution:**
1. Verify domain settings: Container Port should be `1337`
2. Check Traefik logs in Dokploy
3. Verify DNS: `api.bogdev.com.co` should point to VPS IP

### Uploaded Files Disappear After Deployment

**Symptom:** Media uploads work but are lost after next deployment.

**Cause:** Volume not configured or misconfigured.

**Solution:**
1. Check Dokploy → App → Advanced → Mounts
2. Verify bind mount: `../files/strapi-uploads` → `/app/public/uploads`
3. Ensure `UPLOAD_PATH=/app/public/uploads` in environment variables

### Rollback Triggered Automatically

**Symptom:** Deployment reverts to previous version.

**Cause:** Health check failed (app didn't respond to `/_health` within 60 seconds).

**Solution:**
1. Check Dokploy deployment logs for health check status
2. Verify app starts successfully:
   - Check application logs for startup errors
   - Ensure database is accessible
   - Verify all required environment variables are set
3. Test locally with same environment variables

### Cannot Access Dokploy Panel

**Symptom:** `dokploy.bogdev.com.co` is unreachable.

**Solution:**
1. SSH into VPS and check Dokploy status:
   ```bash
   docker service ls
   docker service logs dokploy
   ```
2. Verify DNS: `dokploy.bogdev.com.co` should point to VPS IP
3. Check firewall: Ports 80, 443, 3000 must be open

---

## Making Changes

### Modifying the Dockerfile

**When to modify:**
- Adding system dependencies (e.g., image processing libraries)
- Changing Node.js version
- Optimizing build process

**Testing changes:**
```bash
# Build locally
docker build -t devbog-backend:test .

# Run locally
docker run -p 1337:1337 --env-file .env devbog-backend:test

# Test health endpoint
curl http://localhost:1337/_health
```

**Deployment:** Push to `main` to trigger the pipeline.

### Adding Environment Variables

**Steps:**
1. Add variable to Dokploy UI (App → Environment)
2. If it's a secret, mark it as sensitive
3. Redeploy the app (Dokploy → Deployments → Deploy)

**Note:** Environment variables are not version-controlled. Document required variables in this file.

### Changing the Deployment Trigger

**Current behavior:** Deploys on every push to `main`.

**To add staging environment:**
```yaml
on:
  push:
    branches:
      - main      # production
      - develop   # staging
```

Then use different `DOKPLOY_APPLICATION_ID` secrets based on branch.

### Disabling Auto-Deploy

**Temporarily disable:**
1. Go to Dokploy → App → Deployments
2. Toggle off "Auto Deploy"

**Permanently disable:**
Remove or comment out the `deploy` job in `.github/workflows/deploy.yml`.

### Manual Deployment

If you need to deploy manually (bypass GitHub Actions):

1. Build and push image locally:
   ```bash
   docker build -t ghcr.io/<org>/devbog-blog-backend:manual .
   docker push ghcr.io/<org>/devbog-blog-backend:manual
   ```

2. Trigger Dokploy via API:
   ```bash
   curl -X POST https://dokploy.bogdev.com.co/api/application.deploy \
     -H "x-api-key: <your-api-key>" \
     -H "Content-Type: application/json" \
     -d '{"applicationId": "<app-id>"}'
   ```

---

## Additional Resources

- [Dokploy Documentation](https://docs.dokploy.com/docs/core)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [Strapi Deployment Guide](https://docs.strapi.io/dev-docs/deployment)

---

## Questions?

If you encounter issues not covered in this document:
1. Check Dokploy deployment logs
2. Check GitHub Actions logs
3. Review application logs in Dokploy
4. Ask in the team chat or create an issue

**Last updated:** 2026-06-20
