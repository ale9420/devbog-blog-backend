/**
 * article service.
 */

import { factories } from '@strapi/strapi';
import { snippetAround } from '../utils/plain-text';

const ARTICLE_UID = 'api::article.article';

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
}));
