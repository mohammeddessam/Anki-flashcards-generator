/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DocPage, SourceDocument} from '../../types';
import {extractPdf, type PdfDocumentHandle} from './pdf';

/**
 * Entry point for turning an uploaded file into a {@link SourceDocument}.
 *
 * Formats without pages (DOCX, TXT, MD, pasted text) are split into synthetic
 * chunks so batching and topic detection still work, but they are flagged with
 * `hasRealPages: false` so citations never claim a PDF-style page number the
 * source does not have.
 */

export interface ExtractResult {
  doc: SourceDocument;
  /** Present only for PDFs, which are the only format we can render images of. */
  pdf?: PdfDocumentHandle;
}

/** Characters per synthetic chunk for page-less formats. */
const CHUNK_CHARS = 3000;

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.htm', '.html'];

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
};

export const extractFile = async (file: File): Promise<ExtractResult> => {
  const ext = extensionOf(file.name);

  if (ext === '.pdf') {
    const {doc, handle} = await extractPdf(file);
    return {doc, pdf: handle};
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth/mammoth.browser');
    const {value: html, messages} = await mammoth.convertToHtml({
      arrayBuffer: await file.arrayBuffer(),
    });
    const warnings = messages
      .filter(m => m.type === 'warning')
      .slice(0, 3)
      .map(m => m.message);
    warnings.push(
      'DOCX files carry no page boundaries, so citations reference the detected section instead of a page number.',
    );
    return {doc: fromHtml(file.name, 'docx', html, warnings)};
  }

  if (ext === '.htm' || ext === '.html') {
    const html = await file.text();
    return {
      doc: fromHtml(file.name, 'text', html, [
        'HTML files carry no page boundaries, so citations reference the detected section.',
      ]),
    };
  }

  if (ext === '.txt' || ext === '.md' || ext === '.markdown' || ext === '') {
    return {
      doc: fromPlainText(file.name, 'text', await file.text(), [
        'Plain text files carry no page boundaries, so citations reference the detected section.',
      ]),
    };
  }

  throw new Error(
    `Unsupported file type "${ext || file.name}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`,
  );
};

/** Wraps text typed into the existing textarea so it flows through the same pipeline. */
export const documentFromPastedText = (text: string): SourceDocument =>
  fromPlainText('Pasted text', 'pasted', text, []);

export const htmlToText = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    // Keep heading markers so section detection can still see them.
    .replace(/<h([1-6])[^>]*>/gi, (_m, level) => `\n\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|tr|li|ul|ol|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const fromHtml = (
  fileName: string,
  kind: SourceDocument['kind'],
  html: string,
  warnings: string[],
): SourceDocument => fromPlainText(fileName, kind, htmlToText(html), warnings);

/**
 * Splits text into synthetic chunks on blank lines, never mid-paragraph, so a
 * fact is not cut in half across two "pages".
 */
export const chunkText = (text: string, chunkChars = CHUNK_CHARS): string[] => {
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const block of blocks) {
    if (current && current.length + block.length + 2 > chunkChars) {
      chunks.push(current);
      current = block;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
};

export const fromPlainText = (
  fileName: string,
  kind: SourceDocument['kind'],
  text: string,
  warnings: string[],
): SourceDocument => {
  const pages: DocPage[] = chunkText(text).map((chunk, i) => ({
    pageIndex: i + 1,
    text: chunk,
  }));
  return {
    fileName,
    kind,
    pages,
    hasRealPages: false,
    hasPrintedPages: false,
    canRenderPages: false,
    warnings,
  };
};
