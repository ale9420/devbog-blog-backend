import type { Core } from '@strapi/strapi';

const healthController: Core.Controller = {
  index(ctx) {
    ctx.body = { status: 'ok', timestamp: new Date().toISOString() };
  },
};

export default healthController;
