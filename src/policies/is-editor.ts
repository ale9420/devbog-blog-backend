import type { Core } from '@strapi/strapi';
import { canReadDrafts } from '../utils/drafts-access';

type RequestState = Parameters<typeof canReadDrafts>[0];

/** Lets through only users-permissions users with the Editor role (403 otherwise). */
const isEditor: Core.PolicyHandler = (policyContext) =>
  // On content API routes the policy context wraps the Koa context, `state` included.
  canReadDrafts((policyContext as unknown as { state: RequestState }).state);

export default isEditor;
