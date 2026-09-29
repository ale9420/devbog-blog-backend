/**
 * Custom article routes. The file name sorts before `article.ts` so
 * `/articles/search` is registered ahead of the core `/articles/:id` route.
 */

import { ARTICLE_UID } from '../../../constants/uids';

export default {
  routes: [
    {
      method: 'GET',
      path: '/articles/search',
      handler: `${ARTICLE_UID}.search`,
      config: { auth: false },
    },
  ],
};
