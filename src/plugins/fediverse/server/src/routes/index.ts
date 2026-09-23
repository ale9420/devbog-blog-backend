export default {
  'content-api': {
    type: 'content-api',
    routes: [
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
