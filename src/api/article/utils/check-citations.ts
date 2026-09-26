import type { Core } from '@strapi/strapi';
import { assertReferencesValid } from './citations';

const ARTICLE_UID = 'api::article.article';

interface ArticleRow {
  locale?: string | null;
  blocks?: unknown;
  references?: unknown;
}

/**
 * Checks, before an article create or update is written, its references and
 * that every `[@key]` in its body has one. `references` is shared by every locale while
 * `blocks` is not, so changing the references is checked against the draft
 * body of each locale, and changing one locale's body against the stored
 * references.
 */
export async function checkArticleCitations(
  strapi: Core.Strapi,
  params: { documentId?: string; locale?: string; data?: Record<string, unknown> }
): Promise<void> {
  const data = params.data;
  if (!data || !('blocks' in data || 'references' in data)) return;

  const rows = params.documentId
    ? ((await strapi.db.query(ARTICLE_UID).findMany({
        select: ['locale'],
        where: { documentId: params.documentId, publishedAt: null },
        populate: { blocks: true, references: true },
      })) as ArticleRow[])
    : [];

  const locale =
    params.locale ?? (await strapi.plugin('i18n').service('locales').getDefaultLocale());
  const current = rows.find((row) => row.locale === locale);

  const references =
    'references' in data ? data.references : (current?.references ?? rows[0]?.references);
  const blocksByLocale = ['blocks' in data ? data.blocks : current?.blocks];
  if ('references' in data) {
    for (const row of rows) if (row.locale !== locale) blocksByLocale.push(row.blocks);
  }

  assertReferencesValid(blocksByLocale, references);
}
