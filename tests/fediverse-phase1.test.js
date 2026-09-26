'use strict';

// Enable the fediverse plugin before Strapi boots (config/plugins.ts reads it).
process.env.FEDIVERSE_ENABLED = 'true';
process.env.FEDIVERSE_ACTOR_IDENTIFIER = process.env.FEDIVERSE_ACTOR_IDENTIFIER || 'devbog';
process.env.FRONTEND_URL = 'https://blog.example.test';

const { setupStrapi, cleanupStrapi } = require('./strapi');
const { createRemoteActor } = require('./helpers/remote-actor');
const { waitUntil } = require('./helpers/wait-until');

const ACTIVITY_JSON = 'application/activity+json';

async function writeGlobal(data) {
  const existing = await strapi.documents('api::global.global').findFirst();
  if (existing) {
    return strapi.documents('api::global.global').update({ documentId: existing.documentId, data });
  }
  return strapi.documents('api::global.global').create({ data });
}

async function createImage(name) {
  return strapi.db.query('plugin::upload.file').create({
    data: {
      name,
      hash: name.replace(/\W/g, '_'),
      ext: '.png',
      mime: 'image/png',
      size: 1,
      url: `/uploads/${name}`,
      provider: 'local',
    },
  });
}

async function clearFollowers() {
  const rows = await strapi.db.query('plugin::fediverse.follower').findMany();
  for (const row of rows) {
    await strapi.db
      .query('plugin::fediverse.follower')
      .delete({ where: { documentId: row.documentId } });
  }
}

