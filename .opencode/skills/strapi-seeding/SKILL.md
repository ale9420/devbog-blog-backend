---
name: strapi-seeding
description: Use when seeding sample data, importing content, setting public permissions programmatically, or extending the seed script for the devbog Strapi backend.
---

# Strapi Seeding Skill

This project uses `scripts/seed.js` to populate a fresh database with sample articles, authors, categories, global settings, and about content. It also sets public role permissions so the API is immediately usable by front-end apps.

## When to use this skill

- Adding sample data for a new content type.
- Changing initial public permissions.
- Seeding media files along with content.
- Re-importing after clearing the database.

## How the seed script works

1. Checks a plugin store flag `initHasRun` to avoid re-importing on a non-empty database.
2. Sets public permissions via `setPublicPermissions(...)`.
3. Imports categories, authors, articles, global settings, and about content.
4. Uploads media files referenced in `data/uploads/` and attaches them to entries.

## Run the seed

```bash
npm run seed:example
```

> Important: this script starts its own Strapi instance. Do not run it while `npm run dev` is already running.

## Add a new content type to the seed

1. Add sample data to `data/data.json` under a new key (e.g., `events`).
2. Create an import function in `scripts/seed.js`:

```javascript
async function importEvents() {
  for (const event of events) {
    const created = await createEntry({
      model: 'event',
      entry: event,
    });

    // Publish draft-enabled content types so they are visible on the public API
    if (created?.documentId) {
      await strapi.documents('api::event.event').publish({ documentId: created.documentId });
    }
  }
}
```

3. Grant public permissions:

```javascript
await setPublicPermissions({
  // existing permissions...
  event: ['find', 'findOne'],
});
```

4. Call `await importEvents()` inside `importSeedData()`.

## Seeding media

Use `checkFileExistsBeforeUpload(fileNames)` and `uploadFile(fileData, name)` helpers from `scripts/seed.js`. For dynamic-zone blocks, use `updateBlocks(blocks)` to replace file names with uploaded file objects.

## Single types

Single types (`global`, `about`) should be created only once. They do not use `draftAndPublish`, so no publish step is needed.

## Reset and re-seed

The script refuses to run if `initHasRun` is set. To force a re-seed:

1. Clear the database (e.g., delete SQLite files or drop the PostgreSQL schema).
2. Delete the `initHasRun` flag from the plugin store, or reset the database entirely.
3. Run `npm run seed:example` again.

## Do not

- Re-run the seed on a production database — it is designed for first-run setup.
- Forget to set public permissions for new collection types; otherwise the API returns 403.
