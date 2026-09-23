import type { Core } from '@strapi/strapi';

import { ARTICLE_UID, findArticleDocumentIdByUrl, findPublishedArticle } from './articles';
import { isActorBlocked } from './followers';

export const COMMENT_UID = 'plugin::comments.comment';

const MAX_CONTENT_LENGTH = 5000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/**
 * Remote Note content is HTML from an untrusted server. Comments are stored as
 * plain text, so strip every tag (keeping paragraph and line breaks) and decode
 * entities *after* stripping — an encoded `&lt;script&gt;` must end up as
 * harmless literal text, never as markup.
 */
export function htmlToPlainText(html: string): string {
  const text = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(?:p|div|li|blockquote|h[1-6])\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');

  return decodeEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Mastodon prefixes replies with a mention of the account being replied to; drop ours. */
export function stripLeadingMentions(text: string, actorIdentifier: string): string {
  const escaped = actorIdentifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^(?:@${escaped}(?:@[\\w.-]+)?\\s+)+`, 'i'), '').trim();
}

export function toCommentContent(html: string, actorIdentifier: string): string {
  return stripLeadingMentions(htmlToPlainText(html), actorIdentifier).slice(0, MAX_CONTENT_LENGTH);
}

export interface IncomingReply {
  /** The remote Note's id. */
  uri: string;
  /** What the Note replies to (`inReplyTo`). */
  inReplyTo: string;
  contentHtml: string;
  actorId: string;
  handle: string | null;
  name: string | null;
  avatar: string | null;
}

export interface ReplyContext {
  actorIdentifier: string;
  /** Maps one of our ActivityPub article ids to its documentId, or null. */
  parseArticleUri(uri: string): string | null;
}

export type IngestResult =
  | { status: 'applied'; documentId: string }
  | { status: 'ignored'; reason: string };

interface CommentRow {
  documentId: string;
  related?: string | null;
  authorId?: string | null;
  content?: string | null;
}

const ignored = (reason: string): IngestResult => ({ status: 'ignored', reason });

// The generated types for plugin content types don't include the comments
// plugin's attributes (or our extension's), so type the document service by hand.
interface CommentDocuments {
  findFirst(params: { filters: Record<string, unknown> }): Promise<unknown>;
  create(params: { data: Record<string, unknown> }): Promise<unknown>;
  update(params: { documentId: string; data: Record<string, unknown> }): Promise<unknown>;
}

function comments(strapi: Core.Strapi): CommentDocuments {
  return strapi.documents(COMMENT_UID) as unknown as CommentDocuments;
}

async function findCommentByUri(strapi: Core.Strapi, uri: string): Promise<CommentRow | null> {
  return (await comments(strapi).findFirst({
    filters: { fediverseUri: uri },
  })) as CommentRow | null;
}

/**
 * Finds the article a reply belongs to, and the parent comment when it is a
 * reply to another fediverse reply (one hop, via the parent's stored Note id).
 */
async function resolveTarget(
  strapi: Core.Strapi,
  inReplyTo: string,
  context: ReplyContext
): Promise<{ articleId: string; parent: CommentRow | null } | null> {
  const articleId =
    context.parseArticleUri(inReplyTo) ?? (await findArticleDocumentIdByUrl(strapi, inReplyTo));
  if (articleId) return { articleId, parent: null };

  const parent = await findCommentByUri(strapi, inReplyTo);
  const related = parent?.related ?? '';
  const separator = related.lastIndexOf(':');
  if (parent && related.slice(0, separator) === ARTICLE_UID) {
    return { articleId: related.slice(separator + 1), parent };
  }

  return null;
}

/**
 * Stores a remote reply as a comment on the article it answers. It always
 * enters as `PENDING`: the content is untrusted and a moderator approves it.
 */
export async function ingestReply(
  strapi: Core.Strapi,
  reply: IncomingReply,
  context: ReplyContext
): Promise<IngestResult> {
  if (await isActorBlocked(strapi, reply.actorId)) return ignored('actor is blocked');
  if (await findCommentByUri(strapi, reply.uri)) return ignored('already stored');

  const target = await resolveTarget(strapi, reply.inReplyTo, context);
  if (!target) return ignored('not a reply to one of our articles');
  if ((await findPublishedArticle(strapi, target.articleId)) == null) {
    return ignored('article is not published');
  }

  const content = toCommentContent(reply.contentHtml, context.actorIdentifier);
  if (!content) return ignored('empty after sanitizing');

  const created = (await comments(strapi).create({
    data: {
      content,
      related: `${ARTICLE_UID}:${target.articleId}`,
      approvalStatus: 'PENDING',
      isAdminComment: false,
      authorId: reply.actorId,
      authorName: reply.name ?? reply.handle ?? reply.actorId,
      authorAvatar: reply.avatar ?? undefined,
      fediverseUri: reply.uri,
      fediverseActorHandle: reply.handle ?? undefined,
      ...(target.parent ? { threadOf: target.parent.documentId } : {}),
    },
  })) as CommentRow;

  return { status: 'applied', documentId: created.documentId };
}

/**
 * Applies a remote edit. Edited text goes back to `PENDING`, otherwise an
 * author could get something harmless approved and then swap in spam.
 */
export async function updateReply(
  strapi: Core.Strapi,
  update: { uri: string; actorId: string; contentHtml: string },
  context: ReplyContext
): Promise<IngestResult> {
  const comment = await findCommentByUri(strapi, update.uri);
  if (!comment) return ignored('unknown reply');
  if (comment.authorId !== update.actorId) return ignored('not the reply author');

  const content = toCommentContent(update.contentHtml, context.actorIdentifier);
  if (!content) return ignored('empty after sanitizing');
  if (content === comment.content) return ignored('content unchanged');

  await comments(strapi).update({
    documentId: comment.documentId,
    data: { content, approvalStatus: 'PENDING' },
  });
  return { status: 'applied', documentId: comment.documentId };
}

/** Marks the comment for a deleted remote Note as removed (kept for the thread structure). */
export async function removeReply(
  strapi: Core.Strapi,
  removal: { uri: string; actorId: string }
): Promise<IngestResult> {
  const comment = await findCommentByUri(strapi, removal.uri);
  if (!comment) return ignored('unknown reply');
  if (comment.authorId !== removal.actorId) return ignored('not the reply author');

  await comments(strapi).update({ documentId: comment.documentId, data: { removed: true } });
  return { status: 'applied', documentId: comment.documentId };
}
