---
name: strapi-subscriber
description: Use when the user asks about newsletter subscriptions, email signup, subscriber deduplication, confirmation or unsubscribe tokens, or the subscriber API in the devbog Strapi backend.
---

# Strapi Subscriber Skill

The `subscriber` content type stores newsletter subscriptions. The whole flow (sign-up, double opt-in, unsubscribe, emails) lives in the frontend server (`devbog-blog-front`, `server/api/newsletter/`), which reads and writes subscribers through the REST API with its full-access API token. Strapi only stores them.

## When to use this skill

- Changing the subscriber schema or its permissions.
- Debugging why a confirmation or unsubscribe link does not find its subscriber.

## Schema

`src/api/subscriber/content-types/subscriber/schema.json`, without draft and publish (every entry is published, so `GET /api/subscribers` finds it):

| Field               | Type                                | Notes                                                                                                                                          |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`             | email, required, unique             | Stored lowercase by the frontend                                                                                                               |
| `confirmationToken` | string                              | UUID sent in the confirmation email; `null` once confirmed                                                                                     |
| `unsubscribeToken`  | string, unique                      | Random 32-byte base64url token for the unsubscribe link and `List-Unsubscribe` header of every email. Stored as is so each send can include it |
| `confirmed`         | boolean, default `false`            |                                                                                                                                                |
| `language`          | enumeration `en`/`es`, default `en` | Email language. `locale` is reserved by Strapi i18n                                                                                            |

Controller, service and router are the core factories: no custom logic.

`unique: true` is only Document Service validation (no database index), which is enough here because only the frontend writes.

## Permissions

No users-permissions role may touch subscribers: a public `create` would let anyone store a subscriber already confirmed or with tokens of their choosing, and `find` leaks email addresses. `src/migrations/subscriber-permissions.ts` removes any such permission on every boot. The frontend uses its API token.

## Typical consumer requests (frontend server, API token)

```http
POST /api/subscribers
{ "data": { "email": "ana@example.com", "confirmationToken": "<uuid>", "unsubscribeToken": "<token>", "confirmed": false, "language": "es" } }

GET /api/subscribers?filters[unsubscribeToken][$eq]=<token>
PUT /api/subscribers/:documentId    { "data": { "confirmed": true, "confirmationToken": null } }
DELETE /api/subscribers/:documentId
```

## Do not

- Grant any role permissions on subscribers.
- Return subscriber entries to browsers: only the frontend server reads them.
