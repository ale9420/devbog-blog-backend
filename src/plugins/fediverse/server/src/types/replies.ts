/** Fediverse replies ingested as comments. */

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
  /** Usernames the blog is mentioned by: its current handle and any former one. */
  actorUsernames: string[];
  /** Maps one of our ActivityPub article ids to its documentId, or null. */
  parseArticleUri(uri: string): string | null;
}

export type IngestResult =
  { status: 'applied'; documentId: string } | { status: 'ignored'; reason: string };
