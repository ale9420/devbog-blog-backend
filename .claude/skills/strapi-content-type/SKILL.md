---
name: strapi-content-type
description: Use when adding or modifying Strapi content types, schemas, components, dynamic zones, slugs, i18n, or relations for the devbog headless CMS.
---

# Strapi Content Type Skill

This project is a **Strapi 5 headless CMS**. Every content type exposed to front-end or mobile apps lives under `src/api/<name>/` and follows the patterns already used by `article`, `author`, `category`, `global`, `about`, and `subscriber`.

## When to use this skill

- Adding a new content type (collection or single type).
- Modifying an existing schema (`schema.json`).
- Adding shared components or dynamic zones.
- Deciding on i18n, draft/publish, slugs, or relations.

## Conventions

| Item                          | Convention                   | Example                      |
| ----------------------------- | ---------------------------- | ---------------------------- |
| Folder                        | kebab-case singular          | `src/api/event/`             |
| Schema UID                    | `api::<singular>.<singular>` | `api::event.event`           |
| Controller/Service/Route file | kebab-case                   | `event.controller.ts`        |
| Components                    | PascalCase                   | `shared.media`, `shared.seo` |

## Minimal new content type

Create `src/api/event/content-types/event/schema.json`:

```json
{
  "kind": "collectionType",
  "collectionName": "events",
  "info": {
    "singularName": "event",
    "pluralName": "events",
    "displayName": "Event"
  },
  "options": {
    "draftAndPublish": true
  },
  "pluginOptions": {
    "i18n": {
      "localized": true
    }
  },
  "attributes": {
    "title": {
      "type": "string",
      "pluginOptions": { "i18n": { "localized": true } }
    },
    "slug": {
      "type": "uid",
      "targetField": "title"
    },
    "startDate": {
      "type": "datetime"
    }
  }
}
```

Create `src/api/event/controllers/event.ts`:

```typescript
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::event.event');
```

Create `src/api/event/services/event.ts`:

```typescript
import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::event.event');
```

Create `src/api/event/routes/event.ts`:

```typescript
import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::event.event');
```

## Re-use existing components

Use the shared components in `src/components/shared/`:

- `shared.media` — single media file
- `shared.slider` — multiple media files
- `shared.rich-text` — rich text block
- `shared.quote` — quote block
- `shared.seo` — SEO metadata

Example dynamic zone on a new content type:

```json
"blocks": {
  "type": "dynamiczone",
  "pluginOptions": { "i18n": { "localized": true } },
  "components": [
    "shared.media",
    "shared.quote",
    "shared.rich-text",
    "shared.slider"
  ]
}
```

## Guidelines

1. **Draft & publish**: enable only for content that needs an approval workflow (`article`, `subscriber`). Disable for global configuration (`global`, `about`).
2. **i18n**: enable localization only when the front-end needs translated content. Existing examples: `article` is localized; `subscriber` is not.
3. **Slugs**: add a `uid` field with `targetField` pointing to a unique title/name field.
4. **Relations**: prefer `manyToOne` from child to parent (e.g., `article` → `category`).
5. **Media**: use `allowedTypes: ["images"]` when only images are expected; use `multiple: false` for a single cover/avatar.
6. **Expose to the public**: after creating a content type, grant `find`/`findOne` permissions to the public role. Prefer doing this in `scripts/seed.js` (see `strapi-seeding` skill) so the front-end can read it immediately.

## Verification

- Start the dev server: `npm run dev`
- Confirm the new endpoints appear at `GET /api/events` and `GET /api/events/:id`
- Check that `GET /api/events` returns data only after public permissions are set.
