/** A published article as the federation layer sees it. */

export interface MediaRecord {
  url: string;
  mime: string | null;
  alternativeText: string | null;
  /** Attribution line (HTML) owed by the image's license, when it has a credit. */
  creditHtml: string | null;
}

export interface ArticleRecord {
  documentId: string;
  title: string;
  description: string;
  slug: string;
  locale: string | null;
  publishedAt: string;
  updatedAt: string | null;
  image: MediaRecord | null;
}
