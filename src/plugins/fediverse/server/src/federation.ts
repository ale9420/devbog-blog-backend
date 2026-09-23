import type { Core } from '@strapi/strapi';

import { createFederation, MemoryKvStore, type Federation } from '@fedify/fedify';
import { Accept, Block, Follow, Image, Link, Person, Undo } from '@fedify/fedify/vocab';
import { getActorHandle, type Actor, type DocumentLoader } from '@fedify/fedify/vocab';
import { createMiddleware } from '@fedify/koa';

import pkg from '../../package.json';
import { getActorKeyPairs } from './services/keys';
import {
  countFollowers,
  listFollowers,
  recordFollower,
  removeFollower,
} from './services/followers';

export type FediverseContextData = {
  strapi: Core.Strapi;
};

export const ACTOR_IDENTIFIER = process.env.FEDIVERSE_ACTOR_IDENTIFIER ?? 'devbog';

export const ACTOR_PATH = '/fediverse/user/{identifier}';
export const INBOX_PATH = '/fediverse/user/{identifier}/inbox';
export const SHARED_INBOX_PATH = '/fediverse/inbox';
export const FOLLOWERS_PATH = '/fediverse/user/{identifier}/followers';
export const NODEINFO_PATH = '/nodeinfo/2.1';

function pluginService<T>(strapi: Core.Strapi, name: string): T {
  return strapi.plugin('fediverse').service(name) as T;
}

/**
 * Extracts the avatar image URL from a remote actor's icon (Mastodon sends
 * an embedded Image with a url).
 */
async function extractAvatarUrl(
  strapi: Core.Strapi,
  actor: Actor | null,
  documentLoader: DocumentLoader
): Promise<string | null> {
  if (actor == null) return null;
  try {
    const icon = await actor.getIcon({ documentLoader, suppressError: true });
    if (icon == null) return null;
    const url = icon.url;
    if (url instanceof URL) return url.href;
    if (url instanceof Link) return url.href?.href ?? null;
    return null;
  } catch (error) {
    strapi.log.warn('[fediverse] failed to extract follower avatar', { error });
    return null;
  }
}

