/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Flashcard} from '../types';

/**
 * Cloze + HTML handling for card fields.
 *
 * Anki's native cloze syntax is `{{c1::answer}}` (optionally `{{c1::answer::hint}}`).
 * Nothing here rewrites it into another form: the markers are preserved verbatim
 * and HTML is allowed to live inside them, which Anki supports.
 */

/** Tags we allow in Front/Back. Anything else is stripped but its text kept. */
const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'br', 'ul', 'ol', 'li', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sub', 'sup', 'small', 'mark',
]);

/** Void tags that never need a closing tag. */
const VOID_TAGS = new Set(['br']);

/** Attributes kept on surviving tags; `style` is needed for highlighting. */
const ALLOWED_ATTRS = new Set(['style', 'colspan', 'rowspan']);

const SAFE_STYLE = /^[-a-z0-9\s:;#%,.()'"]+$/i;
/** `url()`, `expression()` and script URLs have no place in a card's style. */
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|javascript\s*:|@import/i;

export const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)\}\}/g;

/** Converts leftover markdown emphasis to HTML. Mirrors the original formatCell(). */
export const markdownToHtml = (value: string): string =>
  value
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=$|[\s).,;:!?])/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])_(?!\s)([^_]+?)_(?=$|[\s).,;:!?])/g, '$1<i>$2</i>');

/** Standardizes every arrow spelling onto the Unicode arrows. Mirrors the original helper. */
export const normalizeArrows = (value: string): string =>
  value
    .replace(/--+>/g, '→')
    .replace(/==+>/g, '→')
    .replace(/=>/g, '→')
    .replace(/->/g, '→')
    .replace(/-\s+>/g, '→')
    .replace(/&rarr;/gi, '→')
    .replace(/&uarr;/gi, '↑')
    .replace(/&darr;/gi, '↓')
    .replace(/&#8594;/g, '→')
    .replace(/\\rightarrow/gi, '→')
    .replace(/\\uparrow/gi, '↑')
    .replace(/\\downarrow/gi, '↓')
    .replace(/\s*→\s*/g, ' → ');

/**
 * Removes tags outside the allowlist and unsafe attributes, keeping inner text.
 * Deliberately conservative rather than a general-purpose sanitizer: the input
 * is model output destined for Anki, not for this page's DOM.
 */
export const sanitizeHtml = (value: string): string =>
  value.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)\/?>/g, (match, rawName, rawAttrs) => {
    const name = String(rawName).toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (match.startsWith('</')) return `</${name}>`;
    const attrs =
      String(rawAttrs ?? '')
        .match(/[a-zA-Z-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)
        ?.map(pair => {
          const eq = pair.indexOf('=');
          const key = pair.slice(0, eq).trim().toLowerCase();
          const val = pair.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
          if (!ALLOWED_ATTRS.has(key)) return '';
          if (key === 'style' && (!SAFE_STYLE.test(val) || UNSAFE_STYLE.test(val))) return '';
          return ` ${key}="${val}"`;
        })
        .join('') ?? '';
    return VOID_TAGS.has(name) ? `<${name}>` : `<${name}${attrs}>`;
  });

/** Reports unbalanced tags without altering the string. */
export const findUnbalancedTags = (value: string): string[] => {
  const stack: string[] = [];
  const problems: string[] = [];
  for (const m of value.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*?(\/?)>/g)) {
    const [, closing, rawName, selfClosing] = m;
    const name = rawName.toLowerCase();
    if (VOID_TAGS.has(name) || selfClosing === '/') continue;
    if (closing) {
      const idx = stack.lastIndexOf(name);
      if (idx === -1) problems.push(`stray </${name}>`);
      else stack.splice(idx, 1);
    } else {
      stack.push(name);
    }
  }
  for (const name of stack) problems.push(`unclosed <${name}>`);
  return problems;
};

export interface ClozeInfo {
  count: number;
  indices: number[];
  /** Cloze markers whose answer is empty. */
  emptyAnswers: number[];
  /** True when `{{` / `}}` do not pair up. */
  malformed: boolean;
}

export const inspectCloze = (value: string): ClozeInfo => {
  const indices: number[] = [];
  const emptyAnswers: number[] = [];
  let count = 0;
  for (const m of value.matchAll(CLOZE_RE)) {
    count += 1;
    const idx = Number(m[1]);
    indices.push(idx);
    if (stripHtml(m[2]).trim() === '') emptyAnswers.push(idx);
  }
  // Every well-formed cloze consumes one `{{` and one `}}`.
  const opens = (value.match(/\{\{/g) ?? []).length;
  const closes = (value.match(/\}\}/g) ?? []).length;
  return {count, indices, emptyAnswers, malformed: opens !== count || closes !== count};
};

export const stripHtml = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(li|p|tr|div)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

