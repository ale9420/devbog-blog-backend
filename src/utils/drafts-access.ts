import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { EDITOR_ROLE_TYPE } from '../constants/roles';

/** Document Service actions that return documents to the caller. */
const READ_ACTIONS = new Set(['findMany', 'findOne', 'findFirst', 'count']);

type RequestState = {
  route?: { info?: { type?: string } };
  auth?: { strategy?: { name?: string } };
  user?: { role?: { type?: string } };
};

/**
 * Whether a content API request may read drafts: only a users-permissions
 * user with the Editor role. Public, other roles and API tokens (including the
 * frontend's STRAPI_API_TOKEN) may not.
 */
export function canReadDrafts(state: RequestState): boolean {
  return (
    state.auth?.strategy?.name === 'users-permissions' &&
    state.user?.role?.type === EDITOR_ROLE_TYPE
  );
}

/**
 * Restricts `status=draft` on the content API to editors (issue #53).
 *
 * Strapi 5 serves drafts to any caller with `find`/`findOne` when the request
 * carries `?status=draft`, and the status also applies to populated relations
 * (`/api/categories?populate=articles&status=draft` returns article drafts).
 * Checking it in the Document Service covers every content API route, custom
 * or core, whatever the root content type. Admin panel, admin API and `/mcp`
 * requests (not `content-api` routes) and calls outside a request (cron,
 * eventHub, bootstrap) are left alone.
 */
export function restrictDraftsToEditors(strapi: Core.Strapi) {
  strapi.documents.use(async (context, next) => {
    const status = (context.params as { status?: unknown }).status;
    if (!READ_ACTIONS.has(context.action) || status === undefined || status === 'published') {
      return next();
    }

    const state = strapi.requestContext.get()?.state as RequestState | undefined;
    if (state?.route?.info?.type === 'content-api' && !canReadDrafts(state)) {
      throw new errors.ForbiddenError('Drafts are only available to editors');
    }
    return next();
  });
}
