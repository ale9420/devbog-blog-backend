import type { Core } from '@strapi/strapi';
import { checkArticleCitations } from './api/article/utils/check-citations';
import { blocksToPlainText } from './api/article/utils/plain-text';
import { backfillArticlePlainText } from './migrations/article-plain-text';
import { backfillCommentLocale } from './migrations/comment-locale';
import { consolidateCategories, hasChanges } from './migrations/consolidate-categories';
import { grantPublicTagPermissions } from './migrations/public-tag-permissions';
import { ensureEditorRole } from './migrations/editor-role';
import { migrateSliderItems } from './migrations/slider-items';
import { ABOUT_UID, ARTICLE_STAT_UID, ARTICLE_UID } from './constants/uids';
import { isUmamiConfigured } from './api/article-stat/utils/umami-client';
import type { UmamiConfig } from './types/article-stat';
import { assertImageCreditsValid } from './utils/image-credit';
import { restrictDraftsToEditors } from './utils/drafts-access';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Rejects citations without a reference, and keeps the article's
    // searchable plain text in step with its body.
    strapi.documents.use(async (context, next) => {
      if (
        context.uid === ARTICLE_UID &&
        (context.action === 'create' || context.action === 'update')
      ) {
        const params = context.params as {
          documentId?: string;
          locale?: string;
          data?: Record<string, unknown>;
        };
        await checkArticleCitations(strapi, params);
        const data = params.data;
        if (data && 'blocks' in data) data.plainText = blocksToPlainText(data.blocks);
      }
      return next();
    });

    // Rejects image credits that break their license's attribution terms.
    strapi.documents.use(async (context, next) => {
      if (
        (context.uid === ARTICLE_UID || context.uid === ABOUT_UID) &&
        (context.action === 'create' || context.action === 'update')
      ) {
        const data = (context.params as { data?: Record<string, unknown> }).data;
        if (data) assertImageCreditsValid(data);
      }
      return next();
    });

    // Only editors may read drafts through the content API (?status=draft).
    restrictDraftsToEditors(strapi);

    // Admin API route (admin session required) for the visitors widget on the
    // admin homepage (src/admin). Routes under src/api are always registered as
    // content API, so this one is added here.
    strapi.server.routes({
      type: 'admin',
      prefix: '/article-stats',
      routes: [
        {
          method: 'GET',
          path: '/summary',
          handler: `${ARTICLE_STAT_UID}.summary`,
          config: { policies: ['admin::isAuthenticatedAdmin'] },
          info: { apiName: 'article-stat', type: 'admin' },
        },
      ],
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

    const sliders = await migrateSliderItems(strapi);
    if (sliders > 0) strapi.log.info(`[sliders] copied files into items for ${sliders} sliders`);

    const localized = await backfillCommentLocale(strapi);
    if (localized > 0) strapi.log.info(`[comments] set the locale of ${localized} comments`);

    const tagPermissions = await grantPublicTagPermissions(strapi);
    if (tagPermissions > 0) {
      strapi.log.info(`[tags] granted ${tagPermissions} public read permissions`);
    }

    const editor = await ensureEditorRole(strapi);
    if (editor.roleCreated || editor.permissionsGranted > 0) {
      strapi.log.info(`[roles] editor: ${JSON.stringify(editor)}`);
    }

    scheduleUmamiSync(strapi);
  },
};

/**
 * Syncs article visitors from Umami every `UMAMI_SYNC_CRON` and once right
 * after boot, so a deploy doesn't leave the most read list empty for an hour.
 * A failure only logs: the previous counts stay until the next run.
 */
function scheduleUmamiSync(strapi: Core.Strapi) {
  const config = strapi.config.get<UmamiConfig>('umami');
  if (!strapi.config.get<boolean>('server.cron.enabled') || !isUmamiConfigured(config)) return;

  const run = async () => {
    try {
      const report = await strapi.service(ARTICLE_STAT_UID).sync();
      strapi.log.info(`[umami] synced article visitors: ${JSON.stringify(report)}`);
    } catch (error) {
      strapi.log.warn(`[umami] sync failed, keeping the previous counts: ${error}`);
    }
  };
  strapi.cron.add({ umamiSync: { task: run, options: { rule: config.syncCron } } });
  void run();
}
