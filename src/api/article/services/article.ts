/**
 * article service.
 */

import { factories } from '@strapi/strapi';
import { ARTICLE_UID } from '../../../constants/uids';
import { snippetAround } from '../utils/plain-text';
import type { DraftSummary } from '../../../types/article-drafts';

export const SEARCH_MIN_LENGTH = 3;
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 50;

export interface SearchOptions {
  query: string;
  locale?: string;
  /** Also search the description and the body, not only the title. */
  content?: boolean;
  limit?: number;
}

export type SearchMatch = 'title' | 'description' | 'content';

interface SearchRow {
  documentId: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  plainText: string | null;
  publishedAt: string | null;
  locale: string | null;
  category?: { slug: string | null; name: string | null } | null;
}

interface DraftRow {
  documentId: string;
  title: string | null;
  slug: string | null;
  locale: string | null;
  updatedAt: string;
  category?: { name: string | null; slug: string | null } | null;
  author?: { name: string | null } | null;
}

interface PublishedRow {
  documentId: string;
  locale: string | null;
  updatedAt: string;
  publishedAt: string;
}

const versionKey = (row: { documentId: string; locale: string | null }) =>
  `${row.documentId}:${row.locale ?? ''}`;

export default factories.createCoreService(ARTICLE_UID, ({ strapi }) => ({
  /**
   * Published articles whose title — and, with `content`, description or body
   * — contains `query`, newest first, each with the field it matched in and a
   * plain-text snippet around the match.
   */
  async search({ query, locale, content = false, limit = SEARCH_DEFAULT_LIMIT }: SearchOptions) {
    const term = query.trim();
    const fields: SearchMatch[] = content ? ['title', 'description', 'content'] : ['title'];
    const column = (field: SearchMatch) => (field === 'content' ? 'plainText' : field);

    const rows = (await strapi.documents(ARTICLE_UID).findMany({
      status: 'published',
      locale,
      fields: ['slug', 'title', 'description', 'plainText', 'publishedAt', 'locale'],
      populate: { category: { fields: ['slug', 'name'] } },
      filters: { $or: fields.map((field) => ({ [column(field)]: { $containsi: term } })) },
      sort: 'publishedAt:desc',
      limit: Math.min(Math.max(1, limit), SEARCH_MAX_LIMIT),
    })) as unknown as SearchRow[];

    // `$containsi` is a LIKE without escaping, so `%` and `_` in the query act as
    // wildcards: rows that only matched through them are dropped here.
    return rows.flatMap((row) => {
      for (const field of fields) {
        const snippet = snippetAround(row[column(field)] ?? '', term);
        if (snippet === null) continue;
        return [
          {
            documentId: row.documentId,
            slug: row.slug,
            title: row.title,
            description: row.description,
            publishedAt: row.publishedAt,
            locale: row.locale,
            category: row.category ? { slug: row.category.slug, name: row.category.name } : null,
            matchedIn: field,
            snippet,
          },
        ];
      }
      return [];
    });
  },

  /**
   * Drafts with something to review, per document and locale, last edited
   * first: never published, or edited after publishing (draft `updatedAt`
   * later than the published one, as the admin's "Modified" status). Drafts
   * identical to their published version are left out. Called from a
   * content API route, so the Document Service only serves drafts to editors
   * (src/utils/drafts-access.ts).
   */
  async drafts({ locale }: { locale?: string } = {}): Promise<DraftSummary[]> {
    const drafts = (await strapi.documents(ARTICLE_UID).findMany({
      status: 'draft',
      locale: locale ?? '*',
      fields: ['title', 'slug', 'locale', 'updatedAt'],
      populate: { category: { fields: ['name', 'slug'] }, author: { fields: ['name'] } },
      sort: 'updatedAt:desc',
    })) as unknown as DraftRow[];
    if (drafts.length === 0) return [];

    const published = (await strapi.documents(ARTICLE_UID).findMany({
      status: 'published',
      locale: locale ?? '*',
      fields: ['locale', 'updatedAt', 'publishedAt'],
      filters: { documentId: { $in: [...new Set(drafts.map((draft) => draft.documentId))] } },
    })) as unknown as PublishedRow[];
    const publishedByKey = new Map(published.map((row) => [versionKey(row), row]));

    return drafts.flatMap((draft): DraftSummary[] => {
      const version = publishedByKey.get(versionKey(draft));
      const modified =
        version && new Date(draft.updatedAt).getTime() > new Date(version.updatedAt).getTime();
      if (version && !modified) return [];
      return [
        {
          documentId: draft.documentId,
          title: draft.title,
          slug: draft.slug,
          locale: draft.locale,
          updatedAt: draft.updatedAt,
          publishedAt: version?.publishedAt ?? null,
          state: version ? 'modified' : 'never-published',
          category: draft.category
            ? { name: draft.category.name, slug: draft.category.slug }
            : null,
          author: draft.author ? { name: draft.author.name } : null,
        },
      ];
    });
  },
}));
