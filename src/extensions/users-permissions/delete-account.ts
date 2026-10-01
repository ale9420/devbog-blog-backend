import type { Core } from '@strapi/strapi';
import { COMMENT_UID } from '../../constants/uids';

const USER_UID = 'plugin::users-permissions.user';

/** Author shown on the comments of a deleted account. */
export const ANONYMOUS_AUTHOR = { id: 'anonymous', name: 'Anónimo' };

/**
 * Deletes a users-permissions user for good and keeps their comments
 * published as «Anónimo»: the relation to the user, their email and avatar
 * are removed from each comment. One transaction, so a failure leaves both
 * the user and the comments as they were.
 */
export async function deleteAccount(strapi: Core.Strapi, userId: number): Promise<void> {
  await strapi.db.transaction(async () => {
    // The relation lives in a join table: find the comments through it, then
    // clear it with an update per comment (updateMany doesn't touch relations).
    const comments = (await strapi.db.query(COMMENT_UID).findMany({
      select: ['id'],
      where: { authorUser: { id: userId } },
    })) as { id: number }[];

    for (const comment of comments) {
      await strapi.db.query(COMMENT_UID).update({
        where: { id: comment.id },
        data: {
          authorUser: null,
          authorId: ANONYMOUS_AUTHOR.id,
          authorName: ANONYMOUS_AUTHOR.name,
          authorEmail: null,
          authorAvatar: null,
        },
      });
    }

    // Also revokes the user's refresh sessions.
    await strapi.plugin('users-permissions').service('user').remove({ id: userId });
  });
}

/** Whether `password` is the current password of the user. */
export async function checkPassword(
  strapi: Core.Strapi,
  userId: number,
  password: unknown
): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0) return false;

  const user = (await strapi.db
    .query(USER_UID)
    .findOne({ select: ['id', 'password'], where: { id: userId } })) as {
    password?: string;
  } | null;
  if (!user?.password) return false;

  return strapi
    .plugin('users-permissions')
    .service('user')
    .validatePassword(password, user.password);
}
