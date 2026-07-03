# Agent Guidelines for devbog-blog-backend

This is a **Strapi 5** CMS backend project. Below are conventions and commands for working with this codebase.

---

## Build Commands

```bash
npm run build          # Build Strapi admin panel
npm run dev            # Start development server with hot reload
npm run develop        # Alias for dev
npm run start          # Start production server
npm run console        # Start Strapi CLI console
npm run seed:example   # Seed database with sample data
npm run strapi <cmd>   # Run Strapi CLI commands
```

## Quality & Test Commands

```bash
npm run typecheck      # Run TypeScript checks without emitting files
npm run lint           # Run ESLint
npm run lint:fix       # Run ESLint and auto-fix issues
npm run format         # Format files with Prettier
npm run format:check   # Check formatting without writing files
npm run test           # Run Jest test suite
npm run test:watch     # Run Jest in watch mode
npm run test:coverage  # Run Jest with coverage report
```

### Node.js Requirements

- **Node**: `>=20.0.0 <=24.x.x`
- **npm**: `>=6.0.0`

---

## Project Structure

```
├── config/              # Application configuration
│   ├── admin.ts         # Admin panel settings
│   ├── api.ts           # API defaults (pagination, etc.)
│   ├── database.ts      # Database connections
│   ├── middlewares.ts   # Middleware stack
│   ├── plugins.ts       # Plugin configurations
│   └── server.ts        # Server settings
├── src/
│   ├── admin/           # Admin panel customization
│   ├── api/             # Content type definitions
│   │   └── <name>/
│   │       ├── controllers/<name>.ts
│   │       ├── routes/<name>.ts
│   │       └── services/<name>.ts
│   ├── components/      # Reusable components
│   ├── extensions/      # Plugin extensions
│   └── index.ts         # Application lifecycle hooks
├── data/                # Seed data and uploads
├── scripts/             # Utility scripts
└── public/              # Static assets
```

---

## Code Style Guidelines

### TypeScript Conventions

1. **Use `import type` for type-only imports**:

   ```typescript
   import type { Core } from '@strapi/strapi';
   ```

2. **Config functions use typed parameters**:

   ```typescript
   const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => {
     // ...
   };
   ```

3. **Default export for config files**:
   ```typescript
   export default config;
   ```

### Naming Conventions

| Item                 | Convention          | Example                 |
| -------------------- | ------------------- | ----------------------- |
| Content types        | kebab-case singular | `api::article.article`  |
| API routes           | kebab-case          | `/api/articles`         |
| Controllers/Services | kebab-case          | `article.controller.ts` |
| Components           | PascalCase          | `SharedMedia`           |
| Config files         | camelCase           | `database.ts`           |

### Strapi API Patterns

**Core CRUD boilerplate (controllers/services/routes)**:

```typescript
// Controller
import { factories } from '@strapi/strapi';
export default factories.createCoreController('api::article.article');

// Service
import { factories } from '@strapi/strapi';
export default factories.createCoreService('api::article.article');

// Router
import { factories } from '@strapi/strapi';
export default factories.createCoreRouter('api::article.article');
```

**Creating documents** (Strapi 5 style):

```typescript
const draft = await strapi.documents('api::article.article').create({
  data: { title: 'Hello' },
});

await strapi.documents('api::article.article').publish({ documentId: draft.documentId });
```

**Querying documents**:

```typescript
const articles = await strapi.documents('api::article.article').findMany({
  filters: { category: { name: 'Tech' } },
  populate: ['cover', 'author'],
});
```

### Environment Variables

- Access via `env('VAR_NAME', defaultValue)`
- Boolean: `env.bool('FLAG', true)`
- Integer: `env.int('PORT', 1337)`
- Array: `env.array('APP_KEYS')`

### Error Handling

```typescript
// In services/queries - catch and log errors
try {
  await strapi.documents('api::model.model').create({ data });
} catch (error) {
  console.error({ model, data, error });
}

// In standalone scripts - exit with code
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

---

## Database Configuration

Supports three database clients configured via `DATABASE_CLIENT`:

```typescript
const connections = {
  mysql: {
    /* ... */
  },
  postgres: {
    /* ... */
  },
  sqlite: {
    /* ... */
  },
};
```

- **Development default**: SQLite
- **Production**: PostgreSQL (Neon Tech or Cloud SQL)

---

## Adding New Content Types

1. Generate via Strapi CLI: `npm run strapi generate`
2. Or manually create in `src/api/<name>/`:
   - `controllers/`, `routes/`, `services/` (use core factories)
   - Schema JSON in content type folder
3. Set public permissions in admin panel or via seed script

---

## Working with the Seed Script

The `scripts/seed.js` file demonstrates:

- Using `strapi.documents()` for document operations
- File uploads via `strapi.plugin('upload').service('upload')`
- Setting public permissions programmatically
- Plugin store for tracking state

---

## OpenCode Skills

Project-specific agent skills live in `.opencode/skills/`. They are loaded automatically and cover the most common tasks for this headless CMS backend.

| Skill                 | Use when...                                                                             |
| --------------------- | --------------------------------------------------------------------------------------- |
| `strapi-content-type` | Adding or modifying content types, components, dynamic zones, slugs, i18n, or relations |
| `strapi-api-consumer` | Documenting or debugging how front-end/mobile apps consume the REST API                 |
| `strapi-media`        | Working with images, uploads, the upload provider, or image optimizer breakpoints       |
| `strapi-seeding`      | Seeding sample data, importing content, or setting public permissions programmatically  |
| `strapi-deployment`   | Deploying, changing Docker/Dokploy config, env vars, or health checks                   |
| `strapi-subscriber`   | Working with newsletter subscriptions, signup, or confirmation flows                    |
| `strapi-comments`     | Configuring or querying the comments plugin and moderation settings                     |

Each skill file is at `.opencode/skills/<name>/SKILL.md`.

---

## Important Notes

1. **Jest + Supertest** configured for integration tests against an isolated SQLite database
2. **ESLint + Prettier** configured — run `npm run lint` and `npm run format` before committing
3. **Strict TypeScript disabled** (`strict: false` in tsconfig.json)
4. **Neon Tech PostgreSQL** used for production database
5. **Comments plugin** (`strapi-plugin-comments`) enabled for articles
6. **GitHub Actions workflows** in `.github/workflows/` run CI on PRs/pushes and deploy on `main`
7. **OpenCode MCP servers** configured in `.opencode/opencode.json` (GitHub + Playwright), disabled by default
