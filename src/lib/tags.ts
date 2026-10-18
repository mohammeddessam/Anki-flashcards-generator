/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hierarchical Anki tag construction.
 *
 * Anki treats `::` as a hierarchy separator and whitespace as a tag separator,
 * so every component must be whitespace-free. The prefix may itself contain
 * `::` (e.g. `MRCP::Passmedicine_notes`), in which case all of its segments are
 * preserved in order.
 */

/** Normalizes one tag component: strips HTML, collapses separators to `_`. */
export const normalizeTagToken = (value: string): string =>
  value
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    // `::` is the hierarchy separator and must never appear inside a component.
    .replace(/::/g, ' ')
    .replace(/[^\p{L}\p{N}_+-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');

/** Splits a user-supplied prefix such as `MRCP :: Passmedicine notes` into components. */
export const splitPrefix = (prefix: string): string[] =>
  prefix
    .split('::')
    .map(normalizeTagToken)
    .filter(Boolean);

export interface BuildTagOptions {
  /** Leading components, e.g. `MRCP::Passmedicine_notes`. */
  prefix: string;
  /** Trailing components, typically [subject, topic]. Empty values are dropped. */
  trailing: Array<string | undefined>;
  /** Used when every trailing component is empty. */
  fallback?: string[];
}

/** Builds a full hierarchical tag. Never emits empty components or a trailing `::`. */
export const buildTag = ({prefix, trailing, fallback = []}: BuildTagOptions): string => {
  const head = splitPrefix(prefix);
  let tail = trailing.map(t => normalizeTagToken(t ?? '')).filter(Boolean);
  if (tail.length === 0) tail = fallback.map(normalizeTagToken).filter(Boolean);
  const all = [...head, ...tail];
  return all.length > 0 ? all.join('::') : 'Untagged';
};

/**
 * Takes whatever the model returned for a tag and keeps only the components
 * after the configured prefix, so a model that echoes the prefix (or invents a
 * different one) cannot corrupt the hierarchy.
 */
export const trailingComponentsFromModelTag = (
  modelTag: string,
  prefix: string,
): string[] => {
  const head = splitPrefix(prefix).map(p => p.toLowerCase());
  const parts = modelTag
    .replace(/<[^>]*>/g, '')
    .split(/::|\//)
    .map(normalizeTagToken)
    .filter(Boolean);

  // Drop a leading run that duplicates the configured prefix.
  let start = 0;
  while (
    start < parts.length &&
    start < head.length &&
    parts[start].toLowerCase() === head[start]
  ) {
    start += 1;
  }
  // Also drop a single stray prefix-like component the model may have added.
  const rest = parts.slice(start);
  if (rest.length > 0 && head.includes(rest[0].toLowerCase())) rest.shift();
  return rest;
};
