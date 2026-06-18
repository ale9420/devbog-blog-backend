import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::subscriber.subscriber', ({ strapi }) => ({
  async createSubscription(email: string) {
    const existingSubscriber = await strapi.documents('api::subscriber.subscriber').findMany({
      filters: { email },
    });

    if (existingSubscriber.length > 0) {
      return { success: false, error: 'Email already subscribed' };
    }

    const subscriber = await strapi.documents('api::subscriber.subscriber').create({
      data: {
        email,
        confirmed: false,
      },
    });

    return { success: true, data: subscriber };
  },
}));
