import type { Core } from '@strapi/strapi';

const ROLE_UID = 'plugin::users-permissions.role';
const PERMISSION_UID = 'plugin::users-permissions.permission';
const EDITOR = {
  name: 'Editor',
  type: 'editor',
  description: 'Puede ver borradores en el sitio',
};
// Read-only: editors review drafts on the site with `?status=draft`; creating,
// editing and publishing stays in the admin panel. Tags are included because
// the frontend populates them on every article and Strapi rejects the whole
// request when the role can't read a populated type. `user.me` lets the
// frontend read the session user and its role.
const ACTIONS = [
  'api::article.article.find',
  'api::article.article.findOne',
  'api::category.category.find',
  'api::category.category.findOne',
  'api::author.author.find',
  'api::author.author.findOne',
  'api::tag.tag.find',
  'api::tag.tag.findOne',
  'plugin::upload.content-api.find',
  'plugin::upload.content-api.findOne',
  'plugin::users-permissions.user.me',
];

export type EditorRoleReport = { roleCreated: boolean; permissionsGranted: number };

/**
 * Creates the users-permissions Editor role (issue #53) and grants it read
 * access to what the draft view needs. Idempotent: an existing role (matched by
 * `type`) is reused as is, and only missing permissions are created; nothing
 * the admin added by hand is removed.
 */
export async function ensureEditorRole(strapi: Core.Strapi): Promise<EditorRoleReport> {
  let role = (await strapi.db.query(ROLE_UID).findOne({ where: { type: EDITOR.type } })) as {
    id: number;
  } | null;
  const roleCreated = !role;
  if (!role) {
    role = (await strapi.db.query(ROLE_UID).create({ data: EDITOR })) as { id: number };
  }

  const existing = (await strapi.db.query(PERMISSION_UID).findMany({
    select: ['action'],
    where: { role: role.id, action: { $in: ACTIONS } },
  })) as { action: string }[];
  const granted = new Set(existing.map((permission) => permission.action));
  const missing = ACTIONS.filter((action) => !granted.has(action));

  for (const action of missing) {
    await strapi.db.query(PERMISSION_UID).create({ data: { action, role: role.id } });
  }
  return { roleCreated, permissionsGranted: missing.length };
}
