/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it} from 'vitest';

import {extractPdf, usefulPageLabels} from '../src/lib/extract/pdf';
import {formatPageReference, makeCardSource} from '../src/lib/citation';
import {detectTopics, planBatches, renderBatchForPrompt} from '../src/lib/topics';
import {asFile, makePdf} from './make-pdf';

/**
 * End-to-end page attribution against a real PDF built in the test, so the
 * expected page text and page labels are known exactly.
 *
 * Page labels are declared as: pages 1-2 lowercase roman, page 3 onward decimal
 * restarting at 1. So PDF page 3 carries printed page "1" — index and printed
 * number genuinely differ, which is what citations must not conflate.
 */
const SYNTHETIC = makePdf({
  pages: [
    ['HEART FAILURE', 'Ejection fraction below 40 percent defines systolic failure.'],
    ['Loop diuretics relieve congestion in acute decompensation.'],
    ['AORTIC STENOSIS', 'An ejection systolic murmur radiates to the carotids.'],
    ['Severe stenosis shows a valve area below 1.0 square centimetre.'],
  ],
  pageLabels: [
    [0, '<< /S /r >>'],
    [2, '<< /S /D /St 1 >>'],
  ],
});

describe('page label handling', () => {
  it('discards a plain 1..n sequence as not a real printed numbering', () => {
    expect(usefulPageLabels(['1', '2', '3'])).toBeNull();
    expect(usefulPageLabels(null)).toBeNull();
    expect(usefulPageLabels([])).toBeNull();
  });

  it('keeps labels that differ from the index', () => {
    expect(usefulPageLabels(['i', 'ii', '1'])).toEqual(['i', 'ii', '1']);
  });
});

describe('PDF extraction', () => {
  it('extracts one page per PDF page, in order, with its own text', async () => {
    const {doc} = await extractPdf(asFile(SYNTHETIC, 'synthetic-notes.pdf'));
    expect(doc.pages).toHaveLength(4);
    expect(doc.pages.map(p => p.pageIndex)).toEqual([1, 2, 3, 4]);
    expect(doc.pages[0].text).toContain('HEART FAILURE');
    expect(doc.pages[0].text).toContain('Ejection fraction below 40 percent');
    expect(doc.pages[2].text).toContain('AORTIC STENOSIS');
    // Text from one page must not leak into another.
    expect(doc.pages[1].text).not.toContain('HEART FAILURE');
    expect(doc.pages[0].text).not.toContain('Loop diuretics');
  });

  it('reads printed page numbers from the PDF page label tree', async () => {
    const {doc} = await extractPdf(asFile(SYNTHETIC, 'synthetic-notes.pdf'));
    expect(doc.hasPrintedPages).toBe(true);
    expect(doc.pages.map(p => p.printedPage)).toEqual(['i', 'ii', '1', '2']);
  });

  it('reports no printed page numbers for a PDF that declares none', async () => {
    const plain = makePdf({pages: [['Only page'], ['Second page']]});
    const {doc} = await extractPdf(asFile(plain, 'plain.pdf'));
    expect(doc.hasPrintedPages).toBe(false);
    expect(doc.pages.every(p => p.printedPage === undefined)).toBe(true);
    expect(doc.warnings.join(' ')).toMatch(/declares no printed page numbers/);
  });

  it('warns when a PDF has no text layer at all', async () => {
    const blank = makePdf({pages: [[], []]});
    const {doc} = await extractPdf(asFile(blank, 'scan.pdf'));
    expect(doc.warnings.join(' ')).toMatch(/No text layer/);
  });
});

describe('page attribution survives segmentation and batching', () => {
  it('maps each detected topic onto the pages that actually contain it', async () => {
    const {doc} = await extractPdf(asFile(SYNTHETIC, 'synthetic-notes.pdf'));
    const topics = detectTopics(doc);
    expect(topics.map(t => [t.title, t.startPage, t.endPage])).toEqual([
      ['Heart Failure', 1, 2],
      ['Aortic Stenosis', 3, 4],
    ]);
  });

  it('sends every page to the model labelled with its own index and printed number', async () => {
    const {doc} = await extractPdf(asFile(SYNTHETIC, 'synthetic-notes.pdf'));
    const batches = planBatches(doc, detectTopics(doc));
    const rendered = batches.map(b => renderBatchForPrompt(doc, b)).join('\n');
    expect(rendered).toContain('[PAGE_INDEX=1 PRINTED_PAGE=i]');
    expect(rendered).toContain('[PAGE_INDEX=3 PRINTED_PAGE=1]');
    // Each page appears exactly once across all batches.
    const occurrences = (rendered.match(/PAGE_INDEX=/g) ?? []).length;
    expect(occurrences).toBe(4);
  });

  it('builds a citation that distinguishes PDF page 3 from printed page 1', async () => {
    const {doc} = await extractPdf(asFile(SYNTHETIC, 'synthetic-notes.pdf'));
    const page = doc.pages.find(p => p.pageIndex === 3)!;
    const citation = formatPageReference(makeCardSource(doc, page, 'Aortic Stenosis', false));
    expect(citation).toBe(
      'synthetic-notes.pdf — PDF page 3 (printed p. 1) — Aortic Stenosis',
    );
  });
});
