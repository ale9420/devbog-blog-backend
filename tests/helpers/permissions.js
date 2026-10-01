'use strict';

async function getRole(type) {
  return strapi.query('plugin::users-permissions.role').findOne({ where: { type } });
}

async function getPublicRole() {
  return getRole('public');
}

async function setRolePermissions(roleType, contentType, actions) {
  const role = await getRole(roleType);

  if (!role) {
    throw new Error(`Role ${roleType} not found`);
  }

  const permissionQueries = actions.map((action) =>
    strapi.query('plugin::users-permissions.permission').create({
      data: {
        action: `api::${contentType}.${contentType}.${action}`,
        role: role.id,
      },
    })
  );

  await Promise.all(permissionQueries);

  // Reload the users-permissions cache so new permissions take effect immediately
  await strapi.service('plugin::users-permissions.users-permissions').initialize();
}

async function setPublicPermissions(contentType, actions) {
  return setRolePermissions('public', contentType, actions);
}

module.exports = { getRole, getPublicRole, setRolePermissions, setPublicPermissions };
