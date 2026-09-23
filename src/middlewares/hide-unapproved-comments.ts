import type { Core } from '@strapi/strapi';

const HIDDEN_STATUSES = new Set(['PENDING', 'REJECTED']);
const COMMENTS_API_PREFIX = '/api/comments/';

function isHidden(value: unknown): boolean {
  return (
    value != null &&
    typeof value === 'object' &&
    HIDDEN_STATUSES.has((value as { approvalStatus?: string }).approvalStatus ?? '')
  );
}

/**
 * Removes hidden comments — and, since they hang off a hidden parent, their
 * whole subtree — from the shapes the comments plugin returns: a bare array
 * (hierarchy), or `{ data: [...] }` (flat / per-author), with nested
 * `children` arrays.
 */
export function pruneHiddenComments<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter((item) => !isHidden(item)).map((item) => pruneHiddenComments(item)) as T;
  }
  if (value != null && typeof value === 'object') {
    const node: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    if ('data' in node) node.data = pruneHiddenComments(node.data);
    if ('children' in node) node.children = pruneHiddenComments(node.children);
    return node as T;
  }
  return value;
}

/**
 * The comments plugin's public endpoints return every comment unless the
 * caller filters by `approvalStatus`, and clients don't. Fediverse replies are
 * stored as `PENDING` so a moderator can approve them, so without this they
 * would be public the instant a remote server delivered them.
 */
export default (_config: unknown, _deps: { strapi: Core.Strapi }) =>
  async (
    ctx: { method: string; path: string; status: number; body?: unknown; notFound: () => void },
    next: () => Promise<unknown>
  ) => {
    await next();

    if (ctx.method !== 'GET' || !ctx.path.startsWith(COMMENTS_API_PREFIX)) return;
    if (ctx.status !== 200 || ctx.body == null) return;

    if (isHidden(ctx.body)) {
      ctx.notFound();
      return;
    }
    ctx.body = pruneHiddenComments(ctx.body);
  };
