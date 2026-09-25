export default {
  'content-api': {
    type: 'content-api',
    routes: [
      // Public like the per-article route below: aggregates only, cached for 60 s.
      {
        method: 'GET',
        path: '/articles/stats',
        handler: 'stats.batch',
        config: { auth: false },
      },
      {
        method: 'GET',
        path: '/articles/ranking',
        handler: 'stats.ranking',
        config: { auth: false },
      },
      {
        method: 'GET',
        path: '/articles/:documentId/stats',
        handler: 'stats.find',
        // Public: it exposes counts only, so no users-permissions role setup is needed.
        config: { auth: false },
      },
    ],
  },
};
