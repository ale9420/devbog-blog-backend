---
name: strapi-comments
description: Use when the user asks about the comments plugin, article comments, comment moderation, nested comments, or public comment permissions in the devbog Strapi backend.
---

# Strapi Comments Skill

Comments are handled by `strapi-plugin-comments` and are enabled for the `api::article.article` content type.

## When to use this skill

- Configuring comment moderation, nesting, or approval.
- Enabling/disabling comments on other content types.
- Setting public permissions for reading or posting comments.
- Querying comments from a front-end app.

## Plugin configuration

Located in `config/plugins.ts` under the `comments` key. `strapi-plugin-comments` 3.x only reads these options: `enabledCollections`, `approvalFlow`, `moderatorRoles`, `entryLabel`, `badWords`, `blockedAuthorProps`, `reportReasons`. In this repo only `enabledCollections: ['api::article.article']` takes effect.

The other keys currently in the file (`approvalScores`, `moderation`, `nested`, `glow`, `autopopulate`, `entryRelation`) are options of older plugin versions and are **ignored** — do not rely on them for moderation or nesting.

## Approval and visibility

- `approvalStatus` is `PENDING`, `APPROVED` or `REJECTED`. By default (`approvalFlow: []`) comments created through the plugin are `APPROVED` immediately; listing the collection in `approvalFlow: ['api::article.article']` would make them `PENDING`.
- The plugin's public read endpoints return **every** comment unless the caller filters by `approvalStatus`, and the frontend does not. The global middleware `src/middlewares/hide-unapproved-comments.ts` (registered in `config/middlewares.ts`) prunes `PENDING`/`REJECTED` comments and their subtrees from `GET /api/comments/*`. Keep it registered: fediverse replies rely on it to stay hidden until approved.
- Approve or reject in the admin comments moderation view.

## Data model

- `related` is `api::article.article:<documentId>` (the document id, not the numeric id).
- `threadOf` points at the parent comment (nesting).
- `authorId`, `authorName`, `authorAvatar` identify the author. `authorEmail` is exposed publicly by the plugin, so never store an email you don't intend to publish.
- Extra fields added by `src/extensions/comments/strapi-server.ts`: `fediverseUri` (remote Note id, used to dedupe) and `fediverseActorHandle` (`@user@host`). Fediverse replies are created with `strapi.documents('plugin::comments.comment')` by `src/plugins/fediverse/server/src/services/replies.ts`; see `docs/FEDIVERSE.md` (Phase 3).
- Extend the schema in `strapi-server.ts`, not with an extension `schema.json`: Strapi merges schema files shallowly, so a `schema.json` with `attributes` replaces every attribute of the plugin.

## Public permissions

The comments plugin has its own actions, separate from the content-type permissions the seed script sets. Enable them for the public role under **Settings → Users & Permissions → Public → Comments**, or programmatically:

```javascript
await strapi.query('plugin::users-permissions.permission').create({
  data: { action: 'plugin::comments.client.findAllInHierarchy', role: publicRole.id },
});
```

Actions on the content API: `plugin::comments.client.findAllInHierarchy`, `findAllFlat`, `findAllPerAuthor`, `post`, `put`, `removeComment`, `reportAbuse`.

## Front-end usage

```http
GET  /api/comments/api::article.article:<documentId>        # nested tree
GET  /api/comments/api::article.article:<documentId>/flat   # flat list
POST /api/comments/api::article.article:<documentId>
```

## Adding comments to another content type

1. Add the UID to `enabledCollections`.
2. Grant public permissions for the plugin actions above.
3. Rebuild and restart the server.

## Do not

- Assume `approvalScores`/`moderation`/`nested` do anything.
- Remove the `hide-unapproved-comments` middleware.
- Enable comments on content types that do not need them.
