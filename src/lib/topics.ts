/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DocPage, SourceDocument, Topic} from '../types';

/**
 * Heading-based segmentation of an extracted document into topics and
 * subtopics, each carrying the page range it spans. Page ranges are what let
 * citations survive segmentation and batching.
 */

export interface HeadingHit {
  title: string;
  level: number;
  pageIndex: number;
  /** Character offset of the heading inside its page's text. */
  offset: number;
}

const MAX_HEADING_CHARS = 90;
const NOISE = /^(page\s*\d+|\d+|chapter\s*\d+|contents|index|references|bibliography)$/i;

/** Lines that look like a heading rather than prose. */
export const detectHeading = (line: string): {title: string; level: number} | null => {
  const raw = line.trim();
  if (raw.length === 0 || raw.length > MAX_HEADING_CHARS) return null;

  const markdown = /^(#{1,6})\s+(.*)$/.exec(raw);
  if (markdown) {
    const title = cleanHeading(markdown[2]);
    return title ? {title, level: Math.min(markdown[1].length - 1, 3)} : null;
  }

  const stripped = cleanHeading(raw);
  if (!stripped || NOISE.test(stripped)) return null;

  const words = stripped.split(/\s+/);
  if (words.length > 10) return null;
  // Prose punctuation, including the comma that ends a wrapped list item.
  if (/[.!?,;]$/.test(stripped)) return null;

  // "1.2.3 Title" / "1. Title" / "II. Title". Kept short, because a numbered
  // list of facts looks identical to a numbered list of section titles and
  // only length tells them apart.
  const numbered = /^((?:\d+|[IVXLC]+)(?:\.\d+)*)[.)]?\s+(\S.*)$/.exec(raw);
  if (numbered) {
    const title = cleanHeading(numbered[2]);
    if (!title || title.split(/\s+/).length > 6) return null;
    const depth = (numbered[1].match(/\./g) ?? []).length;
    return {title, level: Math.min(depth, 3)};
  }

  // Shouty headings, e.g. "HEART FAILURE".
  const letters = stripped.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) {
    return {title: toTitleCase(stripped), level: 0};
  }

  // "Heart failure:" or "Management of heart failure:". A colon also ends a
  // sentence that introduces a list, so this stays short and must start like a
  // title rather than mid-sentence.
  if (/:$/.test(raw)) {
    if (words.length > 4 || !/^[A-Z0-9]/.test(stripped)) return null;
    return {title: stripped, level: 1};
  }

  // Title Case line with no terminal punctuation.
  const capitalised = words.filter(w => /^[A-Z]/.test(w)).length;
  if (words.length >= 2 && capitalised / words.length >= 0.6) {
    return {title: stripped, level: 1};
  }

  return null;
};

