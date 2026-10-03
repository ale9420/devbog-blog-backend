# devbog-blog-backend

Strapi 5 (TypeScript) headless CMS for the [BogDev](https://bogdev.com.co) blog: articles, categories, tags, comments, reader accounts, newsletter subscribers, visitor stats from Umami and optional ActivityPub federation. Production runs at `api.bogdev.com.co` (PostgreSQL), staging at `staging-api.bogdev.com.co` (SQLite).

## Getting started

Requires Node 22 (`.nvmrc`).

```bash
npm ci
cp .env.example .env
npm run generate:keys     # fills the Strapi secrets in .env
npm run develop           # http://localhost:1337/admin, SQLite in .tmp/data.db
npm run seed:example      # optional sample content
```

## Checks

```bash
npm run typecheck && npm run lint && npm run format:check
npm test                  # boots a real Strapi per suite on an isolated SQLite file
```

CI runs the same checks plus `npm run build` on every pull request to `main`.

## Documentation

| Topic                                         | Where                       |
| --------------------------------------------- | --------------------------- |
| Architecture, commands, non-obvious behaviour | `CLAUDE.md`                 |
| Conventions, project layout, Strapi patterns  | `AGENTS.md`                 |
| CI/CD, Docker, Dokploy, environment variables | `docs/CI_CD.md`             |
| Reader accounts, editors, account deletion    | `docs/ACCOUNTS.md`          |
| Umami visitors and most read articles         | `docs/ANALYTICS.md`         |
| ActivityPub federation (`fediverse` plugin)   | `docs/FEDIVERSE.md`         |
| Content types, media, comments, seeding, etc. | `.claude/skills/*/SKILL.md` |
| Reporting vulnerabilities, dependency policy  | `SECURITY.md`               |
| Accepted dependency vulnerabilities           | `docs/DEPENDENCY_RISKS.md`  |

## Deployment

Pushing to `main` builds a Docker image, pushes it to GHCR and deploys it to production through Dokploy; `develop` deploys staging. See `docs/CI_CD.md`.
