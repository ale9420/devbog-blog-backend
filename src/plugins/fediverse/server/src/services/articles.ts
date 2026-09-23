import type { Core } from '@strapi/strapi';

import { Temporal } from '@js-temporal/polyfill';
import type { Context } from '@fedify/fedify';
import {
  Article,
  Create,
  Delete,
  Image,
  PUBLIC_COLLECTION,
  Tombstone,
  Update,
  type Activity,
} from '@fedify/fedify/vocab';

export const ARTICLE_UID = 'api::article.article';

const FEDERATED_STORE_KEY = 'federatedArticles';

export interface ArticleRecord {
  documentId: string;
  title: string;
  description: string;
  slug: string;
  locale: string | null;
  publishedAt: string;
  updatedAt: string | null;
  cover: { url: string; mime: string | null; alternativeText: string | null } | null;
}

interface ArticleRow {
  documentId: string;
  title?: string | null;
  description?: string | null;
  slug?: string | null;
  locale?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  cover?: { url?: string | null; mime?: string | null; alternativeText?: string | null } | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Human-facing URL of an article on the frontend (`FRONTEND_URL` +
 * `FRONTEND_ARTICLE_PATH`). The frontend serves its default locale without a
 * prefix (Nuxt i18n `prefix_except_default`) and every other locale under
 * `/<locale>`, so an article whose locale differs from `FRONTEND_DEFAULT_LOCALE`
 * gets that prefix — otherwise the link would open the wrong language.
 */
export function getFrontendArticleUrl(slug: string, locale?: string | null): URL {
  const base = (process.env.FRONTEND_URL ?? 'https://bogdev.com.co').replace(/\/+$/, '');
  const path = process.env.FRONTEND_ARTICLE_PATH ?? '/blog/{slug}';
  const frontendDefault = process.env.FRONTEND_DEFAULT_LOCALE ?? 'en';
  const prefix = locale && locale !== frontendDefault ? `/${locale}` : '';
  return new URL(base + prefix + path.replace('{slug}', encodeURIComponent(slug)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Inverse of {@link getFrontendArticleUrl}: extracts the slug (and locale) from
 * a frontend article URL, or null if the URL isn't one of ours. Some clients
 * reply using an article's `url` rather than its ActivityPub `id`.
 */
export function parseFrontendArticleUrl(value: string): { slug: string; locale: string } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const base = new URL(process.env.FRONTEND_URL ?? 'https://bogdev.com.co');
  if (url.origin !== base.origin) return null;

  const template = process.env.FRONTEND_ARTICLE_PATH ?? '/blog/{slug}';
  const [before, after] = template.split('{slug}');
  const basePath = base.pathname.replace(/\/+$/, '');
  const pattern = new RegExp(
    `^${escapeRegExp(basePath)}(?:/([A-Za-z]{2}(?:-[A-Za-z]{2})?))?${escapeRegExp(before)}([^/]+)${escapeRegExp(after ?? '')}/?$`
  );
  const match = pattern.exec(url.pathname);
  if (!match) return null;

  return {
    locale: match[1] ?? process.env.FRONTEND_DEFAULT_LOCALE ?? 'en',
    slug: decodeURIComponent(match[2]),
  };
}

/** documentId of the published article behind a frontend URL, or null. */
export async function findArticleDocumentIdByUrl(
  strapi: Core.Strapi,
  value: string
): Promise<string | null> {
  const parsed = parseFrontendArticleUrl(value);
  if (!parsed) return null;
  const row = (await strapi.documents(ARTICLE_UID).findFirst({
    status: 'published',
    locale: parsed.locale,
    filters: { slug: parsed.slug },
  })) as ArticleRow | null;
  return row?.documentId ?? null;
}

/** Only the default locale is federated in the MVP. */
export async function getDefaultLocale(strapi: Core.Strapi): Promise<string> {
  const locale = await strapi.plugin('i18n').service('locales').getDefaultLocale();
  return locale as string;
}

function toRecord(row: ArticleRow): ArticleRecord | null {
  // Federating an article without a slug would produce a broken frontend URL.
  if (!row.slug || !row.title || !row.publishedAt) return null;
  return {
    documentId: row.documentId,
    title: row.title,
    description: row.description ?? '',
    slug: row.slug,
    locale: row.locale ?? null,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt ?? null,
    cover: row.cover?.url
      ? {
          url: row.cover.url,
          mime: row.cover.mime ?? null,
          alternativeText: row.cover.alternativeText ?? null,
        }
      : null,
  };
}

/** The published, default-locale version of an article, or null. */
export async function findPublishedArticle(
  strapi: Core.Strapi,
  documentId: string
): Promise<ArticleRecord | null> {
  const locale = await getDefaultLocale(strapi);
  const row = (await strapi.documents(ARTICLE_UID).findOne({
    documentId,
    status: 'published',
    locale,
    populate: ['cover'],
  })) as ArticleRow | null;
  return row ? toRecord(row) : null;
}

/** Published default-locale articles, newest first. */
export async function listPublishedArticles(
  strapi: Core.Strapi,
  { start, limit }: { start: number; limit: number }
): Promise<{ items: ArticleRecord[]; total: number }> {
  const locale = await getDefaultLocale(strapi);
  const documents = strapi.documents(ARTICLE_UID);
  const [rows, total] = await Promise.all([
    documents.findMany({
      status: 'published',
      locale,
      sort: 'publishedAt:desc',
      start,
      limit,
      populate: ['cover'],
    }) as Promise<ArticleRow[]>,
    documents.count({ status: 'published', locale }),
  ]);
  const items = rows.map(toRecord).filter((record): record is ArticleRecord => record != null);
  return { items, total };
}

function toInstant(value: string): Temporal.Instant {
  return Temporal.Instant.from(new Date(value).toISOString());
}

/**
 * Builds the federated `Article`. The body is self-contained (title, excerpt,
 * link) so it reads well on servers that ignore `name`/`image`, and the link
 * lets Mastodon render a preview card. `summary` is deliberately unused:
 * Mastodon shows it as a content warning.
 */
export function buildArticle(
  ctx: Context<unknown>,
  actorIdentifier: string,
  record: ArticleRecord
): Article {
  const url = getFrontendArticleUrl(record.slug, record.locale);
  const content = [
    `<p><strong>${escapeHtml(record.title)}</strong></p>`,
    record.description ? `<p>${escapeHtml(record.description)}</p>` : '',
    `<p><a href="${escapeHtml(url.href)}">${escapeHtml(url.href)}</a></p>`,
  ].join('');

  return new Article({
    id: ctx.getObjectUri(Article, { documentId: record.documentId }),
    attribution: ctx.getActorUri(actorIdentifier),
    name: record.title,
    content,
    url,
    published: toInstant(record.publishedAt),
    updated: record.updatedAt ? toInstant(record.updatedAt) : undefined,
    image: record.cover
      ? new Image({
          url: new URL(record.cover.url, ctx.origin),
          mediaType: record.cover.mime ?? undefined,
          name: record.cover.alternativeText ?? undefined,
        })
      : undefined,
    to: PUBLIC_COLLECTION,
    ccs: [ctx.getFollowersUri(actorIdentifier)],
  });
}

function activityId(ctx: Context<unknown>, documentId: string, fragment: string): URL {
  const id = new URL(ctx.getObjectUri(Article, { documentId }).href);
  id.hash = fragment;
  return id;
}

/**
 * `Create`/`Update` wrapping the article, addressed publicly (`to: as:Public`,
 * `cc: followers`) so it can reach remote public timelines, not just followers.
 */
export function buildArticleActivity(
  kind: 'create' | 'update',
  ctx: Context<unknown>,
  actorIdentifier: string,
  record: ArticleRecord
): Activity {
  const fragment = kind === 'create' ? 'create' : `update-${Date.now()}`;
  const options = {
    id: activityId(ctx, record.documentId, fragment),
    actor: ctx.getActorUri(actorIdentifier),
    object: buildArticle(ctx, actorIdentifier, record),
    published: toInstant(kind === 'create' ? record.publishedAt : new Date().toISOString()),
    to: PUBLIC_COLLECTION,
    ccs: [ctx.getFollowersUri(actorIdentifier)],
  };
  return kind === 'create' ? new Create(options) : new Update(options);
}

export function buildDeleteActivity(
  ctx: Context<unknown>,
  actorIdentifier: string,
  documentId: string
): Activity {
  const objectId = ctx.getObjectUri(Article, { documentId });
  return new Delete({
    id: activityId(ctx, documentId, 'delete'),
    actor: ctx.getActorUri(actorIdentifier),
    object: new Tombstone({ id: objectId }),
    to: PUBLIC_COLLECTION,
    ccs: [ctx.getFollowersUri(actorIdentifier)],
  });
}

type FederatedMap = Record<string, string>;

async function readFederated(strapi: Core.Strapi): Promise<FederatedMap> {
  const store = strapi.store({ type: 'plugin', name: 'fediverse' });
  return ((await store.get({ key: FEDERATED_STORE_KEY })) as FederatedMap | null) ?? {};
}

/** Whether a `Create(Article)` was already sent, so a re-publish becomes an `Update`. */
export async function isFederated(strapi: Core.Strapi, documentId: string): Promise<boolean> {
  return documentId in (await readFederated(strapi));
}

export async function setFederated(
  strapi: Core.Strapi,
  documentId: string,
  federated: boolean
): Promise<void> {
  const map = await readFederated(strapi);
  if (federated) map[documentId] = new Date().toISOString();
  else delete map[documentId];
  await strapi.store({ type: 'plugin', name: 'fediverse' }).set({
    key: FEDERATED_STORE_KEY,
    value: map,
  });
}
