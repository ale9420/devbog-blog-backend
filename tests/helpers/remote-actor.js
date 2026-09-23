'use strict';

const http = require('http');
const { generateCryptoKeyPair, signRequest } = require('@fedify/fedify');
const { Person, CryptographicKey } = require('@fedify/fedify/vocab');

const ACTIVITY_JSON = 'application/activity+json';

/**
 * Spins up a minimal HTTP server that plays the "remote fediverse server"
 * role in tests: it serves an ActivityPub actor document with an embedded
 * public key — so our plugin's inbound HTTP-signature verification and
 * `ctx.lookupObject()` calls have something real to dereference — and it
 * records any activity POSTed to its inbox (e.g. the signed `Accept` our
 * plugin sends back for a `Follow`).
 */
async function createRemoteActor({ preferredUsername = 'remote-test' } = {}) {
  const keyPair = await generateCryptoKeyPair();
  const inboxDeliveries = [];

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/actor') {
      buildActorDocument()
        .then((doc) => {
          res.writeHead(200, { 'content-type': ACTIVITY_JSON });
          res.end(JSON.stringify(doc));
        })
        .catch((error) => {
          res.writeHead(500);
          res.end(String(error));
        });
      return;
    }

    if (req.method === 'POST' && req.url === '/inbox') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          inboxDeliveries.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          // Malformed body: nothing to record, still ack the delivery below.
        }
        res.writeHead(202);
        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const actorUrl = `http://127.0.0.1:${port}/actor`;
  const inboxUrl = `http://127.0.0.1:${port}/inbox`;
  const keyId = new URL(`${actorUrl}#main-key`);

  async function buildActorDocument() {
    const key = new CryptographicKey({
      id: keyId,
      owner: new URL(actorUrl),
      publicKey: keyPair.publicKey,
    });
    const person = new Person({
      id: new URL(actorUrl),
      preferredUsername,
      inbox: new URL(inboxUrl),
      publicKey: key,
    });
    return person.toJsonLd({ format: 'compact' });
  }

  return {
    actorUrl,
    inboxUrl,
    keyId,
    inboxDeliveries,
    /** Builds and HTTP-signs a POST of `activity` to `url` as this remote actor. */
    async postSignedActivity(url, activity) {
      const request = new Request(url, {
        method: 'POST',
        headers: { 'content-type': ACTIVITY_JSON },
        body: JSON.stringify(activity),
      });
      const signed = await signRequest(request, keyPair.privateKey, keyId);
      return fetch(signed);
    },
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}

module.exports = { createRemoteActor };
