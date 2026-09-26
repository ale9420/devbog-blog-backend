/**
 * Plain text of an article body, for searching its content. It keeps the
 * words a reader sees (including code) and drops Markdown and HTML syntax.
 */

import { CITATION_PATTERN } from './citations';

interface BodyBlock {
  __component?: string;
  body?: string | null;
  title?: string | null;
}

/** Hard cap so a huge article can't bloat every row it is copied into. */
export const MAX_PLAIN_TEXT_LENGTH = 100_000;

export function markdownToPlainText(markdown: string): string {
  return (
    markdown
      .replace(/\r\n?/g, '\n')
      // Code fences: keep the code, drop the fences and their language tag.
      .replace(/^[ \t]*(```|~~~)[^\n]*$/gm, '')
      // Citation markers (`[@key]`), with the space before them.
      .replace(new RegExp(`[ \\t]*${CITATION_PATTERN.source}`, 'g'), '')
      // Images and links keep their visible text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^[ \t]*\[[^\]]+\]:\s*\S+.*$/gm, '')
      // HTML tags and comments.
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, '')
      // Block markers: headings, quotes, list bullets and numbers, rules, tables.
      .replace(/^[ \t]{0,3}#{1,6}\s+/gm, '')
      .replace(/^[ \t]*>+\s?/gm, '')
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
      .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '')
      .replace(/^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*(?:\n|$)/gm, '')
      .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_row, cells: string) =>
        cells
          .split('|')
          .map((cell) => cell.trim())
          .join(' ')
      )
      // Inline emphasis (underscores only at word edges, so snake_case survives),
      // strike-through and code.
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(^|\W)__(.+?)__(?=\W|$)/g, '$1$2')
      .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
      .replace(/(^|\W)_(\S(?:.*?\S)?)_(?=\W|$)/g, '$1$2')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`+([^`]+)`+/g, '$1')
      // Whitespace.
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Plain text of the `blocks` dynamic zone: rich-text bodies and quotes, in order. */
export function blocksToPlainText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';

  const parts: string[] = [];
  for (const block of blocks as BodyBlock[]) {
    if (block == null || typeof block !== 'object') continue;
    if (block.__component === 'shared.rich-text' && block.body) {
      parts.push(markdownToPlainText(block.body));
    } else if (block.__component === 'shared.quote') {
      if (block.title) parts.push(block.title.trim());
      if (block.body) parts.push(markdownToPlainText(block.body));
    }
  }
  return parts
    .filter((part) => part.length > 0)
    .join('\n\n')
    .slice(0, MAX_PLAIN_TEXT_LENGTH);
}

/**
 * A window of `text` around the first case-insensitive match of `query`, cut
 * at word boundaries, with an ellipsis where it was cut. Returns null when
 * `query` does not appear. The result is plain text: callers must escape it
 * before wrapping the match in markup.
 */
export function snippetAround(text: string, query: string, radius = 80): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  const index = flat.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index === -1) return null;

  let start = Math.max(0, index - radius);
  let end = Math.min(flat.length, index + query.length + radius);
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space !== -1 && space < index) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > index + query.length) end = space;
  }

  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}
