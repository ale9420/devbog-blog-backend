import type { Core } from '@strapi/strapi';

import { generateCryptoKeyPair } from '@fedify/fedify';

type PluginStore = Awaited<ReturnType<Core.Strapi['store']>>;

const STORE_KEY = 'keyPairs';

interface StoredKeyPair {
  /**
   * Stable fragment name for the key id. Fedify assigns the actual key id
   * (`<actorUri>#main-key`, `<actorUri>#key-2`, ...) from the array order,
   * so this is informational only.
   */
  name: string;
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
  algorithm: string;
  generatedAt: string;
}

interface ActorKeyPairResult {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

const RSA_IMPORT_PARAMS: RsaHashedImportParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
};

function isStoredKeyPairs(value: unknown): value is StoredKeyPair[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        entry != null &&
        typeof entry === 'object' &&
        typeof entry.name === 'string' &&
        entry.publicJwk != null &&
        entry.privateJwk != null
    )
  );
}

async function getStore(strapi: Core.Strapi): Promise<PluginStore> {
  return strapi.store({ type: 'plugin', name: 'fediverse' });
}

/**
 * Returns the blog actor's key pairs, generating and persisting them in the
 * plugin store on first use. Persisted as JWKs (WebCrypto export), so the
 * actor identity survives restarts — remote followers would otherwise break
 * on every deploy. Key ids are derived by Fedify from the current request
 * origin, which keeps them valid across dev/staging/prod domains.
 */
export async function getActorKeyPairs(strapi: Core.Strapi): Promise<ActorKeyPairResult[]> {
  const store = await getStore(strapi);
  const stored: unknown = await store.get({ key: STORE_KEY });

  if (isStoredKeyPairs(stored)) {
    return await Promise.all(
      stored.map(async (entry) => ({
        publicKey: await crypto.subtle.importKey('jwk', entry.publicJwk, RSA_IMPORT_PARAMS, true, [
          'verify',
        ]),
        privateKey: await crypto.subtle.importKey(
          'jwk',
          entry.privateJwk,
          RSA_IMPORT_PARAMS,
          true,
          ['sign']
        ),
      }))
    );
  }

  // No persisted key pairs (first boot, or store wiped): generate one.
  const generated = await generateCryptoKeyPair();
  const entry: StoredKeyPair = {
    name: 'main-key',
    publicJwk: await crypto.subtle.exportKey('jwk', generated.publicKey),
    privateJwk: await crypto.subtle.exportKey('jwk', generated.privateKey),
    algorithm: generated.publicKey.algorithm.name,
    generatedAt: new Date().toISOString(),
  };
  await store.set({ key: STORE_KEY, value: [entry] });
  strapi.log.info('[fediverse] generated and persisted a new actor key pair');

  return [
    {
      publicKey: await crypto.subtle.importKey('jwk', entry.publicJwk, RSA_IMPORT_PARAMS, true, [
        'verify',
      ]),
      privateKey: await crypto.subtle.importKey('jwk', entry.privateJwk, RSA_IMPORT_PARAMS, true, [
        'sign',
      ]),
    },
  ];
}

/**
 * Returns the persisted JWK entries (test/debug helper; also lets tests prove
 * persistence without re-deriving keys).
 */
export async function getStoredKeyPairEntries(
  strapi: Core.Strapi
): Promise<StoredKeyPair[] | null> {
  const store = await getStore(strapi);
  const stored: unknown = await store.get({ key: STORE_KEY });
  return isStoredKeyPairs(stored) ? stored : null;
}

export default () => ({
  getActorKeyPairs,
  getStoredKeyPairEntries,
});
