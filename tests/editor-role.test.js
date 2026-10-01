'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { ensureEditorRole } = require('../src/migrations/editor-role');

const ROLE_UID = 'plugin::users-permissions.role';
const PERMISSION_UID = 'plugin::users-permissions.permission';

describe('Editor role migration', () => {
  let role;

  const http = () => request(strapi.server.httpServer);
  const actionsOf = async (roleId) =>
    (await strapi.query(PERMISSION_UID).findMany({ where: { role: roleId } }))
      .map((permission) => permission.action)
      .sort();

  beforeAll(async () => {
    await setupStrapi();
    role = await strapi.query(ROLE_UID).findOne({ where: { type: 'editor' } });
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('creates the Editor role on bootstrap with read-only permissions', async () => {
    expect(role).toMatchObject({ name: 'Editor', type: 'editor' });
    expect(await actionsOf(role.id)).toEqual([
      'api::article.article.drafts',
      'api::article.article.find',
      'api::article.article.findOne',
      'api::author.author.find',
      'api::author.author.findOne',
      'api::category.category.find',
      'api::category.category.findOne',
      'api::tag.tag.find',
      'api::tag.tag.findOne',
      'plugin::upload.content-api.find',
      'plugin::upload.content-api.findOne',
      'plugin::users-permissions.user.me',
    ]);
  });

  it('is idempotent and keeps permissions added by hand', async () => {
    await strapi.query(PERMISSION_UID).create({
      data: { action: 'api::about.about.find', role: role.id },
    });
    const before = await actionsOf(role.id);

    expect(await ensureEditorRole(strapi)).toEqual({ roleCreated: false, permissionsGranted: 0 });
    expect(await strapi.query(ROLE_UID).count({ where: { type: 'editor' } })).toBe(1);
    expect(await actionsOf(role.id)).toEqual(before);
  });

  it('restores a missing permission without touching the rest', async () => {
    await strapi.query(PERMISSION_UID).delete({
      where: { role: role.id, action: 'api::tag.tag.find' },
    });

    expect(await ensureEditorRole(strapi)).toEqual({ roleCreated: false, permissionsGranted: 1 });
    expect(await actionsOf(role.id)).toContain('api::tag.tag.find');
  });

  describe('as an editor', () => {
    let jwt;

    beforeAll(async () => {
      const user = await strapi.plugin('users-permissions').service('user').add({
        username: 'editor',
        email: 'editor@example.com',
        password: 'Password123!',
        provider: 'local',
        confirmed: true,
        role: role.id,
      });
      jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
    });

    // `populate=role` also needs `users-permissions.role.find`, which would
    // list every role on /api/users-permissions/roles; that is left to #52.
    it('reads its own user', async () => {
      const res = await http()
        .get('/api/users/me')
        .set({ Authorization: `Bearer ${jwt}` })
        .expect(200);
      expect(res.body.username).toBe('editor');
    });

    it('cannot create articles through the API', async () => {
      const res = await http()
        .post('/api/articles')
        .set({ Authorization: `Bearer ${jwt}` })
        .send({ data: { title: 'Nope' } });
      expect(res.status).toBe(403);
    });
  });
});
