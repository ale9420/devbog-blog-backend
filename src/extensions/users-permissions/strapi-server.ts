// Adds DELETE /api/users/me so each person can delete their own account
// (issue #52). Strapi has no such route, and opening `DELETE /api/users/:id`
// to a role would let it delete anyone.
import type { Context, Next } from 'koa';
import { errors } from '@strapi/utils';
import { checkPassword, deleteAccount } from './delete-account';

type Route = { method: string; path: string; handler: string; config?: Record<string, unknown> };

interface UsersPermissionsPlugin {
  controllers: { user: Record<string, (ctx: Context) => Promise<unknown>> };
  routes: { 'content-api': { routes: Route[] } };
}

/**
 * Keeps only `password` in the body before the plugin's rate limiter, which
 * keys the bucket on `body.email` when present: an extra `email` per request
 * would get a fresh bucket each time and bypass the limit.
 */
async function onlyPassword(ctx: Context, next: Next) {
  const body = (ctx.request as unknown as { body?: { password?: unknown } }).body;
  (ctx.request as unknown as { body: object }).body = { password: body?.password };
  await next();
}

type SessionUser = {
  id: number;
  role?: { id: number; documentId: string; name: string; type: string };
};

export default (plugin: UsersPermissionsPlugin) => {
  // The frontend reads the role of the session user (`role.type === 'editor'`)
  // from /users/me, but populating `role` needs `role.find` on the caller's
  // role, which would list every role to anyone signed in. The authenticated
  // user's own role is already loaded, so add it when the response lacks it.
  const me = plugin.controllers.user.me;
  plugin.controllers.user.me = async (ctx: Context) => {
    await me(ctx);
    const role = (ctx.state.user as SessionUser | undefined)?.role;
    const body = ctx.body as Record<string, unknown> | undefined;
    if (role && body && typeof body === 'object' && !body.role) {
      const { id, documentId, name, type } = role;
      ctx.body = { ...body, role: { id, documentId, name, type } };
    }
  };

  plugin.controllers.user.destroyMe = async (ctx: Context) => {
    // Only the user of the JWT, never an id from the request. The Public role
    // has this action only so a request without a JWT gets here and answers
    // 401, as /users/me does, instead of Strapi's 403.
    const user = ctx.state.user as SessionUser | undefined;
    if (!user) return ctx.unauthorized();

    const { password } = (ctx.request as unknown as { body: { password?: unknown } }).body;
    if (!(await checkPassword(strapi, user.id, password))) {
      throw new errors.ValidationError('Invalid password');
    }

    await deleteAccount(strapi, user.id);
    ctx.status = 204;
  };

  // First, so `/users/:id` doesn't take `me` as an id.
  plugin.routes['content-api'].routes.unshift({
    method: 'DELETE',
    path: '/users/me',
    handler: 'user.destroyMe',
    config: {
      prefix: '',
      middlewares: [onlyPassword, 'plugin::users-permissions.rateLimit'],
    },
  });

  return plugin;
};
