'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { getPublicRole } = require('./helpers/permissions');

const ARTICLE_UID = 'api::article.article';
const COMMENT_UID = 'plugin::comments.comment';

describe('Public comments API', () => {
  let relation;

  const commentsAt = async (path) => {
    const res = await request(strapi.server.httpServer).get(path).expect(200);
    return Array.isArray(res.body) ? res.body : res.body.data;
  };
  const byContent = (items, content) => items.find((item) => item.content === content);

  beforeAll(async () => {
    await setupStrapi();

    const publicRole = await getPublicRole();
    for (const action of ['findAll', 'findAllFlat', 'findAllInHierarchy']) {
      await strapi.query('plugin::users-permissions.permission').create({
        data: { action: `plugin::comments.client.${action}`, role: publicRole.id },
      });
    }
    await strapi.service('plugin::users-permissions.users-permissions').initialize();

    const draft = await strapi
      .documents(ARTICLE_UID)
      .create({ data: { title: 'Thread target', slug: 'thread-target' } });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });
    relation = `${ARTICLE_UID}:${draft.documentId}`;

    const blog = await strapi.documents(COMMENT_UID).create({
      data: {
        content: 'from the blog',
        related: relation,
        approvalStatus: 'APPROVED',
        authorId: 'blog-reader',
        authorName: 'Blog Reader',
      },
    });
    await strapi.documents(COMMENT_UID).create({
      data: {
        content: 'from the fediverse',
        related: relation,
        approvalStatus: 'APPROVED',
        authorId: 'https://mastodon.example/users/ana',
        authorName: 'Ana',
        fediverseUri: 'https://mastodon.example/users/ana/statuses/1',
        fediverseActorHandle: '@ana@mastodon.example',
        threadOf: blog.id,
      },
    });
    await strapi.documents(COMMENT_UID).create({
      data: {
        content: 'pending from the fediverse',
        related: relation,
        approvalStatus: 'PENDING',
        fediverseUri: 'https://mastodon.example/users/ana/statuses/2',
        fediverseActorHandle: '@ana@mastodon.example',
      },
    });
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('exposes fediverseActorHandle and fediverseUri on the flat list', async () => {
    const items = await commentsAt(`/api/comments/${relation}/flat`);

    expect(byContent(items, 'from the fediverse')).toMatchObject({
      fediverseActorHandle: '@ana@mastodon.example',
      fediverseUri: 'https://mastodon.example/users/ana/statuses/1',
    });
    const blog = byContent(items, 'from the blog');
    expect(blog.fediverseActorHandle ?? null).toBeNull();
    expect(blog.fediverseUri ?? null).toBeNull();
  });

  it('exposes them on nested replies of the threaded list', async () => {
    const [root] = await commentsAt(`/api/comments/${relation}`);

    expect(root.content).toBe('from the blog');
    expect(byContent(root.children, 'from the fediverse')).toMatchObject({
      fediverseActorHandle: '@ana@mastodon.example',
      fediverseUri: 'https://mastodon.example/users/ana/statuses/1',
    });
  });

  it('keeps pending fediverse replies out of every list', async () => {
    const flat = await commentsAt(`/api/comments/${relation}/flat`);
    const tree = await commentsAt(`/api/comments/${relation}`);
    const all = [...flat, ...tree, ...tree.flatMap((item) => item.children ?? [])];

    expect(all.map((item) => item.content)).not.toContain('pending from the fediverse');
  });
});
