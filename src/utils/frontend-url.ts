/**
 * Article paths on the frontend. The frontend serves its default locale without
 * a prefix (Nuxt i18n `prefix_except_default`) and every other locale under
 * `/<locale>`. Copy of the fediverse plugin's `parseFrontendArticleUrl`, which
 * the root can't import (see "Where code goes" in AGENTS.md), reduced to paths:
 * Umami reports paths, not full URLs.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Slug and locale of a frontend article path, or null if it isn't one. */
export function parseFrontendArticlePath(
  pathname: string
): { slug: string; locale: string } | null {
  const base = new URL(process.env.FRONTEND_URL ?? 'https://bogdev.com.co');
  const template = process.env.FRONTEND_ARTICLE_PATH ?? '/blog/{slug}';
  const [before, after] = template.split('{slug}');
  const basePath = base.pathname.replace(/\/+$/, '');
  const pattern = new RegExp(
    `^${escapeRegExp(basePath)}(?:/([A-Za-z]{2}(?:-[A-Za-z]{2})?))?${escapeRegExp(before)}([^/]+)${escapeRegExp(after ?? '')}/?$`
  );
  const match = pattern.exec(pathname);
  if (!match) return null;

  let slug: string;
  try {
    slug = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  return { locale: match[1] ?? process.env.FRONTEND_DEFAULT_LOCALE ?? 'en', slug };
}
