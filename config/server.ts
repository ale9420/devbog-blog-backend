import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  proxy: { koa: true },
  url: env('URL', 'http://localhost:1337'),
  app: {
    keys: env.array('APP_KEYS'),
  },
  mcp: {
    enabled: true,
  },
  // Tasks are added in bootstrap (src/index.ts), each gated by its own config.
  cron: {
    enabled: !env.bool('STRAPI_DISABLE_CRON', false),
  },
});

export default config;