const cleanHeading = (value: string): string =>
  value
    .replace(/<[^>]*>/g, '')
    .replace(/^[\s*\-•·]+/, '')
    .replace(/[\s:：|–—-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

const toTitleCase = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\b([a-z])/g, (_m, c: string) => c.toUpperCase());

export const findHeadings = (pages: DocPage[]): HeadingHit[] => {
  const hits: HeadingHit[] = [];
  for (const page of pages) {
    let offset = 0;
    for (const line of page.text.split(/\r?\n/)) {
      const hit = detectHeading(line);
      if (hit) {
        hits.push({...hit, pageIndex: page.pageIndex, offset});
      }
      offset += line.length + 1;
    }
  }
  return hits;
};

/**
 * Builds the topic list. Headings that repeat (running titles in a PDF) are
 * collapsed into the first occurrence and extend that topic's page range.
 */
export const detectTopics = (doc: SourceDocument): Topic[] => {
  const pages = doc.pages;
  if (pages.length === 0) return [];

  const hits = findHeadings(pages);
  const lastPage = pages[pages.length - 1].pageIndex;

  if (hits.length === 0) {
    return [
      {
        id: 'topic-0',
        title: doc.fileName.replace(/\.[^.]+$/, '') || 'Whole document',
        startPage: pages[0].pageIndex,
        endPage: lastPage,
        level: 0,
        charCount: pages.reduce((n, p) => n + p.text.length, 0),
      },
    ];
  }

  const byTitle = new Map<string, Topic>();
  const order: Topic[] = [];

  hits.forEach((hit, i) => {
    const key = hit.title.toLowerCase();
    const endPage = i + 1 < hits.length ? Math.max(hit.pageIndex, hits[i + 1].pageIndex - 1) : lastPage;
    const existing = byTitle.get(key);
    if (existing) {
      // A running header or a topic continued later: widen the range.
      existing.startPage = Math.min(existing.startPage, hit.pageIndex);
      existing.endPage = Math.max(existing.endPage, endPage);
      existing.level = Math.min(existing.level, hit.level);
      return;
    }
    const topic: Topic = {
      id: `topic-${order.length}`,
      title: hit.title,
      startPage: hit.pageIndex,
      endPage,
      level: hit.level,
      charCount: 0,
    };
    byTitle.set(key, topic);
    order.push(topic);
  });

  for (const topic of order) {
    topic.charCount = pages
      .filter(p => p.pageIndex >= topic.startPage && p.pageIndex <= topic.endPage)
      .reduce((n, p) => n + p.text.length, 0);
  }

  // Drop sections with almost no content; they are usually stray bold lines.
  const substantive = order.filter(t => t.charCount >= 120);
  return substantive.length > 0 ? substantive : order;
};

export const wholeDocumentTopic = (doc: SourceDocument): Topic => ({
  id: 'whole-document',
  title: 'Whole document',
  startPage: doc.pages[0]?.pageIndex ?? 1,
  endPage: doc.pages[doc.pages.length - 1]?.pageIndex ?? 1,
  level: 0,
  charCount: doc.pages.reduce((n, p) => n + p.text.length, 0),
});

// --- Batching ---

export interface Batch {
  topic: Topic;
  /** Pages in this batch, each still carrying its own page index and label. */
  pages: DocPage[];
}

/** Characters of source text per model request. */
export const DEFAULT_BATCH_CHARS = 9000;

/**
 * Splits the selected topics into page-aligned batches.
 *
 * Batches never split a page, so every excerpt sent to the model stays
 * attributable to exactly one page, and no page appears in two batches of the
 * same topic — which is what would otherwise duplicate cards.
 */
export const planBatches = (
  doc: SourceDocument,
  topics: Topic[],
  batchChars = DEFAULT_BATCH_CHARS,
): Batch[] => {
  const batches: Batch[] = [];
  const claimed = new Set<string>();

  for (const topic of topics) {
    const pages = doc.pages.filter(
      p =>
        p.pageIndex >= topic.startPage &&
        p.pageIndex <= topic.endPage &&
        p.text.trim().length > 0,
    );
    let current: DocPage[] = [];
    let size = 0;
    for (const page of pages) {
      const key = `${topic.id}:${page.pageIndex}`;
      if (claimed.has(key)) continue;
      claimed.add(key);
      if (current.length > 0 && size + page.text.length > batchChars) {
        batches.push({topic, pages: current});
        current = [];
        size = 0;
      }
      current.push(page);
      size += page.text.length;
    }
    if (current.length > 0) batches.push({topic, pages: current});
  }

  return batches;
};

/** Renders a batch for the prompt with explicit, machine-readable page markers. */
export const renderBatchForPrompt = (doc: SourceDocument, batch: Batch): string =>
  batch.pages
    .map(page => {
      const label = doc.hasRealPages
        ? `PAGE_INDEX=${page.pageIndex}${page.printedPage ? ` PRINTED_PAGE=${page.printedPage}` : ''}`
        : `SECTION_CHUNK=${page.pageIndex}`;
      return `[${label}]\n${page.text}`;
    })
    .join('\n\n');
