'use strict';

// Enable the fediverse plugin before Strapi boots (config/plugins.ts reads it).
process.env.FEDIVERSE_ENABLED = 'true';
process.env.FEDIVERSE_ACTOR_IDENTIFIER = process.env.FEDIVERSE_ACTOR_IDENTIFIER || 'devbog';
process.env.FRONTEND_URL = 'https://blog.example.test';
process.env.FRONTEND_ARTICLE_PATH = '/blog/{slug}';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { createRemoteActor } = require('./helpers/remote-actor');
const { waitUntil } = require('./helpers/wait-until');
const {
  htmlToPlainText,
  stripLeadingMentions,
} = require('../src/plugins/fediverse/server/src/services/replies');
const {
  parseFrontendArticleUrl,
} = require('../src/plugins/fediverse/server/src/services/articles');
const { pruneHiddenComments } = require('../src/middlewares/hide-unapproved-comments');

const ARTICLE_UID = 'api::article.article';
const COMMENT_UID = 'plugin::comments.comment';
const AS_CONTEXT = 'https://www.w3.org/ns/activitystreams';

describe('Fediverse federation (Phase 3: replies as moderated comments)', () => {
  let host;
  let inboxUrl;
  let remotes = [];
  let noteCounter = 0;

  const articleUri = (documentId) => `http://${host}/fediverse/articles/${documentId}`;
  const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));
  const slugify = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  async function publishedArticle() {
    const title = `Reply target ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const draft = await strapi
      .documents(ARTICLE_UID)
      .create({ data: { title, slug: slugify(title), description: 'Excerpt.' } });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });
    return draft;
  }

  async function newRemote(options = {}) {
    const remote = await createRemoteActor({
      preferredUsername: `reader${remotes.length}`,
      name: 'Remote Reader',
      iconUrl: 'https://cdn.example.test/avatar.png',
      ...options,
    });
    remotes.push(remote);
    return remote;
  }

  function noteActivity(remote, { inReplyTo, content, type = 'Create', id, attributedTo }) {
    noteCounter += 1;
    const noteId = id ?? `${remote.actorUrl}/notes/${noteCounter}`;
    return {
      noteId,
      activity: {
        '@context': AS_CONTEXT,
        id: `${noteId}/activity-${type}-${noteCounter}`,
        type,
        actor: remote.actorUrl,
        object: {
          id: noteId,
          type: 'Note',
          attributedTo: attributedTo ?? remote.actorUrl,
          inReplyTo,
          content,
          to: 'https://www.w3.org/ns/activitystreams#Public',
        },
      },
    };
  }

  const send = (remote, activity) => remote.postSignedActivity(inboxUrl, activity);

  const findComment = (fediverseUri) =>
    strapi.documents(COMMENT_UID).findFirst({ filters: { fediverseUri }, populate: ['threadOf'] });

  async function reply(remote, options) {
    const { noteId, activity } = noteActivity(remote, options);
    const res = await send(remote, activity);
    expect(res.ok).toBe(true);
    return noteId;
  }

  beforeAll(async () => {
    await setupStrapi();

    const port = strapi.server.httpServer.address().port;
    host = `127.0.0.1:${port}`;
    inboxUrl = `http://${host}/fediverse/user/devbog/inbox`;

    // Let anonymous visitors read comments, as the public frontend does.
    const publicRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'public' } });
    for (const action of ['findAllFlat', 'findAllInHierarchy']) {
      await strapi.query('plugin::users-permissions.permission').create({
        data: { action: `plugin::comments.client.${action}`, role: publicRole.id },
      });
    }
    await strapi.service('plugin::users-permissions.users-permissions').initialize();
  });

  afterEach(async () => {
    await Promise.all(remotes.map((remote) => remote.close()));
    remotes = [];
    const rows = await strapi.db.query('plugin::fediverse.follower').findMany();
    for (const row of rows) {
      await strapi.db
        .query('plugin::fediverse.follower')
        .delete({ where: { documentId: row.documentId } });
    }
  });

  afterAll(async () => {
    await settle(300);
    await cleanupStrapi();
  });

  describe('comment schema extension', () => {
    it('adds the fediverse fields without dropping the plugin attributes', () => {
      const { attributes } = strapi.contentType(COMMENT_UID);

      expect(attributes.fediverseUri).toMatchObject({ type: 'string', unique: true });
      expect(attributes.fediverseActorHandle).toMatchObject({ type: 'string' });
      for (const original of ['content', 'related', 'threadOf', 'approvalStatus', 'authorName']) {
        expect(attributes[original]).toBeDefined();
      }
    });

    it('persists the fediverse fields and enforces a unique fediverseUri', async () => {
      const data = {
        content: 'hello',
        related: 'api::article.article:whatever',
        fediverseUri: 'https://remote.example/notes/unique-1',
        fediverseActorHandle: '@someone@remote.example',
      };
      const created = await strapi.documents(COMMENT_UID).create({ data });

      const stored = await strapi
        .documents(COMMENT_UID)
        .findOne({ documentId: created.documentId });
      expect(stored.fediverseUri).toBe(data.fediverseUri);
      expect(stored.fediverseActorHandle).toBe(data.fediverseActorHandle);
      await expect(strapi.documents(COMMENT_UID).create({ data })).rejects.toThrow();
    });
  });

  describe('Create(Note) replies', () => {
    it('stores a reply to an article as a PENDING comment with the remote author', async () => {
      const article = await publishedArticle();
      const remote = await newRemote();

      const noteId = await reply(remote, {
        inReplyTo: articleUri(article.documentId),
        content:
          '<p><span class="h-card"><a href="http://x/@devbog" class="u-url mention">@<span>devbog</span></a></span> Great post!<br>' +
          '<script>alert(1)</script></p><p>Second &amp; last paragraph</p>',
      });

      const comment = await waitUntil(() => findComment(noteId));

      expect(comment.approvalStatus).toBe('PENDING');
      expect(comment.related).toBe(`${ARTICLE_UID}:${article.documentId}`);
      expect(comment.content).toBe('Great post!\nalert(1)\n\nSecond & last paragraph');
      expect(comment.content).not.toContain('<');
      expect(comment.authorName).toBe('Remote Reader');
      expect(comment.authorAvatar).toBe('https://cdn.example.test/avatar.png');
      expect(comment.authorId).toBe(remote.actorUrl);
      expect(comment.authorEmail ?? null).toBeNull();
      expect(comment.fediverseActorHandle).toMatch(/^@reader\d+@/);
      expect(comment.isAdminComment).toBeFalsy();
    });

    it('attaches replies that address the article by its frontend url', async () => {
      const article = await publishedArticle();
      const remote = await newRemote();

      const noteId = await reply(remote, {
        inReplyTo: `https://blog.example.test/blog/${article.slug}`,
        content: '<p>via the frontend url</p>',
      });

      const comment = await waitUntil(() => findComment(noteId));
      expect(comment.related).toBe(`${ARTICLE_UID}:${article.documentId}`);
    });

    it('nests a reply-to-a-reply under its parent comment', async () => {
      const article = await publishedArticle();
      const first = await newRemote();
      const second = await newRemote();

      const parentNote = await reply(first, {
        inReplyTo: articleUri(article.documentId),
        content: '<p>parent</p>',
      });
      const parent = await waitUntil(() => findComment(parentNote));

      const childNote = await reply(second, { inReplyTo: parentNote, content: '<p>child</p>' });
      const child = await waitUntil(() => findComment(childNote));

      expect(child.threadOf?.documentId).toBe(parent.documentId);
      expect(child.related).toBe(`${ARTICLE_UID}:${article.documentId}`);
      expect(child.approvalStatus).toBe('PENDING');
    });

    it('creates a single comment when the same Note is delivered twice', async () => {
      const article = await publishedArticle();
      const remote = await newRemote();
      const { noteId, activity } = noteActivity(remote, {
        inReplyTo: articleUri(article.documentId),
        content: '<p>only once</p>',
      });

      expect((await send(remote, activity)).ok).toBe(true);
      await waitUntil(() => findComment(noteId));
      await send(remote, activity);
      await send(remote, { ...activity, id: `${activity.id}-redelivery` });
      await settle();

      const all = await strapi
        .documents(COMMENT_UID)
        .findMany({ filters: { fediverseUri: noteId } });
      expect(all).toHaveLength(1);
    });

    it.each([
      [
        'a reply to something that is not one of our articles',
        async () => ({ inReplyTo: 'https://elsewhere.example/notes/1' }),
      ],
      [
        'a reply to an unpublished article',
        async () => {
          const title = `Draft ${Date.now()}`;
          const draft = await strapi
            .documents(ARTICLE_UID)
            .create({ data: { title, slug: slugify(title) } });
          return { inReplyTo: articleUri(draft.documentId) };
        },
      ],
      [
        'a reply that is empty once sanitized',
        async () => {
          const article = await publishedArticle();
          return { inReplyTo: articleUri(article.documentId), content: '<p><br></p>' };
        },
      ],
    ])('ignores %s', async (_label, build) => {
      const remote = await newRemote();
      const options = { content: '<p>hello</p>', ...(await build()) };
      const { noteId, activity } = noteActivity(remote, options);

      expect((await send(remote, activity)).ok).toBe(true);
      await settle();

      expect(await findComment(noteId)).toBeNull();
    });

    it('ignores replies from actors an admin has blocked', async () => {
      const article = await publishedArticle();
      const remote = await newRemote();
      await strapi.plugin('fediverse').service('followers').recordFollower(strapi, {
        actorId: remote.actorUrl,
        inbox: remote.inboxUrl,
      });
      const row = await strapi.db
        .query('plugin::fediverse.follower')
        .findOne({ where: { actorId: remote.actorUrl } });
      await strapi.db
        .query('plugin::fediverse.follower')
        .update({ where: { documentId: row.documentId }, data: { blocked: true } });

      const { noteId, activity } = noteActivity(remote, {
        inReplyTo: articleUri(article.documentId),
        content: '<p>blocked</p>',
      });
      expect((await send(remote, activity)).ok).toBe(true);
      await settle();

      expect(await findComment(noteId)).toBeNull();
    });

    it('ignores a Note whose author is not the (signature-verified) sender', async () => {
      const article = await publishedArticle();
      const remote = await newRemote();
      const { noteId, activity } = noteActivity(remote, {
        inReplyTo: articleUri(article.documentId),
        content: '<p>forged</p>',
        attributedTo: 'https://someone-else.example/users/victim',
      });

      expect((await send(remote, activity)).ok).toBe(true);
      await settle();

      expect(await findComment(noteId)).toBeNull();
    });
  });

  describe('Update(Note) and Delete(Note)', () => {
    async function storedReply() {
      const article = await publishedArticle();
      const remote = await newRemote();
      const noteId = await reply(remote, {
        inReplyTo: articleUri(article.documentId),
        content: '<p>original</p>',
      });
      const comment = await waitUntil(() => findComment(noteId));
      await strapi
        .documents(COMMENT_UID)
        .update({ documentId: comment.documentId, data: { approvalStatus: 'APPROVED' } });
      return { article, remote, noteId, documentId: comment.documentId };
    }

    it('applies an edit and sends the comment back to PENDING for re-moderation', async () => {
      const { remote, noteId, documentId } = await storedReply();

      const { activity } = noteActivity(remote, {
        id: noteId,
        type: 'Update',
        inReplyTo: 'https://ignored.example/x',
        content: '<p>edited text</p>',
      });
      expect((await send(remote, activity)).ok).toBe(true);

      const edited = await waitUntil(async () => {
        const row = await strapi.documents(COMMENT_UID).findOne({ documentId });
        return row.content === 'edited text' ? row : null;
      });
      expect(edited.approvalStatus).toBe('PENDING');
    });

    it('ignores an edit sent by someone other than the reply author', async () => {
      const { noteId, documentId } = await storedReply();
      const stranger = await newRemote();

      const { activity } = noteActivity(stranger, {
        id: noteId,
        type: 'Update',
        inReplyTo: 'https://ignored.example/x',
        content: '<p>hijacked</p>',
      });
      expect((await send(stranger, activity)).ok).toBe(true);
      await settle();

      const row = await strapi.documents(COMMENT_UID).findOne({ documentId });
      expect(row.content).toBe('original');
      expect(row.approvalStatus).toBe('APPROVED');
    });

    it('marks the comment removed when the remote Note is deleted', async () => {
      const { remote, noteId, documentId } = await storedReply();

      const res = await send(remote, {
        '@context': AS_CONTEXT,
        id: `${noteId}/delete`,
        type: 'Delete',
        actor: remote.actorUrl,
        object: { id: noteId, type: 'Tombstone' },
      });
      expect(res.ok).toBe(true);

      await waitUntil(async () => {
        const row = await strapi.documents(COMMENT_UID).findOne({ documentId });
        return row.removed === true;
      });
    });
  });

  describe('public visibility', () => {
    it('keeps PENDING replies out of the public comments API until approved', async () => {
      const article = await publishedArticle();
      const remote = await newRemote();
      const noteId = await reply(remote, {
        inReplyTo: articleUri(article.documentId),
        content: '<p>awaiting review</p>',
      });
      const comment = await waitUntil(() => findComment(noteId));
      const relation = `${ARTICLE_UID}:${article.documentId}`;

      const contentsOf = async (path) => {
        const res = await request(strapi.server.httpServer).get(path).expect(200);
        const items = Array.isArray(res.body) ? res.body : res.body.data;
        return items.map((item) => item.content);
      };

      expect(await contentsOf(`/api/comments/${relation}/flat`)).not.toContain('awaiting review');
      expect(await contentsOf(`/api/comments/${relation}`)).not.toContain('awaiting review');

      await strapi
        .documents(COMMENT_UID)
        .update({ documentId: comment.documentId, data: { approvalStatus: 'APPROVED' } });

      expect(await contentsOf(`/api/comments/${relation}/flat`)).toContain('awaiting review');
      expect(await contentsOf(`/api/comments/${relation}`)).toContain('awaiting review');
    });
  });

  describe('helpers', () => {
    it('htmlToPlainText strips tags, keeps breaks and never turns entities into markup', () => {
      expect(htmlToPlainText('<p>a<br>b</p><p>c</p>')).toBe('a\nb\n\nc');
      expect(htmlToPlainText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(
        '<script>alert(1)</script>'
      );
      expect(htmlToPlainText('<b onclick="x()">bold</b> &#39;q&#39; &#x41; &nbsp;end')).toBe(
        "bold 'q' A  end"
      );
    });

    it('stripLeadingMentions removes only our own leading mentions', () => {
      expect(stripLeadingMentions('@devbog@blog.example @devbog hi @devbog', 'devbog')).toBe(
        'hi @devbog'
      );
      expect(stripLeadingMentions('@someone hi', 'devbog')).toBe('@someone hi');
      expect(
        stripLeadingMentions('@bogdev@blog.example @devbog hola @bogdev', ['bogdev', 'devbog'])
      ).toBe('hola @bogdev');
    });

    it('parseFrontendArticleUrl understands default and prefixed locales', () => {
      expect(parseFrontendArticleUrl('https://blog.example.test/blog/my-post')).toEqual({
        slug: 'my-post',
        locale: 'en',
      });
      expect(parseFrontendArticleUrl('https://blog.example.test/es/blog/mi-post/')).toEqual({
        slug: 'mi-post',
        locale: 'es',
      });
      expect(parseFrontendArticleUrl('https://other.example/blog/my-post')).toBeNull();
      expect(parseFrontendArticleUrl('https://blog.example.test/about')).toBeNull();
    });

    it('pruneHiddenComments drops hidden comments together with their subtrees', () => {
      const tree = [
        {
          id: 1,
          approvalStatus: 'APPROVED',
          children: [{ id: 2, approvalStatus: 'PENDING', children: [] }],
        },
        { id: 3, approvalStatus: 'REJECTED', children: [{ id: 4, approvalStatus: 'APPROVED' }] },
        { id: 5, approvalStatus: null, children: [] },
      ];

      const pruned = pruneHiddenComments({ data: tree });

      expect(pruned.data.map((c) => c.id)).toEqual([1, 5]);
      expect(pruned.data[0].children).toEqual([]);
    });
  });
});
