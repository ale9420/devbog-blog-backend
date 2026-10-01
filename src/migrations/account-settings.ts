import type { Core } from '@strapi/strapi';

const ROLE_UID = 'plugin::users-permissions.role';
const PERMISSION_UID = 'plugin::users-permissions.permission';
// DELETE /api/users/me (src/extensions/users-permissions). Never `user.destroy`:
// that one deletes any user by id. Public has it too so that a request without
// a JWT reaches the controller and gets a 401; the controller only ever deletes
// the user of the JWT.
const DELETE_ME_ACTION = 'plugin::users-permissions.user.destroyMe';
const DELETE_ME_ROLES = ['public', 'authenticated', 'editor'];
// Marks that the defaults below were written once; from then on the admin
// panel (Users & Permissions → Advanced settings, Email templates) owns them.
const MARKER = { type: 'core', name: 'migrations', key: 'account-settings' };
const VERSION = 1;

function frontendUrl(path: string): string {
  const base = (process.env.FRONTEND_URL ?? 'https://bogdev.com.co').replace(/\/+$/, '');
  return `${base}${path}`;
}

function advancedSettings() {
  return {
    allow_register: true,
    default_role: 'authenticated',
    unique_email: true,
    email_confirmation: true,
    email_confirmation_redirection: frontendUrl('/account/confirmed'),
    email_reset_password: frontendUrl('/account/reset-password'),
  };
}

// An empty `from` makes users-permissions fall back to the email provider's
// `defaultFrom` (EMAIL_FROM), so the sender is set per environment.
const FROM = { name: '', email: '' };

const EMAIL_TEMPLATES = {
  email_confirmation: {
    object: 'Confirma tu correo en BogDev',
    message: `<p>Hola <%= USER.username %>,</p>

<p>Gracias por crear tu cuenta en BogDev. Confirma tu correo con este enlace:</p>

<p><a href="<%= URL %>?confirmation=<%= CODE %>">Confirmar mi correo</a></p>

<p>Si no creaste una cuenta, ignora este mensaje.</p>`,
  },
  reset_password: {
    object: 'Restablece tu contraseña de BogDev',
    message: `<p>Hola,</p>

<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en BogDev. Elige una nueva con este enlace:</p>

<p><a href="<%= URL %>?code=<%= TOKEN %>">Restablecer mi contraseña</a></p>

<p>Si no lo pediste, ignora este mensaje: tu contraseña no cambia.</p>`,
  },
};

type EmailTemplates = Record<
  keyof typeof EMAIL_TEMPLATES,
  { options: Record<string, unknown> & { object: string; message: string } }
>;

export type AccountSettingsReport = { settingsApplied: boolean; permissionsGranted: number };

/**
 * Account settings for issue #52.
 *
 * - Once (tracked by a store marker): turns on sign-up with email confirmation,
 *   points the confirmation and reset links at the frontend (`FRONTEND_URL`)
 *   and writes the Spanish email templates. Later boots leave them alone, so
 *   what an admin changes in the panel sticks.
 * - Every boot (idempotent): grants `DELETE /api/users/me` to the Public,
 *   Authenticated and Editor roles. Runs after `ensureEditorRole`.
 */
export async function applyAccountSettings(strapi: Core.Strapi): Promise<AccountSettingsReport> {
  const applied = (await strapi.store.get(MARKER)) as { version?: number } | null;
  const settingsApplied = !applied || (applied.version ?? 0) < VERSION;

  if (settingsApplied) {
    const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' });

    const advanced = ((await pluginStore.get({ key: 'advanced' })) ?? {}) as object;
    await pluginStore.set({ key: 'advanced', value: { ...advanced, ...advancedSettings() } });

    // users-permissions creates the templates in its own bootstrap, before ours.
    const email = (await pluginStore.get({ key: 'email' })) as EmailTemplates | null;
    if (email) {
      for (const [name, template] of Object.entries(EMAIL_TEMPLATES)) {
        const current = email[name as keyof EmailTemplates];
        if (current) current.options = { ...current.options, ...template, from: FROM };
      }
      await pluginStore.set({ key: 'email', value: email });
    }

    await strapi.store.set({ ...MARKER, value: { version: VERSION } });
  }

  let permissionsGranted = 0;
  for (const type of DELETE_ME_ROLES) {
    const role = (await strapi.db.query(ROLE_UID).findOne({ where: { type } })) as {
      id: number;
    } | null;
    if (!role) continue;
    const granted = await strapi.db
      .query(PERMISSION_UID)
      .count({ where: { role: role.id, action: DELETE_ME_ACTION } });
    if (granted > 0) continue;
    await strapi.db.query(PERMISSION_UID).create({
      data: { action: DELETE_ME_ACTION, role: role.id },
    });
    permissionsGranted += 1;
  }

  return { settingsApplied, permissionsGranted };
}
