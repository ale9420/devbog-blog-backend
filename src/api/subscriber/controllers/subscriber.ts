import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::subscriber.subscriber', ({ strapi }) => ({
  async create(ctx) {
    const { data } = ctx.request.body;
    const email = data?.email;

    if (!email) {
      return ctx.badRequest('Email is required');
    }

    const result = await strapi.service('api::subscriber.subscriber').createSubscription(email);

    if (!result.success) {
      return ctx.badRequest(result.error);
    }

    ctx.body = { data: result.data };
  },
}));
