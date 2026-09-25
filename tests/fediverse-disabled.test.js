'use strict';

// The plugin ships switched off (config/plugins.ts: FEDIVERSE_ENABLED defaults to
// false). Production runs like this until it is deliberately enabled.
process.env.FEDIVERSE_ENABLED = 'false';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');

const ARTICLE_UID = 'api::article.article';
const COMMENT_UID = 'plugin::comments.comment';
const ACTIVITY_JSON = 'application/activity+json';

describe('Fediverse federation disabled (FEDIVERSE_ENABLED=false)', () => {
  beforeAll(async () => {
    await setupStrapi();
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await cleanupStrapi();
  });

  it('does not load the plugin or its content types', () => {
    expect(strapi.plugin('fediverse')).toBeUndefined();
    expect(strapi.contentType('plugin::fediverse.follower')).toBeUndefined();
    expect(strapi.contentType('plugin::fediverse.interaction')).toBeUndefined();
  });

  it.each([
    ['/.well-known/webfinger?resource=acct:devbog@localhost'],
    ['/fediverse/user/devbog'],
    ['/fediverse/user/devbog/outbox'],
    ['/nodeinfo/2.1'],
    ['/api/fediverse/articles/anything/stats'],
    ['/api/fediverse/articles/stats?documentIds=anything'],
    ['/api/fediverse/articles/ranking'],
  ])('serves nothing at %s', async (path) => {
    await request(strapi.server.httpServer).get(path).set('Accept', ACTIVITY_JSON).expect(404);
  });

  it('leaves the rest of the app working, including article publishing', async () => {
    await request(strapi.server.httpServer).get('/_health').expect(204);

    const draft = await strapi
      .documents(ARTICLE_UID)
      .create({ data: { title: 'No federation here', slug: 'no-federation-here' } });
    await expect(
      strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId })
    ).resolves.toBeTruthy();
  });

  it('still hides pending comments from the public API', async () => {
    const draft = await strapi
      .documents(ARTICLE_UID)
      .create({ data: { title: 'Comment target', slug: 'comment-target' } });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });
    const relation = `${ARTICLE_UID}:${draft.documentId}`;

    const publicRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'public' } });
    await strapi.query('plugin::users-permissions.permission').create({
      data: { action: 'plugin::comments.client.findAllFlat', role: publicRole.id },
    });
    await strapi.service('plugin::users-permissions.users-permissions').initialize();

    for (const [content, approvalStatus] of [
      ['visible comment', 'APPROVED'],
      ['pending comment', 'PENDING'],
      ['rejected comment', 'REJECTED'],
    ]) {
      await strapi
        .documents(COMMENT_UID)
        .create({ data: { content, related: relation, approvalStatus } });
    }

    const res = await request(strapi.server.httpServer)
      .get(`/api/comments/${relation}/flat`)
      .expect(200);

    expect(res.body.data.map((comment) => comment.content)).toEqual(['visible comment']);
  });
});
