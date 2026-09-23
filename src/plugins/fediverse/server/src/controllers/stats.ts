import type { Core } from '@strapi/strapi';

import { findPublishedArticle } from '../services/articles';
import { countInteractions } from '../services/interactions';

/** Public like/boost counts for the frontend. Only aggregates; never who liked. */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async find(ctx: { params: { documentId: string }; body: unknown; notFound: () => void }) {
    const { documentId } = ctx.params;

    // Only published articles: don't confirm that unpublished ids exist.
    if ((await findPublishedArticle(strapi, documentId)) == null) {
      ctx.notFound();
      return;
    }

    ctx.body = await countInteractions(strapi, documentId);
  },
});
