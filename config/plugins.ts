import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  const r2Bucket = env('R2_BUCKET');

  const uploadConfig = r2Bucket
    ? {
        provider: '@strapi/provider-upload-aws-s3',
        providerOptions: {
          baseUrl: env('R2_BASE_URL'),
          s3Options: {
            credentials: {
              accessKeyId: env('R2_ACCESS_KEY_ID'),
              secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
            },
            endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
            region: 'auto',
            params: {
              Bucket: r2Bucket,
              ACL: undefined,
            },
          },
        },
        breakpoints: {
          xlarge: 1920,
          large: 1000,
          medium: 750,
          small: 500,
        },
      }
    : {
        provider: 'local',
        providerOptions: {},
        sizeLimit: 250 * 1024 * 1024,
      };

  // Without SMTP_HOST Strapi keeps its default `sendmail` provider, which can't
  // deliver from a container: account confirmation and reset emails need SMTP.
  const smtpHost = env('SMTP_HOST');
  const smtpPort = env.int('SMTP_PORT', 587);
  const emailFrom = env('EMAIL_FROM', 'BogDev <no-reply@bogdev.com.co>');
  const emailConfig = smtpHost
    ? {
        provider: 'nodemailer',
        providerOptions: {
          host: smtpHost,
          port: smtpPort,
          // 465 is implicit TLS; other ports upgrade with STARTTLS.
          secure: smtpPort === 465,
          auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
        },
        settings: { defaultFrom: emailFrom, defaultReplyTo: emailFrom },
      }
    : { settings: { defaultFrom: emailFrom, defaultReplyTo: emailFrom } };

  return {
    fediverse: {
      enabled: env.bool('FEDIVERSE_ENABLED', false),
      resolve: './src/plugins/fediverse',
    },
    upload: {
      config: uploadConfig,
    },
    email: {
      config: emailConfig,
    },
    // Accounts (issue #52): sessions last 7 days. Registration accepts only
    // username, email and password (no `register.allowedFields`), so a `role`
    // in the body is rejected. Sign-up, confirmation and reset URLs live in the
    // plugin store (src/migrations/account-settings.ts).
    'users-permissions': {
      config: {
        jwt: { expiresIn: '7d' },
      },
    },
    seo: {
      enabled: true,
    },
    comments: {
      enabled: true,
      config: {
        enabledCollections: ['api::article.article'],
        approvalScores: {
          enabled: true,
          thresholds: {
            new: 0,
            approved: 1,
            rejected: -1,
            blocked: -10,
          },
        },
        moderation: {
          enabled: true,
          removeBlocked: false,
        },
        nested: {
          enabled: true,
          depth: 10,
          maxDepth: 10,
        },
        glow: {
          enabled: false,
          emailNotifications: false,
        },
        autopopulate: {
          populate: {
            author: {
              fields: ['name', 'email', 'avatar'],
            },
          },
        },
        entryRelation: {
          contentTypes: [
            {
              name: 'api::article.article',
              field: 'comments',
            },
          ],
        },
      },
    },
  };
};

export default config;
