/**
 * Custom article routes. The file name sorts before `article.ts` so
 * `/articles/search` is registered ahead of the core `/articles/:id` route.
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/articles/search',
      handler: 'api::article.article.search',
      config: { auth: false },
    },
  ],
};
