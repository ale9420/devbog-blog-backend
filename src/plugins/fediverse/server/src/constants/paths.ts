/** URI templates Fedify dispatches on. */

export const ACTOR_PATH = '/fediverse/user/{identifier}';
export const INBOX_PATH = '/fediverse/user/{identifier}/inbox';
export const SHARED_INBOX_PATH = '/fediverse/inbox';
export const FOLLOWERS_PATH = '/fediverse/user/{identifier}/followers';
export const NODEINFO_PATH = '/nodeinfo/2.1';
export const OUTBOX_PATH = '/fediverse/user/{identifier}/outbox';
export const ARTICLE_PATH = '/fediverse/articles/{documentId}';

/** Everything Fedify can answer lives under these prefixes. */
export const FEDERATION_PREFIXES = ['/fediverse/', '/.well-known/', '/nodeinfo/'];
