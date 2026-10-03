import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { getPublicRole, getRole } from './helpers/permissions';
import { applyAccountSettings } from '../src/migrations/account-settings';

const USER_UID = 'plugin::users-permissions.user';
const PERMISSION_UID = 'plugin::users-permissions.permission';
const ARTICLE_UID = 'api::article.article';
const COMMENT_UID = 'plugin::comments.comment';
const PASSWORD = 'Sup3r-secret';

/** What the email service receives; tests read the link out of the body. */
interface SentEmail {
  to: string;
  subject?: string;
  html?: string;
  text?: string;
}

type EmailTemplates = Record<string, { options: { object: string } }>;
type User = { id: number };

describe('Accounts (users-permissions)', () => {
  const sent: SentEmail[] = [];
  let relation: string;

  const http = () => request(strapi.server.httpServer);
  const pluginStore = () => strapi.store({ type: 'plugin', name: 'users-permissions' });
  const jwtFor = (user: User) =>
    strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
  const createUser = async (username: string, roleType = 'authenticated'): Promise<User> => {
    const role = await getRole(roleType);
    return strapi
      .plugin('users-permissions')
      .service('user')
      .add({
        username,
        email: `${username}@example.com`,
        password: PASSWORD,
        provider: 'local',
        confirmed: true,
        role: role.id,
      });
  };
  const linkIn = (email: SentEmail): string => {
    const link = /href="([^"]+)"/.exec(email.html ?? email.text ?? '')?.[1];
    if (!link) throw new Error('The email has no link');
    return link;
  };

  beforeAll(async () => {
    process.env.FRONTEND_URL = 'https://bogdev.test';
    await setupStrapi();

    // Captures what would go out through SMTP.
    strapi.plugin('email').service('email').send = async (options: SentEmail) => {
      sent.push(options);
    };

    const publicRole = await getPublicRole();
    await strapi.query(PERMISSION_UID).create({
      data: { action: 'plugin::comments.client.findAllFlat', role: publicRole.id },
    });
    await strapi.service('plugin::users-permissions.users-permissions').initialize();

    const draft = await strapi
      .documents(ARTICLE_UID)
      .create({ data: { title: 'Comment target', slug: 'comment-target' } });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });
    relation = `${ARTICLE_UID}:${draft.documentId}`;
  });

  afterAll(async () => {
    await cleanupStrapi();
    delete process.env.FRONTEND_URL;
  });

  describe('settings', () => {
    it('turns on sign-up with email confirmation and frontend links', async () => {
      expect(await pluginStore().get({ key: 'advanced' })).toMatchObject({
        allow_register: true,
        default_role: 'authenticated',
        unique_email: true,
        email_confirmation: true,
        email_confirmation_redirection: 'https://bogdev.test/account/confirmed',
        email_reset_password: 'https://bogdev.test/account/reset-password',
      });
    });

    it('writes the email templates in Spanish', async () => {
      const email = (await pluginStore().get({ key: 'email' })) as EmailTemplates;
      expect(email.email_confirmation.options.object).toBe('Confirma tu correo en BogDev');
      expect(email.reset_password.options.object).toBe('Restablece tu contraseña de BogDev');
    });

    it('applies the settings once and keeps what an admin changes', async () => {
      const advanced = (await pluginStore().get({ key: 'advanced' })) as Record<string, unknown>;
      await pluginStore().set({ key: 'advanced', value: { ...advanced, allow_register: false } });

      const report = await applyAccountSettings(strapi);

      expect(report).toEqual({ settingsApplied: false, permissionsGranted: 0 });
      expect(await pluginStore().get({ key: 'advanced' })).toMatchObject({ allow_register: false });
      await pluginStore().set({ key: 'advanced', value: advanced });
    });

    it('issues JWTs that last 7 days', async () => {
      const user = await createUser('jwt-reader');
      const [, payload] = jwtFor(user).split('.');
      const { iat, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
      expect(exp - iat).toBe(7 * 24 * 60 * 60);
    });
  });

  describe('sign-up', () => {
    it('confirms the email before the account can sign in', async () => {
      sent.length = 0;
      await http()
        .post('/api/auth/local/register')
        .send({ username: 'ana', email: 'ana@example.com', password: PASSWORD })
        .expect(200);

      const login = () =>
        http().post('/api/auth/local').send({ identifier: 'ana@example.com', password: PASSWORD });
      expect((await login()).status).toBe(400);

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        to: 'ana@example.com',
        subject: 'Confirma tu correo en BogDev',
      });
      const link = new URL(linkIn(sent[0]));
      expect(link.pathname).toBe('/api/auth/email-confirmation');

      const confirm = await http().get(`${link.pathname}${link.search}`).expect(302);
      expect(confirm.headers.location).toBe('https://bogdev.test/account/confirmed');

      const res = await login();
      expect(res.status).toBe(200);
      expect(res.body.jwt).toEqual(expect.any(String));
    });

    it('rejects a role in the registration body', async () => {
      const res = await http()
        .post('/api/auth/local/register')
        .send({
          username: 'mallory',
          email: 'mallory@example.com',
          password: PASSWORD,
          role: (await getRole('editor')).id,
        });

      expect(res.status).toBe(400);
      expect(await strapi.query(USER_UID).count({ where: { username: 'mallory' } })).toBe(0);
    });
  });

  describe('password reset', () => {
    it('sends a frontend link whose code sets a new password', async () => {
      await createUser('forgetful');
      sent.length = 0;

      await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'forgetful@example.com' })
        .expect(200);

      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe('Restablece tu contraseña de BogDev');
      const link = new URL(linkIn(sent[0]));
      expect(`${link.origin}${link.pathname}`).toBe('https://bogdev.test/account/reset-password');

      const newPassword = 'An0ther-secret';
      await http()
        .post('/api/auth/reset-password')
        .send({
          code: link.searchParams.get('code'),
          password: newPassword,
          passwordConfirmation: newPassword,
        })
        .expect(200);

      const res = await http()
        .post('/api/auth/local')
        .send({ identifier: 'forgetful@example.com', password: newPassword });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/users/me', () => {
    it('returns the editor role', async () => {
      const editor = await createUser('editor-me', 'editor');
      const res = await http()
        .get('/api/users/me?populate=role')
        .set('Authorization', `Bearer ${jwtFor(editor)}`)
        .expect(200);
      expect(res.body.role.type).toBe('editor');
    });
  });

  describe('DELETE /api/users/me', () => {
    const deleteMe = (user: User | null, body: object = { password: PASSWORD }) => {
      const req = http().delete('/api/users/me').send(body);
      return user ? req.set('Authorization', `Bearer ${jwtFor(user)}`) : req;
    };
    const exists = async (user: User) =>
      (await strapi.query(USER_UID).count({ where: { id: user.id } })) > 0;

    it('requires a JWT', async () => {
      await deleteMe(null).expect(401);
    });

    it('keeps the account when the password is wrong', async () => {
      const user = await createUser('wrong-password');

      const res = await deleteMe(user, { password: 'not-it' }).expect(400);

      expect(res.body.error.message).toBe('Invalid password');
      expect(await exists(user)).toBe(true);
    });

    it('deletes only the user of the JWT, whatever id the request carries', async () => {
      const user = await createUser('leaving');
      const other = await createUser('staying');

      await deleteMe(user, { password: PASSWORD, id: other.id }).expect(204);

      expect(await exists(user)).toBe(false);
      expect(await exists(other)).toBe(true);
    });

    it('works for editors', async () => {
      const editor = await createUser('leaving-editor', 'editor');
      await deleteMe(editor).expect(204);
      expect(await exists(editor)).toBe(false);
    });

    it('keeps the comments of the deleted account as «Anónimo»', async () => {
      const user = await createUser('commenter');
      await strapi.query(COMMENT_UID).create({
        data: {
          content: 'written before leaving',
          related: relation,
          approvalStatus: 'APPROVED',
          authorUser: user.id,
        },
      });

      await deleteMe(user).expect(204);

      const res = await http().get(`/api/comments/${relation}/flat`).expect(200);
      const items = Array.isArray(res.body) ? res.body : res.body.data;
      const comment = (items as { content: string; author: unknown }[]).find(
        (item) => item.content === 'written before leaving'
      );
      expect(comment?.author).toMatchObject({ id: 'anonymous', name: 'Anónimo', email: null });

      const row = await strapi
        .query(COMMENT_UID)
        .findOne({ where: { content: 'written before leaving' }, populate: ['authorUser'] });
      expect(row).toMatchObject({ authorUser: null, authorEmail: null, authorName: 'Anónimo' });
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('stays closed to every role', async () => {
      const victim = await createUser('victim');
      const authenticated = await createUser('attacker');
      const editor = await createUser('attacker-editor', 'editor');

      await http().delete(`/api/users/${victim.id}`).expect(403);
      for (const user of [authenticated, editor]) {
        await http()
          .delete(`/api/users/${victim.id}`)
          .set('Authorization', `Bearer ${jwtFor(user)}`)
          .expect(403);
      }
      expect(await strapi.query(USER_UID).count({ where: { id: victim.id } })).toBe(1);
    });
  });
});
