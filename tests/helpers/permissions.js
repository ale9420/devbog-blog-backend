'use strict';

async function getPublicRole() {
  return strapi.query('plugin::users-permissions.role').findOne({
    where: { type: 'public' },
  });
}

async function setPublicPermissions(contentType, actions) {
  const publicRole = await getPublicRole();

  if (!publicRole) {
    throw new Error('Public role not found');
  }

  const permissionQueries = actions.map((action) =>
    strapi.query('plugin::users-permissions.permission').create({
      data: {
        action: `api::${contentType}.${contentType}.${action}`,
        role: publicRole.id,
      },
    })
  );

  await Promise.all(permissionQueries);

  // Reload the users-permissions cache so new permissions take effect immediately
  await strapi.service('plugin::users-permissions.users-permissions').initialize();
}

module.exports = { getPublicRole, setPublicPermissions };
