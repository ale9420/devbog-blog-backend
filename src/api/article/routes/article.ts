/**
 * article router.
 */

import { factories } from '@strapi/strapi';
import { ARTICLE_UID } from '../../../constants/uids';

export default factories.createCoreRouter(ARTICLE_UID);
