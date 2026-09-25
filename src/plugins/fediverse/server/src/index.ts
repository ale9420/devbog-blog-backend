import type { Core } from '@strapi/strapi';

import followerSchema from './content-types/follower/schema.json';
import interactionSchema from './content-types/interaction/schema.json';
import stats from './controllers/stats';
import routes from './routes';
import { mountFediverseMiddleware } from './federation';
import actorProfile from './services/actor-profile';
import followers from './services/followers';
import interactions from './services/interactions';
import keys from './services/keys';
import lifecycle, { subscribe, unsubscribe } from './services/lifecycle';
import statsService from './services/stats';
import {
  subscribe as subscribePublisher,
  unsubscribe as unsubscribePublisher,
} from './services/publisher';

const plugin = {
  register({ strapi }: { strapi: Core.Strapi }) {
    // Mounted in register() on purpose: plugin register() runs before
    // server.initMiddlewares() (which mounts `strapi::body`), and the router
    // is only mounted at listen() time. This guarantees the Fedify middleware
    // sees the raw request stream (needed for HTTP signature verification on
    // inbox POSTs) and intercepts fediverse paths before they can 404.
    strapi.server.use(mountFediverseMiddleware(strapi));
  },

  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    subscribe(strapi);
    subscribePublisher(strapi);
  },

  destroy() {
    unsubscribe();
    unsubscribePublisher();
  },

  contentTypes: {
    follower: {
      schema: followerSchema,
    },
    interaction: {
      schema: interactionSchema,
    },
  },

  config: {
    default: {
      actorIdentifier: 'devbog',
    },
    validator() {},
  },

  controllers: {
    stats,
  },

  routes,

  services: {
    interactions,
    lifecycle,
    keys,
    followers,
    'actor-profile': actorProfile,
    stats: statsService,
  },
};

export default plugin;
