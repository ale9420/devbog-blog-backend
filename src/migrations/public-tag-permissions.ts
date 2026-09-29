import type { Core } from '@strapi/strapi';

const ROLE_UID = 'plugin::users-permissions.role';
const PERMISSION_UID = 'plugin::users-permissions.permission';
const ACTIONS = ['api::tag.tag.find', 'api::tag.tag.findOne'];

/**
 * Lets the public role read tags, as it reads categories. The frontend asks
 * for `populate[tags]` on every article list, and Strapi rejects the whole
 * request when the role can't read the populated type, so this can't wait for
 * someone to tick the boxes in the admin. Idempotent: only missing actions are
 * created. Returns how many were created.
 */
export async function grantPublicTagPermissions(strapi: Core.Strapi): Promise<number> {
  const role = (await strapi.db.query(ROLE_UID).findOne({ where: { type: 'public' } })) as {
    id: number;
  } | null;
  if (!role) return 0;

  const existing = (await strapi.db.query(PERMISSION_UID).findMany({
    select: ['action'],
    where: { role: role.id, action: { $in: ACTIONS } },
  })) as { action: string }[];
  const granted = new Set(existing.map((permission) => permission.action));
  const missing = ACTIONS.filter((action) => !granted.has(action));

  for (const action of missing) {
    await strapi.db.query(PERMISSION_UID).create({ data: { action, role: role.id } });
  }
  return missing.length;
}
