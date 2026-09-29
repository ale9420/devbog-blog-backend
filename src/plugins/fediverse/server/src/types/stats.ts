/** Per-article fediverse counters and the ranking built on them. */

export interface ArticleStats {
  likes: number;
  boosts: number;
  replies: number;
}

export interface RankedArticle extends ArticleStats {
  documentId: string;
}

export interface RankingOptions {
  page: number;
  pageSize: number;
  locale?: string;
  /** Category slug. */
  category?: string;
  /** Tag slug. */
  tag?: string;
  /** Text the title must contain, case-insensitive. */
  search?: string;
}

export interface RankingPage {
  data: RankedArticle[];
  meta: { pagination: { page: number; pageSize: number; pageCount: number; total: number } };
}
