import type { Core } from '@strapi/strapi';

/** Data Fedify hands to every dispatcher and listener. */
export type FediverseContextData = {
  strapi: Core.Strapi;
};
