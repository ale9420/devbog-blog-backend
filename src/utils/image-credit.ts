/**
 * Checks for `shared.image-credit`, wherever a document carries one: the
 * article's `coverCredit`, a `shared.media` block's `credit` and each
 * `shared.slider` item's `credit`.
 */

import { errors } from '@strapi/utils';

interface ImageCredit {
  license?: string | null;
  author?: string | null;
  authorUrl?: string | null;
  sourceUrl?: string | null;
  licenseUrl?: string | null;
}

interface BodyBlock {
  __component?: string;
  credit?: ImageCredit | null;
  items?: { credit?: ImageCredit | null }[] | null;
}

/** Licenses whose terms require naming the author and linking the work. */
export const ATTRIBUTION_LICENSES = ['cc-by-4.0', 'cc-by-sa-4.0', 'cc-by-nc-4.0'];

const URL_FIELDS = ['authorUrl', 'sourceUrl', 'licenseUrl'] as const;
const URL_PATTERN = /^https?:\/\/\S+$/;

/** Every credit in a document's data, with its path for error messages. */
function creditsOf(data: Record<string, unknown>): [string[], ImageCredit][] {
  const found: [string[], ImageCredit][] = [];
  if (data.coverCredit) found.push([['coverCredit'], data.coverCredit as ImageCredit]);

  const blocks = Array.isArray(data.blocks) ? (data.blocks as BodyBlock[]) : [];
  blocks.forEach((block, index) => {
    if (block?.__component === 'shared.media' && block.credit) {
      found.push([['blocks', String(index), 'credit'], block.credit]);
    }
    if (block?.__component === 'shared.slider' && Array.isArray(block.items)) {
      block.items.forEach((item, itemIndex) => {
        if (item?.credit) {
          found.push([
            ['blocks', String(index), 'items', String(itemIndex), 'credit'],
            item.credit,
          ]);
        }
      });
    }
  });
  return found;
}

/**
 * Throws a ValidationError when a credit has a malformed URL, or uses a
 * license that requires attribution without an author and a link to the
 * original work. The URL formats repeat the component's `regex`, which
 * Strapi only enforces on publish.
 */
export function assertImageCreditsValid(data: Record<string, unknown>): void {
  for (const [path, credit] of creditsOf(data)) {
    for (const field of URL_FIELDS) {
      const value = credit[field];
      if (value && !URL_PATTERN.test(value)) {
        const message = `Image credit ${field} "${value}" must be an http(s) URL (${path.join('.')})`;
        throw new errors.ValidationError(message, {
          errors: [{ path: [...path, field], message, name: 'ValidationError' }],
        });
      }
    }

    if (credit.license && ATTRIBUTION_LICENSES.includes(credit.license)) {
      for (const field of ['author', 'sourceUrl'] as const) {
        if (credit[field]?.trim()) continue;
        const message = `Image credit under ${credit.license} needs ${field} (${path.join('.')})`;
        throw new errors.ValidationError(message, {
          errors: [{ path: [...path, field], message, name: 'ValidationError' }],
        });
      }
    }
  }
}
