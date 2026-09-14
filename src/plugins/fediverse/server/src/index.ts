import type { Core } from '@strapi/strapi';

import { mountFediverseMiddleware } from './federation';
import lifecycle, { subscribe, unsubscribe } from './services/lifecycle';

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
  },

  destroy() {
    unsubscribe();
  },

  config: {
    default: {
      actorIdentifier: 'devbog',
    },
    validator() {},
  },

  services: {
    lifecycle,
  },
};

export default plugin;
