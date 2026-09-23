import type { Core } from '@strapi/strapi';

import type { Activity } from '@fedify/fedify/vocab';

import { ACTOR_IDENTIFIER, getFederation } from '../federation';
import {
  ARTICLE_UID,
  buildArticleActivity,
  buildDeleteActivity,
  findPublishedArticle,
  getDefaultLocale,
  isFederated,
  setFederated,
} from './articles';
import { countFollowers } from './followers';

interface EntryEvent {
  uid?: string;
  entry?: { documentId?: string; locale?: string | null } | null;
}

let unsubscribers: Array<() => void> = [];

/**
 * Fedify context for work that isn't tied to an HTTP request. Its origin comes
 * from Strapi's public `URL`, so ids match the ones served over HTTP.
 */
function createContext(strapi: Core.Strapi) {
  const origin = strapi.config.get('server.url') as string;
  return getFederation(strapi).createContext(new URL(origin), { strapi });
}

/** Sends to every non-blocked follower and returns how many there were (0 = nothing sent). */
async function sendToFollowers(strapi: Core.Strapi, activity: Activity): Promise<number> {
  const recipients = await countFollowers(strapi);
  if (recipients === 0) return 0;

  const ctx = createContext(strapi);
  await ctx.sendActivity({ identifier: ACTOR_IDENTIFIER }, 'followers', activity, {
    preferSharedInbox: true,
  });
  return recipients;
}

function describeDelivery(recipients: number): string {
  return recipients === 0
    ? 'no followers yet, nothing delivered'
    : `delivered to ${recipients} follower${recipients === 1 ? '' : 's'}`;
}

async function isDefaultLocale(strapi: Core.Strapi, event: EntryEvent): Promise<boolean> {
  const locale = event.entry?.locale;
  return locale == null || locale === (await getDefaultLocale(strapi));
}

async function onPublish(strapi: Core.Strapi, event: EntryEvent): Promise<void> {
  const documentId = event.entry?.documentId;
  if (!documentId || !(await isDefaultLocale(strapi, event))) return;

  const record = await findPublishedArticle(strapi, documentId);
  if (record == null) {
    strapi.log.warn(
      `[fediverse] not federating article ${documentId}: no published default-locale version with a title and slug`
    );
    return;
  }

  // Publishing again is how edits go live in Strapi 5, so a known article is an Update.
  const federated = await isFederated(strapi, documentId);
  const ctx = createContext(strapi);
  const recipients = await sendToFollowers(
    strapi,
    buildArticleActivity(federated ? 'update' : 'create', ctx, ACTOR_IDENTIFIER, record)
  );
  await setFederated(strapi, documentId, true);
  strapi.log.info(
    `[fediverse] ${federated ? 'Update' : 'Create'}(Article) for ${documentId} (${record.slug}): ${describeDelivery(recipients)}`
  );
}

async function onRemoved(strapi: Core.Strapi, event: EntryEvent): Promise<void> {
  const documentId = event.entry?.documentId;
  if (!documentId || !(await isDefaultLocale(strapi, event))) return;
  if (!(await isFederated(strapi, documentId))) return;

  // Deleting a draft-only revision must not retract a version that is still live.
  if ((await findPublishedArticle(strapi, documentId)) != null) return;

  const ctx = createContext(strapi);
  const recipients = await sendToFollowers(
    strapi,
    buildDeleteActivity(ctx, ACTOR_IDENTIFIER, documentId)
  );
  await setFederated(strapi, documentId, false);
  strapi.log.info(`[fediverse] Delete(Article) for ${documentId}: ${describeDelivery(recipients)}`);
}

/**
 * Federates article publish state changes. Failures are logged and swallowed:
 * the events fire after the Strapi operation has committed, and federation
 * problems must never surface as editor-facing errors.
 */
export function subscribe(strapi: Core.Strapi) {
  const guarded =
    (label: string, handler: (strapi: Core.Strapi, event: EntryEvent) => Promise<void>) =>
    async (event: EntryEvent): Promise<void> => {
      if (event?.uid !== ARTICLE_UID) return;
      try {
        await handler(strapi, event);
      } catch (error) {
        strapi.log.error(`[fediverse] ${label} failed`, { error });
      }
    };

  unsubscribers = [
    strapi.eventHub.on('entry.publish', guarded('article publish federation', onPublish)),
    strapi.eventHub.on('entry.unpublish', guarded('article unpublish federation', onRemoved)),
    strapi.eventHub.on('entry.delete', guarded('article delete federation', onRemoved)),
  ];
}

export function unsubscribe() {
  for (const off of unsubscribers) off();
  unsubscribers = [];
}
