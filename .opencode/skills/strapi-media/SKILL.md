---
name: strapi-media
description: Use when the user asks about images, file uploads, media fields, upload provider, image optimizer, breakpoints, or production upload storage for the devbog Strapi backend.
---

# Strapi Media Skill

Media handling is central to the blog backend. Images are used for article covers, author avatars, the site favicon, SEO share images, and inside dynamic-zone blocks.

## When to use this skill

- Adding or changing media fields.
- Configuring the upload provider or image optimizer.
- Debugging missing images after deployment.
- Adding new breakpoints or formats.

## Configuration

Upload provider and image optimizer settings are in `config/plugins.ts`:

```typescript
upload: {
  config: {
    provider: '@strapi/provider-upload-local',
    providerOptions: {
      destination: env('UPLOAD_PATH', '/var/www/devbog-blog-backend/uploads'),
    },
    breakpoints: {
      xlarge: 1920,
      large: 1000,
      medium: 750,
      small: 500,
    },
  },
},
'image-optimizer': {
  enabled: true,
  config: {
    defaultChoice: 'global',
    defaultMode: 'webp',
    webpQuality: 82,
    jpegQuality: 80,
    pngCompressionLevel: 9,
  },
},
```

## Media fields in schemas

Example cover field on `article`:

```json
"cover": {
  "type": "media",
  "pluginOptions": { "i18n": { "localized": true } },
  "multiple": false,
  "required": false,
  "allowedTypes": ["images", "files", "videos"]
}
```

Example avatar field on `author`:

```json
"avatar": {
  "type": "media",
  "multiple": false,
  "required": false,
  "allowedTypes": ["images"]
}
```

## Shared media components

- `shared.media` — single file, intended for one image/video.
- `shared.slider` — multiple files, intended for galleries.

When seeding or querying dynamic zones, populate the nested `file` field so consumers get real URLs.

## Production upload storage

The local provider stores files under the path set by `UPLOAD_PATH`. In the current Dokploy setup:

- `UPLOAD_PATH=/app/public/uploads`
- A bind mount maps host `../files/strapi-uploads` to container `/app/public/uploads`.

If uploads disappear after a deployment, the volume mount is missing or incorrect.

## Adding a new breakpoint

Edit `config/plugins.ts` under `upload.config.breakpoints`, then restart the server. Existing images are not regenerated automatically — re-upload them or trigger a rebuild of responsive formats.

## Consumer notes

- Consumers receive media objects with `url`, `alternativeText`, `caption`, `width`, `height`, and generated formats (`small`, `medium`, `large`, `xlarge`).
- Always populate media fields and nested `file` fields in dynamic zones.

## Do not

- Use `required: true` on media unless the UI explicitly demands it.
- Commit `public/uploads` to Git — it is excluded by `.gitignore` and `.dockerignore`.
