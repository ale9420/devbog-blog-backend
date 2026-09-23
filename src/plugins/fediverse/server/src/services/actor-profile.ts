import type { Core } from '@strapi/strapi';

export interface ActorProfile {
  name: string;
  summary: string;
  /** Absolute URL to the actor avatar (global favicon), or null. */
  iconUrl: string | null;
}

const DEFAULT_NAME = 'DevBog';
const DEFAULT_SUMMARY = 'The DevBog blog, federated on the fediverse.';

interface GlobalSettings {
  siteName?: string | null;
  siteDescription?: string | null;
  favicon?: { url?: string | null } | null;
}

interface AboutSettings {
  title?: string | null;
}

function absoluteUrl(url: string | null | undefined, baseUrl: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Resolves the blog actor's display profile from the existing `global` and
 * `about` single types, with env-var and hardcoded fallbacks so the actor is
 * always presentable even on a fresh install:
 *
 *   name    ← global.siteName → about.title → FEDIVERSE_ACTOR_NAME → "DevBog"
 *   summary ← global.siteDescription → FEDIVERSE_ACTOR_SUMMARY → default
 *   icon    ← global.favicon (resolved against the actor URL)
 */
export async function getActorProfile(strapi: Core.Strapi, baseUrl: string): Promise<ActorProfile> {
  let globalSettings: GlobalSettings | null = null;
  let aboutSettings: AboutSettings | null = null;

  try {
    globalSettings = (await strapi
      .documents('api::global.global')
      .findFirst()) as GlobalSettings | null;
  } catch (error) {
    strapi.log.warn('[fediverse] failed to load global settings for actor profile', { error });
  }

  try {
    aboutSettings = (await strapi
      .documents('api::about.about')
      .findFirst()) as AboutSettings | null;
  } catch (error) {
    strapi.log.warn('[fediverse] failed to load about settings for actor profile', { error });
  }

  const name =
    globalSettings?.siteName ||
    aboutSettings?.title ||
    process.env.FEDIVERSE_ACTOR_NAME ||
    DEFAULT_NAME;

  const summary =
    globalSettings?.siteDescription || process.env.FEDIVERSE_ACTOR_SUMMARY || DEFAULT_SUMMARY;

  const iconUrl = absoluteUrl(globalSettings?.favicon?.url, baseUrl);

  return { name, summary, iconUrl };
}

export default () => ({
  getActorProfile,
});
