import type { Core } from '@strapi/strapi';
import type { UmamiConfig } from '../src/types/article-stat';

/**
 * Umami (self-hosted analytics). Strapi reads the visitors of each article
 * path from it to rank the most read articles. Without `UMAMI_URL` the sync
 * never runs and `/api/articles/popular` answers an empty list.
 */
const config = ({ env }: Core.Config.Shared.ConfigParams): UmamiConfig => ({
  // Internal address inside dokploy-network, e.g. http://<umami-app>:3000
  url: env('UMAMI_URL', ''),
  websiteId: env('UMAMI_WEBSITE_ID', ''),
  // API key of a View only user that reaches the website through a team
  apiKey: env('UMAMI_API_KEY', ''),
  syncCron: env('UMAMI_SYNC_CRON', '0 * * * *'),
  // Public dashboard, only for the link in the admin widget
  publicUrl: env('UMAMI_PUBLIC_URL', ''),
});

export default config;
