import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  proxy: { koa: true },
  url: env('URL', 'http://localhost:1337'),
  app: {
    // Required: Strapi refuses to start without them (npm run generate:keys).
    keys: env.array('APP_KEYS') as string[],
  },
  // Admin MCP endpoint (/mcp), authenticated with admin API tokens; anyone
  // holding one can read and write content. Set to false where it isn't used.
  mcp: {
    enabled: env.bool('STRAPI_MCP_ENABLED', true),
  },
  // Tasks are added in bootstrap (src/index.ts), each gated by its own config.
  cron: {
    enabled: !env.bool('STRAPI_DISABLE_CRON', false),
  },
});

export default config;