/** Text of a card with HTML and cloze markers removed, used for dedupe. */
export const cardFingerprint = (front: string): string =>
  stripHtml(front.replace(CLOZE_RE, (_m, _i, answer) => String(answer)))
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Renumbers cloze markers to a contiguous 1..n sequence while keeping repeated
 * indices grouped (Anki shows same-numbered clozes on the same card).
 */
export const renumberCloze = (value: string): string => {
  const seen = new Map<number, number>();
  return value.replace(CLOZE_RE, (_match, rawIdx: string, body: string) => {
    const original = Number(rawIdx);
    if (!seen.has(original)) seen.set(original, seen.size + 1);
    return `{{c${seen.get(original)}::${body}}}`;
  });
};

/** Applies the original project's rule: a `?` in the Front is followed by `<br><br>`. */
export const breakAfterQuestionMark = (value: string): string =>
  value.replace(/\?(?:\s|&nbsp;|<br\s*\/?>)*/gi, '?<br><br>');

/** Commas break TSV round-trips in the original workflow, so they become semicolons. */
export const replaceCommasOutsideTags = (value: string): string =>
  value.replace(/(<[^>]*>)|,/g, (match, tag) => (tag ? tag : ';'));

export interface NormalizeOptions {
  /** Front fields get cloze handling and the `?` line-break rule. */
  isFront: boolean;
  /** Keep the no-commas rule from the original prompt. */
  replaceCommas: boolean;
}

export const normalizeField = (
  raw: string,
  {isFront, replaceCommas}: NormalizeOptions,
): string => {
  let value = String(raw ?? '').trim();
  value = markdownToHtml(value);
  value = normalizeArrows(value);
  value = sanitizeHtml(value);
  if (replaceCommas) value = replaceCommasOutsideTags(value);
  if (isFront) {
    value = renumberCloze(value);
    value = breakAfterQuestionMark(value);
  }
  value = value.replace(/(?:<br>\s*){3,}/gi, '<br><br>').trim();
  // A trailing `<br><br>` left by the question-mark rule adds nothing.
  value = value.replace(/(?:<br>\s*)+$/i, '').trim();
  return value;
};

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

/** Checks one card for the failure modes that make a deck unusable in Anki. */
export const validateCard = (card: Flashcard): ValidationResult => {
  const problems: string[] = [];
  const cloze = inspectCloze(card.text);

  if (cloze.count === 0) problems.push('Front has no cloze deletion');
  if (cloze.malformed) problems.push('Front has malformed cloze braces');
  if (cloze.emptyAnswers.length > 0) problems.push('Front has an empty cloze answer');
  if (stripHtml(card.text).replace(/\?/g, '').trim().length < 10) {
    problems.push('Front is too short to be a usable card');
  }
  if (inspectCloze(card.extra).count > 0) {
    problems.push('Back contains a cloze deletion (it would hide the explanation)');
  }
  if (stripHtml(card.extra).trim() === '') problems.push('Back is empty');

  problems.push(...findUnbalancedTags(card.text).map(p => `Front: ${p}`));
  problems.push(...findUnbalancedTags(card.extra).map(p => `Back: ${p}`));

  if (!card.tag || /\s/.test(card.tag)) problems.push('Tag is empty or contains whitespace');
  if (card.tag?.includes('::::') || /::$/.test(card.tag ?? '')) {
    problems.push('Tag has an empty hierarchy component');
  }

  return {ok: problems.length === 0, problems};
};

export interface DedupeResult {
  cards: Flashcard[];
  /** Cards dropped as exact duplicates of an earlier card. */
  duplicates: Flashcard[];
  /** Cards dropped because they could not be repaired into a valid card. */
  rejected: Array<{card: Flashcard; problems: string[]}>;
}

/**
 * Normalizes, validates and de-duplicates a batch of cards.
 * Duplicate detection uses the caller's `seen` set so cards repeated across
 * batches collapse instead of reaching the export.
 */
export const finalizeCards = (
  raw: Flashcard[],
  opts: {replaceCommas?: boolean; seen?: Set<string>} = {},
): DedupeResult => {
  const replaceCommas = opts.replaceCommas ?? true;
  const seen = opts.seen ?? new Set<string>();
  const cards: Flashcard[] = [];
  const duplicates: Flashcard[] = [];
  const rejected: Array<{card: Flashcard; problems: string[]}> = [];

  for (const input of raw) {
    const card: Flashcard = {
      ...input,
      text: normalizeField(input.text, {isFront: true, replaceCommas}),
      extra: normalizeField(input.extra, {isFront: false, replaceCommas}),
    };
    const {ok, problems} = validateCard(card);
    if (!ok) {
      rejected.push({card, problems});
      continue;
    }
    const fingerprint = cardFingerprint(card.text);
    if (seen.has(fingerprint)) {
      duplicates.push(card);
      continue;
    }
    seen.add(fingerprint);
    cards.push(card);
  }

  return {cards, duplicates, rejected};
};
