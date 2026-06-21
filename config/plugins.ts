import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  upload: {
    config: {
      provider: '@strapi/provider-upload-local',
      providerOptions: {
        destination: env('UPLOAD_PATH', '/var/www/devbog-blog-backend/uploads'),
      },
      breakpoints: {
        xlarge: 1920,
        large: 1000,
        medium: 750,
        small: 500,
      },
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
        contentTypes: [{
          name: 'api::article.article',
          field: 'comments',
        }],
      },
    },
  },
});

export default config;
