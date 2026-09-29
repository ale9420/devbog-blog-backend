/**
 * Identity of the blog's actor, read from the environment when the plugin
 * loads.
 */

/**
 * The actor's internal identifier: the path segment of every actor URI
 * (`/fediverse/user/devbog`). Remote servers key the account and its
 * followers by that URI, so it must never change.
 */
export const ACTOR_IDENTIFIER = process.env.FEDIVERSE_ACTOR_IDENTIFIER ?? 'devbog';

/**
 * The `user` of the public handle `@user@domain` (`preferredUsername`).
 * Unlike the identifier it can change: WebFinger maps it to the identifier,
 * so the account keeps its URI and followers.
 */
export const ACTOR_USERNAME = process.env.FEDIVERSE_ACTOR_USERNAME ?? 'bogdev';

/** Usernames WebFinger resolves to the blog: the handle, and the identifier as a former one. */
export const ACTOR_USERNAMES = [...new Set([ACTOR_USERNAME, ACTOR_IDENTIFIER])];
