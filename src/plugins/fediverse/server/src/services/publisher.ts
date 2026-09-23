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

async function sendToFollowers(strapi: Core.Strapi, activity: Activity): Promise<void> {
  const ctx = createContext(strapi);
  await ctx.sendActivity({ identifier: ACTOR_IDENTIFIER }, 'followers', activity, {
    preferSharedInbox: true,
  });
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
  await sendToFollowers(
    strapi,
    buildArticleActivity(federated ? 'update' : 'create', ctx, ACTOR_IDENTIFIER, record)
  );
  await setFederated(strapi, documentId, true);
  strapi.log.info(
    `[fediverse] ${federated ? 'Update' : 'Create'}(Article) sent for ${documentId} (${record.slug})`
  );
}

async function onRemoved(strapi: Core.Strapi, event: EntryEvent): Promise<void> {
  const documentId = event.entry?.documentId;
  if (!documentId || !(await isDefaultLocale(strapi, event))) return;
  if (!(await isFederated(strapi, documentId))) return;

  // Deleting a draft-only revision must not retract a version that is still live.
  if ((await findPublishedArticle(strapi, documentId)) != null) return;

  const ctx = createContext(strapi);
  await sendToFollowers(strapi, buildDeleteActivity(ctx, ACTOR_IDENTIFIER, documentId));
  await setFederated(strapi, documentId, false);
  strapi.log.info(`[fediverse] Delete(Article) sent for ${documentId}`);
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
