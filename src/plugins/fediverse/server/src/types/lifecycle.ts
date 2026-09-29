/** Publish/unpublish events recorded for diagnostics. */

export interface TrackedLifecycleEvent {
  action: string;
  uid: string;
  documentId: string | undefined;
  recordedAt: string;
}
