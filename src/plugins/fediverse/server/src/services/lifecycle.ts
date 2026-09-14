import type { Core } from '@strapi/strapi';

export interface TrackedLifecycleEvent {
  action: string;
  uid: string;
  documentId: string | undefined;
  recordedAt: string;
}

interface EntryEvent {
  model?: string;
  uid?: string;
  entry?: { documentId?: string } | null;
}

const ARTICLE_UID = 'api::article.article';
const PUBLISH_EVENT = 'entry.publish';
const UNPUBLISH_EVENT = 'entry.unpublish';

// Strapi 5 does not emit publish lifecycles through `strapi.db.lifecycles`
// (publish maps to afterCreate, unpublish to afterDelete there). The document
// service emits `entry.publish` / `entry.unpublish` on `strapi.eventHub`
// after the DB transaction commits, with the sanitized entry as payload.
const events: TrackedLifecycleEvent[] = [];
let unsubscribers: Array<() => void> = [];

/**
 * Phase 0 spike: records article publish events so the integration test can
 * verify that `strapi.eventHub` delivers them. Phase 2 (#5) replaces this
 * with Create/Update/Delete(Article) fan-out.
 */
export function subscribe(strapi: Core.Strapi) {
  const track =
    (action: string) =>
    async (payload: EntryEvent): Promise<void> => {
      if (payload?.uid !== ARTICLE_UID) return;

      const tracked: TrackedLifecycleEvent = {
        action,
        uid: payload.uid,
        documentId: payload.entry?.documentId,
        recordedAt: new Date().toISOString(),
      };
      events.push(tracked);

      strapi.log.info(
        `[fediverse] lifecycle ${tracked.action} — article ${tracked.documentId ?? '(no documentId)'}`
      );
    };

  unsubscribers = [
    strapi.eventHub.on(PUBLISH_EVENT, track(PUBLISH_EVENT)),
    strapi.eventHub.on(UNPUBLISH_EVENT, track(UNPUBLISH_EVENT)),
  ];
}

export function unsubscribe() {
  for (const off of unsubscribers) off();
  unsubscribers = [];
}

export function getEvents(): TrackedLifecycleEvent[] {
  return [...events];
}

export function clear() {
  events.length = 0;
}

export default () => ({
  getEvents,
  clear,
  unsubscribe,
});