describe('Fediverse federation (Phase 1: actor, keys, followers)', () => {
  let host;
  let actorUrl;
  let followersService;

  beforeAll(async () => {
    await setupStrapi();

    const port = strapi.server.httpServer.address().port;
    host = `127.0.0.1:${port}`;
    actorUrl = `http://${host}/fediverse/user/devbog`;
    followersService = strapi.plugin('fediverse').service('followers');
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  afterEach(async () => {
    await clearFollowers();
  });

  it('derives the actor name and summary from the global settings single type', async () => {
    await writeGlobal({
      siteName: 'Test DevBog',
      siteDescription: 'A blog about testing federation.',
    });

    const res = await fetch(actorUrl, { headers: { accept: ACTIVITY_JSON } });
    const body = await res.json();

    expect(body.name).toBe('Test DevBog');
    expect(body.summary).toBe('A blog about testing federation.');
  });

  it('never names the actor after the About page title', async () => {
    // No global settings yet, but an About page whose heading isn't a name.
    const documents = (uid) => ({
      findFirst: async () => (uid === 'api::about.about' ? { title: 'Acerca de este blog' } : null),
    });
    const profile = await strapi
      .plugin('fediverse')
      .service('actor-profile')
      .getActorProfile({ ...strapi, documents }, actorUrl);

    expect(profile.name).toBe('BogDev');
  });

  it('serves the avatar, header, frontend link and profile fields', async () => {
    const icon = await createImage('avatar.png');
    const header = await createImage('header.png');
    await writeGlobal({
      siteName: 'Test DevBog',
      siteDescription: 'A blog about testing federation.',
      favicon: icon.id,
      fediverseHeader: header.id,
    });

    const res = await fetch(actorUrl, { headers: { accept: ACTIVITY_JSON } });
    const body = await res.json();

    expect(body.icon.url).toBe(`http://${host}/uploads/avatar.png`);
    expect(body.image.url).toBe(`http://${host}/uploads/header.png`);
    expect(body.url).toBe('https://blog.example.test/');
    const fields = body.attachment.map((field) => [field.type, field.name, field.value]);
    expect(fields).toEqual([
      [
        'PropertyValue',
        'Blog',
        '<a href="https://blog.example.test/" rel="me nofollow noopener" target="_blank">blog.example.test</a>',
      ],
      [
        'PropertyValue',
        'Código',
        '<a href="https://github.com/ale9420/devbog-blog-backend" rel="me nofollow noopener" target="_blank">github.com/ale9420/devbog-blog-backend</a>',
      ],
    ]);
  });

  it('sends Update(Person) to followers when the global settings change', async () => {
    const remote = await createRemoteActor({ preferredUsername: 'profile-reader' });
    try {
      await followersService.recordFollower(strapi, {
        actorId: remote.actorUrl,
        inbox: remote.inboxUrl,
      });

      await writeGlobal({ siteName: 'Renamed DevBog', siteDescription: 'New bio.' });

      const update = await waitUntil(() =>
        remote.inboxDeliveries.find(
          (a) =>
            a.type === 'Update' &&
            a.object?.type === 'Person' &&
            a.object?.name === 'Renamed DevBog'
        )
      );
      expect(update.actor).toMatch(/\/fediverse\/user\/devbog$/);
      expect(update.object.id).toBe(update.actor);
      expect(update.object.summary).toBe('New bio.');
    } finally {
      await remote.close();
    }
  });

  it('builds actor URLs with the public scheme when behind a TLS-terminating proxy', async () => {
    const res = await fetch(actorUrl, {
      headers: { accept: ACTIVITY_JSON, 'x-forwarded-proto': 'https' },
    });
    const body = await res.json();

    expect(body.id).toBe(`https://${host}/fediverse/user/devbog`);
    expect(body.inbox).toBe(`https://${host}/fediverse/user/devbog/inbox`);
  });

  it('opts the actor into Mastodon directory discovery', async () => {
    const res = await fetch(actorUrl, { headers: { accept: ACTIVITY_JSON } });
    const body = await res.json();

    expect(body.discoverable).toBe(true);
  });

  it('persists the actor key pair instead of regenerating it on every request', async () => {
    const keysService = strapi.plugin('fediverse').service('keys');
    const stored = await keysService.getStoredKeyPairEntries(strapi);
    expect(stored).not.toBeNull();

    const keyOf = (body) =>
      body.assertionMethod?.[0]?.publicKeyMultibase ?? body.publicKey?.publicKeyPem;

    const resA = await fetch(actorUrl, { headers: { accept: ACTIVITY_JSON } });
    const resB = await fetch(actorUrl, { headers: { accept: ACTIVITY_JSON } });
    const keyA = keyOf(await resA.json());
    const keyB = keyOf(await resB.json());

    expect(keyA).toBeTruthy();
    expect(keyA).toBe(keyB);
  });

  describe('followers service', () => {
    it('upserts profile fields on re-follow', async () => {
      const input = {
        actorId: 'https://example.social/users/alice',
        handle: '@alice@example.social',
        name: 'Alice',
      };
      const created = await followersService.recordFollower(strapi, input);
      expect(created.blocked).toBe(false);
      expect(created.name).toBe('Alice');

      const updated = await followersService.recordFollower(strapi, {
        ...input,
        name: 'Alice Updated',
      });
      expect(updated.documentId).toBe(created.documentId);
      expect(updated.name).toBe('Alice Updated');
    });

    it('ignores re-follows entirely once an admin has blocked the actor', async () => {
      const input = {
        actorId: 'https://example.social/users/blocked-alice',
        name: 'Blocked Alice',
      };
      const created = await followersService.recordFollower(strapi, input);
      await strapi.db.query('plugin::fediverse.follower').update({
        where: { documentId: created.documentId },
        data: { blocked: true },
      });

      const reFollowed = await followersService.recordFollower(strapi, {
        ...input,
        name: 'New Name',
      });

      expect(reFollowed.blocked).toBe(true);
      expect(reFollowed.name).toBe('Blocked Alice');
    });

    it('removeFollower deletes the row and reports whether one existed', async () => {
      const created = await followersService.recordFollower(strapi, {
        actorId: 'https://example.social/users/bob',
      });

      await expect(followersService.removeFollower(strapi, created.actorId)).resolves.toBe(true);
      await expect(followersService.removeFollower(strapi, created.actorId)).resolves.toBe(false);
    });

    it('listFollowers/countFollowers exclude blocked actors by default', async () => {
      await followersService.recordFollower(strapi, {
        actorId: 'https://example.social/users/carol',
      });
      const blocked = await followersService.recordFollower(strapi, {
        actorId: 'https://example.social/users/dave',
      });
      await strapi.db.query('plugin::fediverse.follower').update({
        where: { documentId: blocked.documentId },
        data: { blocked: true },
      });

      const followers = await followersService.listFollowers(strapi);
      expect(followers.map((f) => f.actorId)).toEqual(['https://example.social/users/carol']);
      await expect(followersService.countFollowers(strapi)).resolves.toBe(1);
    });
  });

  describe('followers dispatcher', () => {
    it('serves the public followers collection, counting only non-blocked followers', async () => {
      await followersService.recordFollower(strapi, {
        actorId: 'https://example.social/users/erin',
      });
      const blocked = await followersService.recordFollower(strapi, {
        actorId: 'https://example.social/users/frank',
      });
      await strapi.db.query('plugin::fediverse.follower').update({
        where: { documentId: blocked.documentId },
        data: { blocked: true },
      });

      const res = await fetch(`${actorUrl}/followers`, { headers: { accept: ACTIVITY_JSON } });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.totalItems).toBe(1);
    });
  });

  describe('NodeInfo dispatcher', () => {
    it('reports honest software identity and usage stats', async () => {
      const res = await fetch(`http://${host}/nodeinfo/2.1`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.software.name).toBe('devbog-strapi');
      expect(body.protocols).toContain('activitypub');
      expect(typeof body.usage.localPosts).toBe('number');
    });
  });

  describe('signed inbox activities', () => {
    it('accepts a signed Follow: records the follower and sends back a signed Accept', async () => {
      const remote = await createRemoteActor({ preferredUsername: 'signed-alice' });
      try {
        const res = await remote.postSignedActivity(`${actorUrl}/inbox`, {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${remote.actorUrl}/follows/1`,
          type: 'Follow',
          actor: remote.actorUrl,
          object: actorUrl,
        });
        expect(res.ok).toBe(true);

        await waitUntil(() =>
          strapi.db
            .query('plugin::fediverse.follower')
            .findOne({ where: { actorId: remote.actorUrl } })
        );

        const accept = await waitUntil(() =>
          remote.inboxDeliveries.find((activity) => activity.type === 'Accept')
        );
        expect(accept.actor).toBe(actorUrl);
      } finally {
        await remote.close();
      }
    });

    it('ignores a Follow addressed to a different actor', async () => {
      const remote = await createRemoteActor({ preferredUsername: 'misaddressed' });
      try {
        const res = await remote.postSignedActivity(`${actorUrl}/inbox`, {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${remote.actorUrl}/follows/1`,
          type: 'Follow',
          actor: remote.actorUrl,
          object: `http://${host}/fediverse/user/somebody-else`,
        });
        expect(res.ok).toBe(true);

        // Give the (synchronously-processed) listener a moment to run, then
        // confirm it did not record a follower for a Follow aimed elsewhere.
        await new Promise((resolve) => setTimeout(resolve, 200));
        const row = await strapi.db
          .query('plugin::fediverse.follower')
          .findOne({ where: { actorId: remote.actorUrl } });
        expect(row).toBeNull();
      } finally {
        await remote.close();
      }
    });

    it('removes the follower on Undo(Follow)', async () => {
      const remote = await createRemoteActor({ preferredUsername: 'signed-bob' });
      try {
        await followersService.recordFollower(strapi, {
          actorId: remote.actorUrl,
          inbox: remote.inboxUrl,
        });

        const res = await remote.postSignedActivity(`${actorUrl}/inbox`, {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${remote.actorUrl}/undo/1`,
          type: 'Undo',
          actor: remote.actorUrl,
          object: {
            id: `${remote.actorUrl}/follows/1`,
            type: 'Follow',
            actor: remote.actorUrl,
            object: actorUrl,
          },
        });
        expect(res.ok).toBe(true);

        await waitUntil(async () => {
          const row = await strapi.db
            .query('plugin::fediverse.follower')
            .findOne({ where: { actorId: remote.actorUrl } });
          return row == null;
        });
      } finally {
        await remote.close();
      }
    });

    it("does not let one account undo another account's follow on the same server", async () => {
      const attacker = await createRemoteActor({ preferredUsername: 'attacker' });
      try {
        // Same origin as the attacker: Fedify trusts objects embedded from the
        // sender's own origin, so only our actor check stands in the way.
        const victimId = `${new URL(attacker.actorUrl).origin}/users/victim`;
        await followersService.recordFollower(strapi, { actorId: victimId });

        // Signed by the attacker, but embedding a Follow that claims to be the victim's.
        const res = await attacker.postSignedActivity(`${actorUrl}/inbox`, {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${attacker.actorUrl}/undo/forged`,
          type: 'Undo',
          actor: attacker.actorUrl,
          object: {
            id: `${victimId}/follows/1`,
            type: 'Follow',
            actor: victimId,
            object: actorUrl,
          },
        });
        expect(res.ok).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 500));

        const row = await strapi.db
          .query('plugin::fediverse.follower')
          .findOne({ where: { actorId: victimId } });
        expect(row).not.toBeNull();
      } finally {
        await attacker.close();
      }
    });

    it('removes the follower on Block', async () => {
      const remote = await createRemoteActor({ preferredUsername: 'signed-carol' });
      try {
        await followersService.recordFollower(strapi, {
          actorId: remote.actorUrl,
          inbox: remote.inboxUrl,
        });

        const res = await remote.postSignedActivity(`${actorUrl}/inbox`, {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${remote.actorUrl}/block/1`,
          type: 'Block',
          actor: remote.actorUrl,
          object: actorUrl,
        });
        expect(res.ok).toBe(true);

        await waitUntil(async () => {
          const row = await strapi.db
            .query('plugin::fediverse.follower')
            .findOne({ where: { actorId: remote.actorUrl } });
          return row == null;
        });
      } finally {
        await remote.close();
      }
    });
  });
});
