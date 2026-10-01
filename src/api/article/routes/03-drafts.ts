/**
 * Pending drafts for editors. Registered ahead of the core `/articles/:id`
 * route (see 01-search.ts). Needs the `drafts` permission (granted to the
 * Editor role by src/migrations/editor-role.ts) and the `is-editor` policy,
 * which also turns away API tokens.
 */

import { ARTICLE_UID } from '../../../constants/uids';

export default {
  routes: [
    {
      method: 'GET',
      path: '/articles/drafts',
      handler: `${ARTICLE_UID}.drafts`,
      config: { policies: ['global::is-editor'] },
    },
  ],
};