export function createFediverseFederation(): Federation<FediverseContextData> {
  const federation = createFederation<FediverseContextData>({
    kv: new MemoryKvStore(),
    // Lets tests dereference a fake remote actor served from 127.0.0.1 (real
    // remotes are always public hosts). Never true outside NODE_ENV=test.
    allowPrivateAddress: process.env.NODE_ENV === 'test',
  });

  federation
    .setActorDispatcher(ACTOR_PATH, async (ctx, identifier) => {
      if (identifier !== ACTOR_IDENTIFIER) return null;

      const strapi = ctx.data.strapi;
      const actorUri = ctx.getActorUri(identifier);

      const profile = await pluginService<{
        getActorProfile(
          strapi: Core.Strapi,
          baseUrl: string
        ): Promise<{
          name: string;
          summary: string;
          iconUrl: string | null;
        }>;
      }>(strapi, 'actor-profile').getActorProfile(strapi, actorUri.href);

      const keyPairs = await ctx.getActorKeyPairs(identifier);

      return new Person({
        id: actorUri,
        preferredUsername: identifier,
        name: profile.name,
        summary: profile.summary,
        url: actorUri,
        inbox: ctx.getInboxUri(identifier),
        followers: ctx.getFollowersUri(identifier),
        discoverable: true,
        icon: profile.iconUrl ? new Image({ url: new URL(profile.iconUrl) }) : undefined,
        publicKey: keyPairs[0]?.cryptographicKey,
        assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
      });
    })
    .setKeyPairsDispatcher(async (context, identifier) => {
      if (identifier !== ACTOR_IDENTIFIER) return [];
      // Keys are persisted as JWKs in the plugin store; Fedify derives the
      // key ids (`#main-key`) from the current request origin.
      return await getActorKeyPairs(context.data.strapi);
    });

  federation
    .setFollowersDispatcher(FOLLOWERS_PATH, async (ctx, identifier, cursor) => {
      if (identifier !== ACTOR_IDENTIFIER) return null;
      // Single page: all non-blocked followers, no pagination cursor.
      if (cursor != null) return { items: [] };

      const followers = await listFollowers(ctx.data.strapi);
      return {
        items: followers.map((follower) => ({
          id: new URL(follower.actorId),
          inboxId: follower.inbox ? new URL(follower.inbox) : null,
        })),
      };
    })
    .setCounter(async (ctx, identifier) => {
      if (identifier !== ACTOR_IDENTIFIER) return null;
      return await countFollowers(ctx.data.strapi);
    });

  federation.setNodeInfoDispatcher(NODEINFO_PATH, async (ctx) => {
    const strapi = ctx.data.strapi;

    let localPosts = 0;
    try {
      localPosts = await strapi.documents('api::article.article').count({ status: 'published' });
    } catch (error) {
      strapi.log.warn('[fediverse] failed to count published articles for NodeInfo', { error });
    }

    return {
      software: {
        name: 'devbog-strapi',
        version: pkg.version,
      },
      protocols: ['activitypub'],
      openRegistrations: false,
      usage: {
        users: { total: 1 },
        localPosts,
        localComments: 0,
      },
    };
  });

  federation
    .setInboxListeners(INBOX_PATH, SHARED_INBOX_PATH)
    .on(Follow, async (ctx, follow) => {
      const strapi = ctx.data.strapi;
      const actorId = follow.actorId;
      if (actorId == null) return;

      // Only accept follows addressed to the blog actor (relevant for the
      // shared inbox, which receives activities for any recipient).
      const targetId = follow.objectId?.href;
      if (targetId !== ctx.getActorUri(ACTOR_IDENTIFIER).href) {
        strapi.log.warn(`[fediverse] ignoring Follow addressed at ${targetId ?? '(none)'}`);
        return;
      }

      // Dereference the remote actor for display data (name, inbox, icon).
      let remoteActor: Actor | null = null;
      try {
        remoteActor = (await ctx.lookupObject(actorId)) as Actor | null;
      } catch (error) {
        strapi.log.warn(`[fediverse] failed to look up follower actor ${actorId.href}`, { error });
      }

      let handle: string | null = null;
      try {
        handle = await getActorHandle(remoteActor ?? actorId);
      } catch {
        handle = null;
      }

      const displayName = remoteActor?.name ?? null;
      const preferredUsername = remoteActor?.preferredUsername ?? null;
      const name =
        (typeof displayName === 'string' ? displayName : null) ??
        (typeof preferredUsername === 'string' ? preferredUsername : null) ??
        handle;

      const avatar = await extractAvatarUrl(strapi, remoteActor, ctx.documentLoader);

      await recordFollower(strapi, {
        actorId: actorId.href,
        handle,
        name,
        inbox: remoteActor?.inboxId?.href ?? null,
        avatar,
      });

      if (remoteActor == null || remoteActor.inboxId == null) {
        // Without the remote actor's inbox we cannot deliver a signed Accept;
        // the follow is recorded, and the remote side keeps it as pending.
        strapi.log.error(
          `[fediverse] could not resolve an inbox for ${actorId.href}; recorded follow without Accept`
        );
        return;
      }

      // Answer with a signed Accept so the remote server completes the follow.
      await ctx.sendActivity(
        { identifier: ACTOR_IDENTIFIER },
        remoteActor,
        new Accept({
          actor: ctx.getActorUri(ACTOR_IDENTIFIER),
          object: follow,
          to: actorId,
        })
      );

      strapi.log.info(`[fediverse] follow accepted: ${handle ?? actorId.href}`);
    })
    .on(Undo, async (ctx, undo) => {
      const strapi = ctx.data.strapi;
      if (undo.actorId == null) return;

      // Undo(Follow) embeds the original Follow object.
      const undone = await undo.getObject({
        documentLoader: ctx.documentLoader,
        suppressError: true,
      });
      if (undone instanceof Follow && undone.actorId != null) {
        const removed = await removeFollower(strapi, undone.actorId.href);
        if (removed) {
          strapi.log.info(`[fediverse] unfollowed: ${undone.actorId.href}`);
        }
        return;
      }

      strapi.log.warn(
        `[fediverse] ignoring Undo whose object is not an embedded Follow (${undo.objectId?.href ?? 'no object id'})`
      );
    })
    .on(Block, async (ctx, block) => {
      const strapi = ctx.data.strapi;
      if (block.actorId == null) return;

      // A remote actor blocking us implies they no longer follow us.
      const removed = await removeFollower(strapi, block.actorId.href);
      if (removed) {
        strapi.log.info(`[fediverse] removed follower after Block from ${block.actorId.href}`);
      }
    });

  return federation;
}

export function mountFediverseMiddleware(strapi: Core.Strapi) {
  const federation = createFediverseFederation();
  return createMiddleware(federation, () => ({ strapi }));
}
