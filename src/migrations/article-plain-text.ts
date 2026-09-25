import type { Core } from '@strapi/strapi';
import { blocksToPlainText } from '../api/article/utils/plain-text';

const ARTICLE_UID = 'api::article.article';
const BATCH_SIZE = 50;

/**
 * Fills `plainText` for article rows saved before the field existed. It
 * writes each row directly (draft and published, every locale), so nothing
 * gets republished. Idempotent: rows that already have a value are skipped.
 */
export async function backfillArticlePlainText(strapi: Core.Strapi): Promise<number> {
  const articles = strapi.db.query(ARTICLE_UID);
  let filled = 0;

  for (;;) {
    const rows = (await articles.findMany({
      select: ['id'],
      where: { plainText: { $null: true } },
      populate: { blocks: true },
      orderBy: { id: 'asc' },
      limit: BATCH_SIZE,
    })) as { id: number; blocks?: unknown }[];
    if (rows.length === 0) return filled;

    for (const row of rows) {
      await articles.update({
        where: { id: row.id },
        data: { plainText: blocksToPlainText(row.blocks) },
      });
    }
    filled += rows.length;
  }
}
