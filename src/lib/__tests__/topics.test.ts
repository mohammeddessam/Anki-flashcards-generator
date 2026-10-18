/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it} from 'vitest';

import type {SourceDocument} from '../../types';
import {chunkText, fromPlainText} from '../extract';
import {
  DEFAULT_BATCH_CHARS,
  detectHeading,
  detectTopics,
  planBatches,
  renderBatchForPrompt,
} from '../topics';

const doc = (pages: Array<{pageIndex: number; text: string; printedPage?: string}>): SourceDocument => ({
  fileName: 'notes.pdf',
  kind: 'pdf',
  pages,
  hasRealPages: true,
  hasPrintedPages: pages.some(p => !!p.printedPage),
  canRenderPages: true,
  warnings: [],
});

describe('heading detection', () => {
  it('recognizes markdown, numbered, shouty and colon headings', () => {
    expect(detectHeading('## Heart Failure')).toEqual({title: 'Heart Failure', level: 1});
    expect(detectHeading('2.1 Acute management')).toEqual({title: 'Acute management', level: 1});
    expect(detectHeading('HEART FAILURE')).toEqual({title: 'Heart Failure', level: 0});
    expect(detectHeading('Management of heart failure:')).toEqual({
      title: 'Management of heart failure',
      level: 1,
    });
  });

  it('ignores prose, page furniture and over-long lines', () => {
    expect(detectHeading('The patient presented with chest pain and was admitted.')).toBeNull();
    expect(detectHeading('Page 12')).toBeNull();
    expect(detectHeading('References')).toBeNull();
    expect(detectHeading('x'.repeat(200))).toBeNull();
  });
});

describe('topic segmentation', () => {
  it('assigns each topic the page range it spans', () => {
    const topics = detectTopics(
      doc([
        {pageIndex: 1, text: `HEART FAILURE\n${'Reduced ejection fraction detail. '.repeat(12)}`},
        {pageIndex: 2, text: `${'More heart failure detail. '.repeat(12)}`},
        {pageIndex: 3, text: `AORTIC STENOSIS\n${'Ejection systolic murmur detail. '.repeat(12)}`},
      ]),
    );
    expect(topics.map(t => [t.title, t.startPage, t.endPage])).toEqual([
      ['Heart Failure', 1, 2],
      ['Aortic Stenosis', 3, 3],
    ]);
  });

  it('collapses a running header into one topic instead of one per page', () => {
    const topics = detectTopics(
      doc([
        {pageIndex: 1, text: `CARDIOLOGY\n${'Content. '.repeat(30)}`},
        {pageIndex: 2, text: `CARDIOLOGY\n${'Content. '.repeat(30)}`},
        {pageIndex: 3, text: `CARDIOLOGY\n${'Content. '.repeat(30)}`},
      ]),
    );
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({startPage: 1, endPage: 3});
  });

  it('falls back to a single whole-document topic when no heading is found', () => {
    const topics = detectTopics(doc([{pageIndex: 1, text: 'just prose that runs on and on.'}]));
    expect(topics).toHaveLength(1);
    expect(topics[0].title).toBe('notes');
  });
});

describe('batching', () => {
  const longPage = (pageIndex: number) => ({
    pageIndex,
    text: `Page ${pageIndex} content. ${'x'.repeat(5000)}`,
  });

  it('never splits a page across two batches', () => {
    const d = doc([longPage(1), longPage(2), longPage(3), longPage(4)]);
    const topics = [{id: 't', title: 'All', startPage: 1, endPage: 4, level: 0, charCount: 0}];
    const batches = planBatches(d, topics);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batch.pages.length).toBeGreaterThan(0);
    }
  });

  it('assigns every page to exactly one batch per topic, losing and duplicating none', () => {
    const d = doc([longPage(1), longPage(2), longPage(3), longPage(4), longPage(5)]);
    const topics = [{id: 't', title: 'All', startPage: 1, endPage: 5, level: 0, charCount: 0}];
    const seen = planBatches(d, topics).flatMap(b => b.pages.map(p => p.pageIndex));
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(seen).size).toBe(5);
  });

  it('skips pages with no extractable text', () => {
    const d = doc([{pageIndex: 1, text: ''}, {pageIndex: 2, text: 'real content here'}]);
    const topics = [{id: 't', title: 'All', startPage: 1, endPage: 2, level: 0, charCount: 0}];
    expect(planBatches(d, topics).flatMap(b => b.pages.map(p => p.pageIndex))).toEqual([2]);
  });

  it('keeps each batch within the character budget where a single page allows it', () => {
    const d = doc(Array.from({length: 10}, (_, i) => ({pageIndex: i + 1, text: 'y'.repeat(1000)})));
    const topics = [{id: 't', title: 'All', startPage: 1, endPage: 10, level: 0, charCount: 0}];
    for (const batch of planBatches(d, topics)) {
      const size = batch.pages.reduce((n, p) => n + p.text.length, 0);
      expect(size).toBeLessThanOrEqual(DEFAULT_BATCH_CHARS);
    }
  });

  it('marks each page in the prompt with its own index and printed label', () => {
    const d = doc([{pageIndex: 12, printedPage: '7', text: 'heart failure'}]);
    const topics = [{id: 't', title: 'HF', startPage: 12, endPage: 12, level: 0, charCount: 0}];
    const rendered = renderBatchForPrompt(d, planBatches(d, topics)[0]);
    expect(rendered).toContain('[PAGE_INDEX=12 PRINTED_PAGE=7]');
  });

  it('marks page-less sources as chunks rather than pages', () => {
    const d = fromPlainText('notes.txt', 'text', 'Alpha content\n\nBeta content', []);
    const topics = [{id: 't', title: 'All', startPage: 1, endPage: 9, level: 0, charCount: 0}];
    expect(renderBatchForPrompt(d, planBatches(d, topics)[0])).toContain('[SECTION_CHUNK=1]');
  });
});

describe('text chunking', () => {
  it('splits on blank lines and never mid-paragraph', () => {
    const chunks = chunkText(`${'a'.repeat(400)}\n\n${'b'.repeat(400)}\n\n${'c'.repeat(400)}`, 500);
    expect(chunks).toHaveLength(3);
    expect(chunks.every(c => /^(a+|b+|c+)$/.test(c))).toBe(true);
  });

  it('returns one chunk for short text', () => {
    expect(chunkText('short')).toEqual(['short']);
  });
});
