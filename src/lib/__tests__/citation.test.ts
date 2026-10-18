/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it} from 'vitest';

import type {SourceDocument} from '../../types';
import {
  formatPageReference,
  makeCardSource,
  pageImageKey,
  renderCitation,
  slugForMedia,
} from '../citation';

const pdfDoc: SourceDocument = {
  fileName: 'Passmedicine Cardiology.pdf',
  kind: 'pdf',
  pages: [
    {pageIndex: 1, printedPage: 'i', text: 'cover'},
    {pageIndex: 12, printedPage: '7', text: 'heart failure'},
  ],
  hasRealPages: true,
  hasPrintedPages: true,
  canRenderPages: true,
  warnings: [],
};

const docxDoc: SourceDocument = {
  fileName: 'notes.docx',
  kind: 'docx',
  pages: [{pageIndex: 1, text: 'section'}],
  hasRealPages: false,
  hasPrintedPages: false,
  canRenderPages: false,
  warnings: [],
};

describe('media keys', () => {
  it('produces a stable, sortable, ASCII key per page', () => {
    expect(pageImageKey('Passmedicine Cardiology.pdf', 12)).toBe(
      'passmedicine-cardiology-p0012.jpg',
    );
  });

  it('never returns an empty slug', () => {
    expect(slugForMedia('???.pdf')).toBe('source');
  });
});

describe('page index vs printed page', () => {
  it('reports both and keeps them distinct', () => {
    const source = makeCardSource(pdfDoc, pdfDoc.pages[1], 'Heart Failure', false);
    expect(source.pageIndex).toBe(12);
    expect(source.printedPage).toBe('7');
    expect(formatPageReference(source)).toBe(
      'Passmedicine Cardiology.pdf — PDF page 12 (printed p. 7) — Heart Failure',
    );
  });

  it('omits the printed page when it merely repeats the index', () => {
    const source = makeCardSource(
      pdfDoc,
      {pageIndex: 3, printedPage: '3', text: ''},
      undefined,
      false,
    );
    expect(formatPageReference(source)).toBe('Passmedicine Cardiology.pdf — PDF page 3');
  });

  it('invents no page number for a format without pages', () => {
    const source = makeCardSource(docxDoc, docxDoc.pages[0], 'Diabetes', false);
    expect(source.pageIndex).toBeUndefined();
    expect(source.printedPage).toBeUndefined();
    expect(formatPageReference(source)).toBe('notes.docx — Diabetes');
  });
});

describe('citation modes', () => {
  it('mode A keeps the readable reference and no image', () => {
    const source = makeCardSource(pdfDoc, pdfDoc.pages[1], 'Heart Failure', false);
    const rendered = renderCitation(source, 'page', true);
    expect(rendered.imageKey).toBeUndefined();
    expect(rendered.html).not.toContain('<img');
    expect(rendered.text).toContain('PDF page 12');
  });

  it('mode B references the packaged page image by filename', () => {
    const source = makeCardSource(pdfDoc, pdfDoc.pages[1], 'Heart Failure', true);
    const rendered = renderCitation(source, 'image', true);
    expect(rendered.imageKey).toBe('passmedicine-cardiology-p0012.jpg');
    expect(rendered.html).toContain('<img src="passmedicine-cardiology-p0012.jpg">');
    // The page reference survives in image mode too.
    expect(rendered.text).toContain('PDF page 12 (printed p. 7)');
  });

  it('both mode carries reference and image together', () => {
    const source = makeCardSource(pdfDoc, pdfDoc.pages[1], 'Heart Failure', true);
    const rendered = renderCitation(source, 'both', true);
    expect(rendered.text).toContain('PDF page 12');
    expect(rendered.html).toContain('<img');
    expect(rendered.limitation).toBeUndefined();
  });

  it('keeps the page reference and explains the limitation when no image exists', () => {
    const source = makeCardSource(pdfDoc, pdfDoc.pages[1], 'Heart Failure', true);
    const rendered = renderCitation(source, 'both', false);
    expect(rendered.imageKey).toBeUndefined();
    expect(rendered.html).not.toContain('<img');
    expect(rendered.text).toContain('PDF page 12');
    expect(rendered.limitation).toMatch(/page reference retained/);
  });

  it('explains that a page-less format cannot be rendered', () => {
    const source = makeCardSource(docxDoc, docxDoc.pages[0], 'Diabetes', true);
    const rendered = renderCitation(source, 'image', false);
    expect(rendered.limitation).toMatch(/no pages to render/);
    expect(rendered.text).toContain('notes.docx');
  });

  it('escapes HTML in the filename rather than emitting it', () => {
    const rendered = renderCitation({fileName: '<b>x</b>.pdf', pageIndex: 1}, 'page', false);
    expect(rendered.html).toContain('&lt;b&gt;x&lt;/b&gt;.pdf');
  });
});
