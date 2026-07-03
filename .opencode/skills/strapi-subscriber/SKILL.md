---
name: strapi-subscriber
description: Use when the user asks about newsletter subscriptions, email signup, subscriber deduplication, confirmation tokens, or the subscriber API in the devbog Strapi backend.
---

# Strapi Subscriber Skill

The `subscriber` content type stores newsletter subscriptions. It uses a custom controller and service to validate input and prevent duplicate sign-ups.

## When to use this skill

- Adding or modifying the subscription flow.
- Adding email confirmation, unsubscribe, or list-management features.
- Changing subscriber permissions or response shape.

## Current implementation

Controller (`src/api/subscriber/controllers/subscriber.ts`):

```typescript
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
```

Service (`src/api/subscriber/services/subscriber.ts`):

```typescript
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
```

## Public permission

The seed script grants public `create` access only:

```javascript
await setPublicPermissions({
  // ...
  subscriber: ['create'],
});
```

This lets front-end apps submit emails without authentication, while preventing public reads of the subscriber list.

## Typical consumer request

```http
POST /api/subscribers
Content-Type: application/json

{
  "data": {
    "email": "user@example.com"
  }
}
```

## Extending the flow

To add double opt-in:

1. Generate a `confirmationToken` (crypto UUID or hash).
2. Save it on the subscriber entry.
3. Send an email with a confirmation link containing the token.
4. Add a custom route/service that marks `confirmed: true` when the token is verified.

## Do not

- Allow public `find` or `findOne` on subscribers — that leaks email addresses.
- Store plain-text tokens longer than necessary; treat them like passwords.
