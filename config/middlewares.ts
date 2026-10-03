import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'https://market-assets.strapi.io',
            'https://resources.bogdev.com.co',
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'https://market-assets.strapi.io',
            'https://resources.bogdev.com.co',
          ],
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    // Browser origins allowed to call the API with credentials. Unset keeps
    // Strapi's default `*`, which reflects any origin; production sets it to
    // the frontend (docs/CI_CD.md). Server-to-server calls ignore CORS.
    config: { origin: env.array('CORS_ORIGINS', ['*']) },
  },
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    // DELETE too: DELETE /api/users/me takes the current password in its body.
    config: { parsedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
  // Outer to hide-unapproved-comments, so it only enriches what survives pruning.
  'global::fediverse-comment-fields',
  'global::hide-unapproved-comments',
];

export default config;
