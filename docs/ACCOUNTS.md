# Accounts

Reader accounts for the BogDev frontend (issue #52, frontend ale9420/devbog-blog-front#186). They are plain `users-permissions` users: registration, sign-in, email confirmation and password reset are the plugin's own endpoints. This backend adds the configuration, the Spanish emails and one route, `DELETE /api/users/me`.

## Endpoints the frontend uses

| Action              | Endpoint                                                                     |
| ------------------- | ---------------------------------------------------------------------------- |
| Sign up             | `POST /api/auth/local/register` — `{ username, email, password }` only       |
| Sign in             | `POST /api/auth/local` — `{ identifier, password }`                          |
| Confirm email       | `GET /api/auth/email-confirmation?confirmation=…` (link in the email)        |
| Resend confirmation | `POST /api/auth/send-email-confirmation` — `{ email }`                       |
| Forgot password     | `POST /api/auth/forgot-password` — `{ email }`                               |
| Reset password      | `POST /api/auth/reset-password` — `{ code, password, passwordConfirmation }` |
| Current user        | `GET /api/users/me` (`role` is always included, see below)                   |
| Delete own account  | `DELETE /api/users/me` — `{ password }`, JWT required                        |

- Sign-up returns `{ user }` without a `jwt`: the account can't sign in until the email is confirmed (`POST /api/auth/local` answers 400 "Your account email is not confirmed").
- The confirmation link points at the API, which confirms and redirects (302) to `<FRONTEND_URL>/account/confirmed`.
- The reset email links to `<FRONTEND_URL>/account/reset-password?code=…`; the frontend posts that `code` to `/api/auth/reset-password`.
- A `role` (or any field other than `username`, `email`, `password`) in the sign-up body is rejected with 400. There is no `register.allowedFields`.
- JWTs last **7 days** (`jwt.expiresIn` in `config/plugins.ts`, signed with `JWT_SECRET`).

### `GET /api/users/me`

The response always carries the user's own role, `{ id, documentId, name, type }`, so the frontend can tell editors apart (`role.type === "editor"`). `?populate=role` works but isn't needed. Populating `role` the standard way would need `role.find` on the caller's role, which lists every role to anyone signed in; instead the extension adds the role already loaded with the session (`src/extensions/users-permissions/strapi-server.ts`).

### `DELETE /api/users/me`

- Deletes **only** the user of the JWT; ids in the body or URL are ignored.
- Body `{ "password": "<current password>" }`, checked with the plugin's `validatePassword`. Missing or wrong → 400 `Invalid password`, and nothing is deleted.
- No JWT → 401. Invalid or expired JWT → 401.
- Success → 204, no body. The frontend should drop its stored JWT.
- The user's comments stay published with author «Anónimo» (`authorId: "anonymous"`, `authorName: "Anónimo"`); their link to the user, email and avatar are removed. The user row is deleted for good and their refresh sessions revoked. Both happen in one transaction.
- Rate limited like `/api/auth/*` (the plugin's `rateLimit` middleware). The body is reduced to `{ password }` first, so an extra `email` field can't split the limit into fresh buckets.
- Accounts created through a third-party provider have no password, so they can't use this route.

Permissions: the action `plugin::users-permissions.user.destroyMe` is granted to **Public**, **Authenticated** and **Editor**. Public has it only so a request without a JWT reaches the controller and gets a 401 instead of Strapi's 403; the controller rejects it. `user.destroy` (`DELETE /api/users/:id`) stays off for every role.

DELETE requests have their JSON body parsed (`strapi::body` → `parsedMethods` in `config/middlewares.ts`); Koa's default parses only POST, PUT and PATCH.

## Settings applied on boot

`src/migrations/account-settings.ts` runs in `bootstrap()` after the Editor role migration:

- **Once** (marker `core/migrations/account-settings` in the store): Users & Permissions → Advanced settings get sign-up on, default role `Authenticated`, one account per email, email confirmation on, confirmation redirect `<FRONTEND_URL>/account/confirmed` and reset page `<FRONTEND_URL>/account/reset-password`; the email templates «Confirma tu correo en BogDev» and «Restablece tu contraseña de BogDev» are written in Spanish with an empty sender, so `EMAIL_FROM` is used. From then on the admin panel owns these values: later boots don't overwrite what an admin changes.
- **Every boot** (idempotent): grants `user.destroyMe` to the three roles above if missing.

`FRONTEND_URL` must be right **before the first boot** of this version (production `https://bogdev.com.co`, staging the staging frontend). If it wasn't, fix the two URLs in the admin panel (Settings → Users & Permissions plugin → Advanced settings).

## Email (SMTP)

Without an email provider no confirmation or reset email leaves the server, and sign-up can fail with "Error sending confirmation email". `config/plugins.ts` uses `@strapi/provider-email-nodemailer` when `SMTP_HOST` is set:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587            # 465 = implicit TLS; any other port upgrades with STARTTLS
SMTP_USER=
SMTP_PASS=
EMAIL_FROM="BogDev <no-reply@bogdev.com.co>"
```

Without `SMTP_HOST` Strapi keeps its default `sendmail` provider, which can't deliver from the container. Check delivery from the admin panel: Settings → Email → Send test email.

## Roles

| Role            | Who                      | What it adds                                                                       |
| --------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `Authenticated` | Every confirmed reader   | Strapi's defaults (`user.me`, `auth.changePassword`, sessions) + `user.destroyMe`  |
| `Editor`        | People who review drafts | Draft reads (see the Drafts section of `CLAUDE.md`) + `user.me` + `user.destroyMe` |

The Editor role is created by `src/migrations/editor-role.ts` (issue #53).

### Making someone an editor

1. The person signs up on the site and confirms their email.
2. Admin panel → Content Manager → **User** (Users & Permissions) → open the user.
3. Change **role** to `Editor` and save.
4. The change applies on their next request; `GET /api/users/me` returns `role.type: "editor"`. No new sign-in is needed: the JWT only carries the user id.

To revoke it, set the role back to `Authenticated`.
