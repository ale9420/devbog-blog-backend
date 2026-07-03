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

Located in `config/plugins.ts` under the `comments` key:

```typescript
comments: {
  enabled: true,
  config: {
    enabledCollections: ['api::article.article'],
    approvalScores: {
      enabled: true,
      thresholds: {
        new: 0,
        approved: 1,
        rejected: -1,
        blocked: -10,
      },
    },
    moderation: {
      enabled: true,
      removeBlocked: false,
    },
    nested: {
      enabled: true,
      depth: 10,
      maxDepth: 10,
    },
    glow: {
      enabled: false,
      emailNotifications: false,
    },
    autopopulate: {
      populate: {
        author: {
          fields: ['name', 'email', 'avatar'],
        },
      },
    },
    entryRelation: {
      contentTypes: [{
        name: 'api::article.article',
        field: 'comments',
      }],
    },
  },
},
```

## Public permissions

The seed script sets content-type permissions, but the comments plugin also needs its own actions enabled for the public role. Grant these via the Strapi admin under **Settings → Users & Permissions plugin → Public → Comments**, or extend `setPublicPermissions` in `scripts/seed.js` to call plugin permission creation:

```javascript
await strapi.query('plugin::users-permissions.permission').create({
  data: {
    action: 'plugin::comments.comments.findAll',
    role: publicRole.id,
  },
});
```

Typical public actions needed:

- `plugin::comments.comments.findAll` — list comments for an entry.
- `plugin::comments.comments.findOne` — single comment.
- `plugin::comments.comments.create` — post a comment.

## Front-end usage

Comments are related to an article by its UID. Refer to the plugin’s REST documentation for the exact route shape; it usually looks like:

```http
GET /api/comments/api::article.article/:articleId
POST /api/comments/api::article.article/:articleId
```

Use the plugin’s config to control nesting depth and whether comments require approval before appearing publicly.

## Adding comments to another content type

1. Add the UID to `enabledCollections`.
2. Add an entry to `entryRelation.contentTypes` with the correct `name` and `field`.
3. Grant public permissions for the comments plugin actions.
4. Rebuild and restart the server.

## Do not

- Enable comments on content types that do not need them.
- Forget to enable moderation if the site is public — spam protection relies on the approval score thresholds.
