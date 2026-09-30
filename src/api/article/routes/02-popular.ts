/**
 * Most read articles. Lives with the article routes, not in article-stat,
 * so it is registered ahead of the core `/articles/:id` route (see 01-search.ts).
 */

import { ARTICLE_STAT_UID } from '../../../constants/uids';

export default {
  routes: [
    {
      method: 'GET',
      path: '/articles/popular',
      handler: `${ARTICLE_STAT_UID}.popular`,
      config: { auth: false },
    },
  ],
};
