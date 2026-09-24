import type { Core } from '@strapi/strapi';
import { consolidateCategories, hasChanges } from './migrations/consolidate-categories';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

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
  },
};
