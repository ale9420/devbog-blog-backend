/**
 * Citations in an article body. The Markdown cites a source of the article's
 * `references` as `[@key]`, or several at once as `[@a; @b]`. The number a
 * reader sees is not stored: it is the order in which each key first appears
 * across the `blocks` dynamic zone.
 */

import { errors } from '@strapi/utils';

interface BodyBlock {
  __component?: string;
  body?: string | null;
}

interface ReferenceEntry {
  key?: string | null;
  doi?: string | null;
  url?: string | null;
}

const KEY = '[a-z0-9][a-z0-9-]*';

/**
 * The same formats `shared.reference` declares as `regex`. Strapi only
 * enforces those on publish, so drafts are checked here too.
 */
const FORMATS: { field: keyof ReferenceEntry; pattern: RegExp; hint: string }[] = [
  { field: 'key', pattern: new RegExp(`^${KEY}$`), hint: 'lowercase letters, digits and dashes' },
  { field: 'doi', pattern: /^10\.\d{4,9}\/\S+$/, hint: 'a bare DOI such as 10.1145/3571730' },
  { field: 'url', pattern: /^https?:\/\/\S+$/, hint: 'an http(s) URL' },
];

/**
 * A citation group. The lookahead leaves out `[@handle](url)`, which is a
 * Markdown link whose text starts with `@`, not a citation.
 */
export const CITATION_PATTERN = new RegExp(`\\[(@${KEY}(?:\\s*;\\s*@${KEY})*)\\](?!\\()`, 'g');

/** Fenced code blocks and inline code, where `[@key]` is literal text. */
const CODE_PATTERN =
  /^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))|`+[^`\n]+`+/gm;

/** Keys cited in one Markdown string, in order, repeats included. */
export function citedKeys(markdown: string): string[] {
  const prose = markdown.replace(CODE_PATTERN, '');
  const keys: string[] = [];
  for (const match of prose.matchAll(CITATION_PATTERN)) {
    for (const part of match[1].split(';')) keys.push(part.trim().slice(1));
  }
  return keys;
}

/** Each cited key once, in order of first appearance across rich-text and quote blocks. */
export function citationOrder(blocks: unknown): string[] {
  if (!Array.isArray(blocks)) return [];

  const order = new Set<string>();
  for (const block of blocks as BodyBlock[]) {
    if (block == null || typeof block !== 'object' || !block.body) continue;
    if (block.__component !== 'shared.rich-text' && block.__component !== 'shared.quote') continue;
    for (const key of citedKeys(block.body)) order.add(key);
  }
  return [...order];
}

function validationError(path: string[], message: string): errors.ValidationError {
  return new errors.ValidationError(message, {
    errors: [{ path, message, name: 'ValidationError' }],
  });
}

/**
 * Throws a ValidationError when a reference has a malformed key, DOI or URL,
 * when two references share a key, or when a block cites a key no reference
 * has. References nobody cites are allowed: they read as general bibliography.
 */
export function assertReferencesValid(blocksByLocale: unknown[], references: unknown): void {
  const entries = Array.isArray(references) ? (references as ReferenceEntry[]) : [];
  entries.forEach((reference, index) => {
    for (const { field, pattern, hint } of FORMATS) {
      const value = reference?.[field];
      if (value && !pattern.test(value)) {
        throw validationError(
          ['references', String(index), field],
          `Reference ${field} "${value}" must be ${hint}`
        );
      }
    }
  });

  const keys = new Set<string>();
  const duplicates = new Set<string>();
  for (const reference of entries) {
    const key = reference?.key;
    if (!key) continue;
    if (keys.has(key)) duplicates.add(key);
    keys.add(key);
  }
  if (duplicates.size > 0) {
    throw validationError(['references'], `Duplicate reference key: ${[...duplicates].join(', ')}`);
  }

  const missing = new Set<string>();
  for (const blocks of blocksByLocale) {
    for (const key of citationOrder(blocks)) if (!keys.has(key)) missing.add(key);
  }
  if (missing.size > 0) {
    const list = [...missing].map((key) => `[@${key}]`).join(', ');
    throw validationError(['blocks'], `Cited without a reference: ${list}`);
  }
}
