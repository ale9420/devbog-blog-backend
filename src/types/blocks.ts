/**
 * Shapes of the article `blocks` dynamic zone, as far as the checks and
 * transforms that read it need them. Every field is optional: a block only
 * carries the ones its component declares.
 */

export interface ImageCredit {
  license?: string | null;
  author?: string | null;
  authorUrl?: string | null;
  sourceUrl?: string | null;
  licenseUrl?: string | null;
}

export interface BodyBlock {
  __component?: string;
  /** `shared.rich-text` and `shared.quote`. */
  body?: string | null;
  /** `shared.quote`. */
  title?: string | null;
  /** `shared.media`. */
  credit?: ImageCredit | null;
  /** `shared.slider`. */
  items?: { credit?: ImageCredit | null }[] | null;
}
