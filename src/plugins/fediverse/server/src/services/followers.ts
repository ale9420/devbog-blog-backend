import type { Core } from '@strapi/strapi';

const FOLLOWER_UID = 'plugin::fediverse.follower';

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

interface FollowerRow {
  documentId: string;
  actorId: string;
  handle?: string | null;
  name?: string | null;
  inbox?: string | null;
  avatar?: string | null;
  blocked?: boolean;
}

function query(strapi: Core.Strapi) {
  // db.query is used instead of strapi.documents because the plugin's
  // generated content type inputs are not visible to plugin-local TypeScript.
  return strapi.db.query(FOLLOWER_UID);
}

function toRecord(row: FollowerRow): FollowerRecord {
  return {
    documentId: row.documentId,
    actorId: row.actorId,
    handle: row.handle ?? null,
    name: row.name ?? null,
    inbox: row.inbox ?? null,
    avatar: row.avatar ?? null,
    blocked: row.blocked ?? false,
  };
}

/**
 * Upserts a follower. Re-follows update the profile fields but never clear
 * an admin-set `blocked` flag — unblocking is a manual decision.
 */
export async function recordFollower(
  strapi: Core.Strapi,
  input: FollowerInput
): Promise<FollowerRecord> {
  const existing = (await query(strapi).findOne({
    where: { actorId: input.actorId },
  })) as FollowerRow | null;

  if (existing) {
    if (existing.blocked) {
      strapi.log.warn(
        `[fediverse] ignored follow from blocked actor ${input.actorId} (blocked by admin)`
      );
      return toRecord(existing);
    }

    const updated = await query(strapi).update({
      where: { documentId: existing.documentId },
      data: {
        handle: input.handle ?? null,
        name: input.name ?? null,
        inbox: input.inbox ?? null,
        avatar: input.avatar ?? null,
      },
    });
    return toRecord(updated as FollowerRow);
  }

  const created = await query(strapi).create({
    data: {
      actorId: input.actorId,
      handle: input.handle ?? null,
      name: input.name ?? null,
      inbox: input.inbox ?? null,
      avatar: input.avatar ?? null,
      blocked: false,
    },
  });
  return toRecord(created as FollowerRow);
}

export async function removeFollower(strapi: Core.Strapi, actorId: string): Promise<boolean> {
  const existing = (await query(strapi).findOne({ where: { actorId } })) as FollowerRow | null;
  if (!existing) return false;

  await query(strapi).delete({ where: { documentId: existing.documentId } });
  return true;
}

export async function listFollowers(
  strapi: Core.Strapi,
  options: { blocked?: boolean } = {}
): Promise<FollowerRecord[]> {
  const blocked = options.blocked ?? false;
  const rows = (await query(strapi).findMany({
    where: { blocked },
    orderBy: { createdAt: 'asc' },
  })) as FollowerRow[];
  return rows.map(toRecord);
}

export async function countFollowers(
  strapi: Core.Strapi,
  options: { blocked?: boolean } = {}
): Promise<number> {
  const blocked = options.blocked ?? false;
  return await query(strapi).count({ where: { blocked } });
}

export default () => ({
  recordFollower,
  removeFollower,
  listFollowers,
  countFollowers,
});
