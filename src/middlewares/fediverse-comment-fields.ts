import type { Core } from '@strapi/strapi';

const COMMENT_UID = 'plugin::comments.comment';
const COMMENTS_API_PREFIX = '/api/comments/';

interface FediverseFields {
  fediverseUri: string | null;
  fediverseActorHandle: string | null;
}

type CommentNode = Record<string, unknown> & { id?: unknown };

/**
 * Walks the shapes the comments plugin returns — a bare array (hierarchy), a
 * single comment, or `{ data: [...] }` (flat / per-author), with nested
 * `children` arrays — and calls `visit` on every comment.
 */
function walkComments(value: unknown, visit: (comment: CommentNode) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkComments(item, visit);
    return;
  }
  if (value == null || typeof value !== 'object') return;

  const node = value as CommentNode;
  if (typeof node.id === 'number' && 'content' in node) visit(node);
  if ('data' in node) walkComments(node.data, visit);
  if ('children' in node) walkComments(node.children, visit);
}

/**
 * Adds `fediverseUri` and `fediverseActorHandle` to every comment of a
 * response body, in place, from `fieldsById`. Comments without a row get
 * `null` for both, so clients can rely on the keys being present.
 */
export function attachFediverseFields(body: unknown, fieldsById: Map<number, FediverseFields>) {
  walkComments(body, (comment) => {
    const fields = fieldsById.get(comment.id as number);
    comment.fediverseUri = fields?.fediverseUri ?? null;
    comment.fediverseActorHandle = fields?.fediverseActorHandle ?? null;
  });
}

/**
 * The comments plugin parses its responses through a fixed schema that drops
 * every attribute it does not declare, including the fediverse fields added
 * in `src/extensions/comments`. This puts them back with one query per
 * response, so the frontend can label fediverse replies and link to them.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (
    ctx: { method: string; path: string; status: number; body?: unknown },
    next: () => Promise<unknown>
  ) => {
    await next();

    if (ctx.method !== 'GET' || !ctx.path.startsWith(COMMENTS_API_PREFIX)) return;
    if (ctx.status !== 200 || ctx.body == null) return;

    const ids = new Set<number>();
    walkComments(ctx.body, (comment) => ids.add(comment.id as number));
    if (ids.size === 0) return;

    const rows = (await strapi.db.query(COMMENT_UID).findMany({
      select: ['id', 'fediverseUri', 'fediverseActorHandle'],
      where: { id: { $in: [...ids] } },
    })) as ({ id: number } & FediverseFields)[];

    attachFediverseFields(ctx.body, new Map(rows.map((row) => [row.id, row])));
  };
