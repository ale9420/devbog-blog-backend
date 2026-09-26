import type { Core } from '@strapi/strapi';

export interface ActorProfileField {
  name: string;
  /** Absolute URL, rendered as a link in the profile metadata table. */
  url: string;
}

export interface ActorProfile {
  name: string;
  summary: string;
  /** Absolute URL to the actor avatar (global favicon), or null. */
  iconUrl: string | null;
  /** Absolute URL to the profile header image (global fediverseHeader), or null. */
  headerUrl: string | null;
  /** Human-facing page for the actor: the frontend home page. */
  url: string;
  fields: ActorProfileField[];
}

export const GLOBAL_UID = 'api::global.global';

const DEFAULT_NAME = 'BogDev';
const DEFAULT_SUMMARY = 'The BogDev blog, federated on the fediverse.';
const DEFAULT_SOURCE_URL = 'https://github.com/ale9420/devbog-blog-backend';

interface GlobalSettings {
  siteName?: string | null;
  siteDescription?: string | null;
  favicon?: { url?: string | null } | null;
  fediverseHeader?: { url?: string | null } | null;
}

function absoluteUrl(url: string | null | undefined, baseUrl: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return null;
  }
}

function frontendHome(): string {
  return new URL(process.env.FRONTEND_URL ?? 'https://bogdev.com.co').href;
}

/**
 * Resolves the blog actor's display profile from the `global` single type,
 * with env-var and hardcoded fallbacks so the actor is always presentable even
 * on a fresh install:
 *
 *   name    ← global.siteName → FEDIVERSE_ACTOR_NAME → "BogDev"
 *   summary ← global.siteDescription → FEDIVERSE_ACTOR_SUMMARY → default
 *   icon    ← global.favicon (resolved against the actor URL)
 *   header  ← global.fediverseHeader (resolved against the actor URL)
 *   fields  ← Blog (FRONTEND_URL) and Código (FEDIVERSE_ACTOR_SOURCE_URL)
 *
 * `about.title` is deliberately not a fallback: it's the About page heading
 * ("Acerca de este blog"), not a name.
 */
export async function getActorProfile(strapi: Core.Strapi, baseUrl: string): Promise<ActorProfile> {
  let globalSettings: GlobalSettings | null = null;

  try {
    globalSettings = (await strapi.documents(GLOBAL_UID).findFirst({
      populate: { favicon: true, fediverseHeader: true },
    })) as GlobalSettings | null;
  } catch (error) {
    strapi.log.warn('[fediverse] failed to load global settings for actor profile', { error });
  }

  const name = globalSettings?.siteName || process.env.FEDIVERSE_ACTOR_NAME || DEFAULT_NAME;

  const summary =
    globalSettings?.siteDescription || process.env.FEDIVERSE_ACTOR_SUMMARY || DEFAULT_SUMMARY;

  const url = frontendHome();

  return {
    name,
    summary,
    iconUrl: absoluteUrl(globalSettings?.favicon?.url, baseUrl),
    headerUrl: absoluteUrl(globalSettings?.fediverseHeader?.url, baseUrl),
    url,
    fields: [
      { name: 'Blog', url },
      { name: 'Código', url: process.env.FEDIVERSE_ACTOR_SOURCE_URL || DEFAULT_SOURCE_URL },
    ],
  };
}

export default () => ({
  getActorProfile,
});
