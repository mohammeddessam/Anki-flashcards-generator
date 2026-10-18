/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CardSource, CitationMode, DocPage, SourceDocument} from '../types';

/**
 * Citation strings for the Excel `Citation` column and the Anki Citation field.
 *
 * Two facts are kept deliberately separate and are never substituted for one
 * another: `pageIndex` is the position of the page inside the file, and
 * `printedPage` is the number printed on the page itself (only known when the
 * document declares page labels). A document without page labels gets no
 * printed page number rather than a guessed one.
 */

export const pageImageKey = (fileName: string, pageIndex: number): string =>
  `${slugForMedia(fileName)}-p${String(pageIndex).padStart(4, '0')}.jpg`;

/** Media filenames must be stable, ASCII and collision-free inside the package. */
export const slugForMedia = (fileName: string): string =>
  fileName
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .toLowerCase() || 'source';

/** Builds the provenance record for a card, copying only values we actually have. */
export const makeCardSource = (
  doc: SourceDocument,
  page: DocPage | undefined,
  topic: string | undefined,
  withImage: boolean,
): CardSource => {
  const source: CardSource = {fileName: doc.fileName};
  if (page) {
    if (doc.hasRealPages) source.pageIndex = page.pageIndex;
    if (page.printedPage) source.printedPage = page.printedPage;
    if (withImage && doc.canRenderPages && doc.hasRealPages) {
      source.imageKey = pageImageKey(doc.fileName, page.pageIndex);
    }
  }
  if (topic) source.topic = topic;
  return source;
};

/** The readable page reference, with no image markup. Always present. */
export const formatPageReference = (source: CardSource): string => {
  const parts: string[] = [source.fileName];
  if (source.pageIndex != null) {
    const printed =
      source.printedPage && source.printedPage !== String(source.pageIndex)
        ? ` (printed p. ${source.printedPage})`
        : '';
    parts.push(`PDF page ${source.pageIndex}${printed}`);
  } else if (source.printedPage) {
    parts.push(`printed p. ${source.printedPage}`);
  }
  if (source.topic) parts.push(source.topic);
  return parts.join(' — ');
};

export interface CitationRender {
  /** Plain readable reference, written into the Excel `Citation` cell. */
  text: string;
  /** Media filename to embed/package, when one exists. */
  imageKey?: string;
  /** HTML for the Anki Citation field, including `<img>` when an image exists. */
  html: string;
  /** Set when an image was requested but cannot be produced. */
  limitation?: string;
}

/**
 * Renders a citation for the chosen mode. The page reference is retained in
 * every mode, including image mode, so a missing image never loses provenance.
 */
export const renderCitation = (
  source: CardSource,
  mode: CitationMode,
  imageAvailable: boolean,
): CitationRender => {
  const text = formatPageReference(source);
  const wantsImage = mode === 'image' || mode === 'both';
  const haveImage = wantsImage && imageAvailable && !!source.imageKey;

  const escaped = escapeHtml(text);
  if (!haveImage) {
    const limitation = wantsImage
      ? source.pageIndex == null
        ? 'This source format has no pages to render; page reference retained.'
        : 'Source page image unavailable; page reference retained.'
      : undefined;
    return {
      text: wantsImage ? `${text}${limitation ? ' [no page image]' : ''}` : text,
      html: `<div class="citation">${escaped}</div>`,
      limitation,
    };
  }

  return {
    text: `${text} [${source.imageKey}]`,
    imageKey: source.imageKey,
    html:
      `<div class="citation">${escaped}</div>` +
      `<div class="citation-image"><img src="${source.imageKey}"></div>`,
  };
};

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
