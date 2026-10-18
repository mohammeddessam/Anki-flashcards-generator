/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DocPage, PageImage, SourceDocument} from '../../types';
import {pageImageKey} from '../citation';

/**
 * PDF extraction built on pdf.js.
 *
 * Two page numbers are collected and kept apart:
 *  - `pageIndex`: 1-based position inside the file.
 *  - `printedPage`: the page's own label from the PDF's `/PageLabels` tree,
 *    which is the only non-guessed source of a printed page number. Documents
 *    without page labels simply get none.
 */

type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** Loads pdf.js once and points it at the bundled worker. */
export const loadPdfjs = (): Promise<PdfjsModule> => {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      // The worker only exists in a browser; in Node (tests) pdf.js falls back
      // to running on the main thread, which is enough for text extraction.
      if (typeof window !== 'undefined') {
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      }
      return pdfjs;
    })();
  }
  return pdfjsPromise;
};

/**
 * Page labels are only meaningful when the document actually declares them.
 * pdf.js returns a plain 1..n sequence for documents without a label tree, so
 * that case is detected and discarded rather than reported as a printed number.
 */
export const usefulPageLabels = (labels: string[] | null): string[] | null => {
  if (!labels || labels.length === 0) return null;
  const isDefaultSequence = labels.every((label, i) => label === String(i + 1));
  return isDefaultSequence ? null : labels;
};

/** Joins pdf.js text items into lines, so headings survive extraction. */
const itemsToText = (items: Array<{str: string; hasEOL?: boolean}>): string => {
  let out = '';
  for (const item of items) {
    out += item.str;
    if (item.hasEOL) out += '\n';
    else if (item.str && !item.str.endsWith(' ')) out += ' ';
  }
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export interface PdfExtraction {
  doc: SourceDocument;
  /** Kept so page images can be rendered later without re-parsing. */
  handle: PdfDocumentHandle;
}

export interface PdfDocumentHandle {
  numPages: number;
  renderPage(pageIndex: number, opts?: RenderOptions): Promise<PageImage>;
  destroy(): Promise<void>;
}

export interface RenderOptions {
  /** Longest edge of the rendered image in pixels. */
  maxEdge?: number;
  /** JPEG quality, 0..1. */
  quality?: number;
}

export const extractPdf = async (
  file: {name: string; arrayBuffer(): Promise<ArrayBuffer>},
): Promise<PdfExtraction> => {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    // Served by the `pdfjs-assets` Vite plugin; only reachable in the browser.
    ...(typeof window !== 'undefined'
      ? {
          standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
          cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
          cMapPacked: true,
        }
      : {}),
  }).promise;

  const labels = usefulPageLabels(await pdf.getPageLabels());
  const pages: DocPage[] = [];
  let emptyPages = 0;

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = itemsToText(content.items as Array<{str: string; hasEOL?: boolean}>);
    if (text.length === 0) emptyPages += 1;
    pages.push({
      pageIndex: i,
      printedPage: labels?.[i - 1],
      text,
    });
    page.cleanup();
  }

  const warnings: string[] = [];
  if (emptyPages === pages.length && pages.length > 0) {
    warnings.push(
      'No text layer found in this PDF. It is probably a scan; run OCR on it first, otherwise no cards can be generated.',
    );
  } else if (emptyPages > 0) {
    warnings.push(`${emptyPages} of ${pages.length} pages have no extractable text.`);
  }
  if (!labels) {
    warnings.push(
      'This PDF declares no printed page numbers; citations will reference PDF page indexes only.',
    );
  }

  const imageCache = new Map<number, PageImage>();

  const handle: PdfDocumentHandle = {
    numPages: pdf.numPages,
    async renderPage(pageIndex, opts = {}) {
      const cached = imageCache.get(pageIndex);
      if (cached) return cached;
      const image = await renderPageToJpeg(pdf, file.name, pageIndex, opts);
      imageCache.set(pageIndex, image);
      return image;
    },
    async destroy() {
      imageCache.clear();
      await pdf.destroy();
    },
  };

  return {
    doc: {
      fileName: file.name,
      kind: 'pdf',
      pages,
      hasRealPages: true,
      hasPrintedPages: !!labels,
      canRenderPages: typeof document !== 'undefined',
      warnings,
    },
    handle,
  };
};

/** Renders one page to a size-capped JPEG. Requires a DOM canvas. */
const renderPageToJpeg = async (
  pdf: Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>,
  fileName: string,
  pageIndex: number,
  {maxEdge = 1400, quality = 0.72}: RenderOptions,
): Promise<PageImage> => {
  if (typeof document === 'undefined') {
    throw new Error('Page images can only be rendered in a browser.');
  }
  const page = await pdf.getPage(pageIndex);
  const base = page.getViewport({scale: 1});
  const scale = Math.min(maxEdge / Math.max(base.width, base.height), 2);
  const viewport = page.getViewport({scale: Math.max(scale, 0.2)});

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context for page rendering.');
  // PDF pages are transparent; without this the JPEG background turns black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // `intent: 'print'` makes pdf.js continue rendering on microtasks instead of
  // requestAnimationFrame. rAF is throttled to a standstill in a background or
  // non-composited tab, which otherwise leaves this promise pending forever.
  await page.render({canvasContext: ctx, viewport, intent: 'print'}).promise;
  page.cleanup();

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!blob) throw new Error('Could not encode the rendered page as JPEG.');
  const bytes = new Uint8Array(await blob.arrayBuffer());

  return {
    key: pageImageKey(fileName, pageIndex),
    pageIndex,
    bytes,
    width: canvas.width,
    height: canvas.height,
  };
};
