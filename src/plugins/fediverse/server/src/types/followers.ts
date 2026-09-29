/** Remote actors following the blog. */

export interface FollowerRecord {
  documentId: string;
  actorId: string;
  handle: string | null;
  name: string | null;
  inbox: string | null;
  avatar: string | null;
  blocked: boolean;
}

export interface FollowerInput {
  actorId: string;
  handle?: string | null;
  name?: string | null;
  inbox?: string | null;
  avatar?: string | null;
}
