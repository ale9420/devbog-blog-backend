import type { Core } from '@strapi/strapi';

import {
  createFederation,
  generateCryptoKeyPair,
  MemoryKvStore,
  type Federation,
} from '@fedify/fedify';
import { Follow, Person } from '@fedify/fedify/vocab';
import { createMiddleware } from '@fedify/koa';

export type FediverseContextData = {
  strapi: Core.Strapi;
};

// Node's `CryptoKeyPair` is not exported by @types/node; derive the type
// from Fedify's own key pair generator instead.
type FedifyKeyPair = Awaited<ReturnType<typeof generateCryptoKeyPair>>;

export const ACTOR_IDENTIFIER = process.env.FEDIVERSE_ACTOR_IDENTIFIER ?? 'devbog';

export const ACTOR_PATH = '/fediverse/user/{identifier}';
export const INBOX_PATH = '/fediverse/user/{identifier}/inbox';
export const SHARED_INBOX_PATH = '/fediverse/inbox';

// Phase 0 spike: keypairs are generated in-memory, so remote follows break on
// restart. Phase 1 (#4) persists them in the plugin store.
let cachedKeyPairs: FedifyKeyPair[] | undefined;

async function getKeyPairs(): Promise<FedifyKeyPair[]> {
  if (!cachedKeyPairs) {
    cachedKeyPairs = [await generateCryptoKeyPair()];
  }
  return cachedKeyPairs;
}

export function createFediverseFederation(): Federation<FediverseContextData> {
  const federation = createFederation<FediverseContextData>({
    kv: new MemoryKvStore(),
  });

  federation
    .setActorDispatcher(ACTOR_PATH, async (ctx, identifier) => {
      if (identifier !== ACTOR_IDENTIFIER) return null;

      const keyPairs = await ctx.getActorKeyPairs(identifier);

      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        name: 'DevBog',
        summary: 'The DevBog blog, federated on the fediverse.',
        url: ctx.getActorUri(identifier),
        inbox: ctx.getInboxUri(identifier),
        publicKey: keyPairs[0]?.cryptographicKey,
        assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
      });
    })
    .setKeyPairsDispatcher(async (_contextData, identifier) => {
      if (identifier !== ACTOR_IDENTIFIER) return [];
      return await getKeyPairs();
    });

  federation.setInboxListeners(INBOX_PATH, SHARED_INBOX_PATH).on(Follow, async (ctx, follow) => {
    // Phase 1 (#4) records the follower and answers with a signed Accept.
    ctx.data.strapi.log.info(
      `[fediverse] spike received Follow from ${follow.actorId ?? 'unknown actor'}`
    );
  });

  return federation;
}

export function mountFediverseMiddleware(strapi: Core.Strapi) {
  const federation = createFediverseFederation();
  return createMiddleware(federation, () => ({ strapi }));
}
