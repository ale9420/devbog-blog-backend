import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setPublicPermissions } from './helpers/permissions';
import { revokeSubscriberPermissions } from '../src/migrations/subscriber-permissions';

// The frontend server owns the newsletter flow (front #193): it stores the
// confirmation and unsubscribe tokens with its API token and later finds the
// subscriber by either one.

describe('Subscribers', () => {
  let auth: { Authorization: string };

  const http = () => request(strapi.server.httpServer);

  async function find(filters: Record<string, unknown>): Promise<{ documentId: string }[]> {
    const res = await http().get('/api/subscribers').query({ filters }).set(auth);
    expect(res.status).toBe(200);
    return res.body.data;
  }

  beforeAll(async () => {
    await setupStrapi();
    const { accessKey } = await strapi
      .service('admin::api-token')
      .create({ name: 'frontend', type: 'full-access', lifespan: null });
    auth = { Authorization: `Bearer ${accessKey}` };
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('stores the tokens and the language sent by the frontend, without drafts', async () => {
    const created = await http()
      .post('/api/subscribers')
      .set(auth)
      .send({
        data: {
          email: 'ana@example.com',
          confirmationToken: 'confirm-token',
          unsubscribeToken: 'unsubscribe-token',
          confirmed: false,
          language: 'es',
        },
      });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      email: 'ana@example.com',
      confirmationToken: 'confirm-token',
      unsubscribeToken: 'unsubscribe-token',
      confirmed: false,
      language: 'es',
    });
    expect(created.body.data.publishedAt).not.toBeNull();

    expect(await find({ email: { $eq: 'ana@example.com' } })).toHaveLength(1);
    expect(await find({ confirmationToken: { $eq: 'confirm-token' } })).toHaveLength(1);
    expect(await find({ unsubscribeToken: { $eq: 'unsubscribe-token' } })).toHaveLength(1);
  });

  it('confirms and deletes a subscriber', async () => {
    const [subscriber] = await find({ unsubscribeToken: { $eq: 'unsubscribe-token' } });

    const confirmed = await http()
      .put(`/api/subscribers/${subscriber.documentId}`)
      .set(auth)
      .send({ data: { confirmed: true, confirmationToken: null } });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({ confirmed: true, confirmationToken: null });

    const deleted = await http().delete(`/api/subscribers/${subscriber.documentId}`).set(auth);
    expect(deleted.status).toBe(204);
    expect(await find({ unsubscribeToken: { $eq: 'unsubscribe-token' } })).toEqual([]);
  });

  it('defaults to English and unconfirmed', async () => {
    const created = await http()
      .post('/api/subscribers')
      .set(auth)
      .send({ data: { email: 'bo@example.com' } });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ language: 'en', confirmed: false });
  });

  it('rejects a repeated email and an unknown language', async () => {
    const repeated = await http()
      .post('/api/subscribers')
      .set(auth)
      .send({ data: { email: 'bo@example.com' } });
    expect(repeated.status).toBe(400);

    const unknown = await http()
      .post('/api/subscribers')
      .set(auth)
      .send({ data: { email: 'cy@example.com', language: 'fr' } });
    expect(unknown.status).toBe(400);
  });

  it('revokes every role permission on subscribers', async () => {
    await setPublicPermissions('subscriber', ['create', 'find']);
    const before = await http()
      .post('/api/subscribers')
      .send({ data: { email: 'eve@example.com', confirmed: true } });
    expect(before.status).toBe(201);

    expect(await revokeSubscriberPermissions(strapi)).toBe(2);
    expect(await revokeSubscriberPermissions(strapi)).toBe(0);

    const create = await http()
      .post('/api/subscribers')
      .send({ data: { email: 'mal@example.com', confirmed: true } });
    expect(create.status).toBe(403);
    const list = await http().get('/api/subscribers');
    expect(list.status).toBe(403);
  });
});
