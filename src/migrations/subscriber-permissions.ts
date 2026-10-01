import type { Core } from '@strapi/strapi';

const PERMISSION_UID = 'plugin::users-permissions.permission';
const SUBSCRIBER_ACTION_PREFIX = 'api::subscriber.subscriber.';

/**
 * Removes every users-permissions permission on subscribers. The frontend
 * server is the only client: it reads and writes them with its API token, so
 * no role needs them, and a public `create` would let anyone store a
 * subscriber already confirmed or with tokens of their choosing. Idempotent.
 * Returns how many permissions were removed.
 */
export async function revokeSubscriberPermissions(strapi: Core.Strapi): Promise<number> {
  const permissions = (await strapi.db.query(PERMISSION_UID).findMany({
    select: ['id'],
    where: { action: { $startsWith: SUBSCRIBER_ACTION_PREFIX } },
  })) as { id: number }[];
  if (permissions.length === 0) return 0;

  await strapi.db.query(PERMISSION_UID).deleteMany({
    where: { id: { $in: permissions.map((permission) => permission.id) } },
  });
  await strapi.service('plugin::users-permissions.users-permissions').initialize();
  return permissions.length;
}
