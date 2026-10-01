/**
 * `never-published`: the document has no published version in this locale.
 * `modified`: it is published, but the draft was edited after publishing
 * (the admin's "Modified" status).
 */
export type DraftState = 'never-published' | 'modified';

/** One pending draft, per document and locale, from `GET /api/articles/drafts`. */
export interface DraftSummary {
  documentId: string;
  title: string | null;
  slug: string | null;
  locale: string | null;
  /** Last edit of the draft. */
  updatedAt: string;
  /** When the published version was published; null if it never was. */
  publishedAt: string | null;
  state: DraftState;
  category: { name: string | null; slug: string | null } | null;
  author: { name: string | null } | null;
}
