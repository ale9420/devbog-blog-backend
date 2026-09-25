import type { Core } from '@strapi/strapi';
import { blocksToPlainText } from './api/article/utils/plain-text';
import { backfillArticlePlainText } from './migrations/article-plain-text';
import { consolidateCategories, hasChanges } from './migrations/consolidate-categories';

const ARTICLE_UID = 'api::article.article';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Keeps the article's searchable plain text in step with its body.
    strapi.documents.use(async (context, next) => {
      if (
        context.uid === ARTICLE_UID &&
        (context.action === 'create' || context.action === 'update')
      ) {
        const data = (context.params as { data?: Record<string, unknown> }).data;
        if (data && 'blocks' in data) data.plainText = blocksToPlainText(data.blocks);
      }
      return next();
    });
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const report = await consolidateCategories(strapi);
    if (hasChanges(report)) {
      strapi.log.info(`[categories] consolidated: ${JSON.stringify(report)}`);
    }
    if (report.untouched.length > 0) {
      strapi.log.warn(`[categories] not part of the redesign: ${report.untouched.join(', ')}`);
    }

    const filled = await backfillArticlePlainText(strapi);
    if (filled > 0) strapi.log.info(`[articles] filled the plain text of ${filled} rows`);
  },
};
