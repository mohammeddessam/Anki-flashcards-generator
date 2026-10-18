/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// --- Cards ---

/**
 * A generated flashcard.
 *
 * `text` / `extra` / `tag` are the original field names used by the app since
 * the first version and are kept as-is so existing logic keeps working. They
 * map to the exported Excel columns as:
 *   text  -> Front
 *   extra -> Back
 *   tag   -> Tags
 * `citation` is the new third column.
 */
export interface Flashcard {
  text: string;
  extra: string;
  tag: string;
  /** Human readable source reference, e.g. `notes.pdf — p. 12 (printed 7) — Heart Failure`. */
  citation?: string;
  /** Provenance of the source passage this card was generated from. */
  source?: CardSource;
  /** Quality-control notes raised by the validator or the model. */
  review?: string[];
}

/** Where a card came from. Never synthesised: always copied from the extracted document. */
export interface CardSource {
  /** Original uploaded filename, or `Pasted text` for textarea input. */
  fileName: string;
  /** 1-based index of the page inside the file, if the format has pages. */
  pageIndex?: number;
  /**
   * Page number as printed on the page (from the PDF's own page labels).
   * Deliberately distinct from `pageIndex`; absent when the document does not
   * declare page labels.
   */
  printedPage?: string;
  /** Detected topic / section title. */
  topic?: string;
  /** Key of the packaged page image, if one was rendered. */
  imageKey?: string;
}

// --- Documents ---

export type SourceKind = 'pdf' | 'docx' | 'text' | 'pasted';

export interface DocPage {
  /** 1-based position of this page in the document. */
  pageIndex: number;
  /** Page number as printed on the page, when the document declares one. */
  printedPage?: string;
  text: string;
  /** Heading detected at the top of this page, used to seed topic detection. */
  heading?: string;
}

export interface PageImage {
  /** Stable key used in exports and as the Anki media filename. */
  key: string;
  pageIndex: number;
  /** JPEG bytes. */
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface SourceDocument {
  fileName: string;
  kind: SourceKind;
  pages: DocPage[];
  /** True when `pages` reflect real pages of the source rather than synthetic chunks. */
  hasRealPages: boolean;
  /** True when the document declares its own printed page numbers. */
  hasPrintedPages: boolean;
  /** Set when page images can be rendered on demand (PDF only). */
  canRenderPages: boolean;
  /** Warnings worth showing the user (e.g. scanned PDF with no text layer). */
  warnings: string[];
}

export interface Topic {
  id: string;
  title: string;
  /** Inclusive range of `DocPage.pageIndex` covered by this topic. */
  startPage: number;
  endPage: number;
  /** Nesting level, 0 for top-level sections. */
  level: number;
  /** Characters of text in the topic, used to size batches. */
  charCount: number;
}

// --- Settings ---

export type CardDensity = 'high_yield' | 'balanced' | 'comprehensive';
export type ExplanationDepth = 'brief' | 'standard' | 'deep';
export type CitationMode = 'page' | 'image' | 'both';
export type GenerationMode = 'default' | 'one_question_max_3';

export interface GenerationSettings {
  density: CardDensity;
  depth: ExplanationDepth;
  citationMode: CitationMode;
  mode: GenerationMode;
  /** Tag prefix, e.g. `MRCP::Passmedicine_notes`. */
  tagPrefix: string;
  subject: string;
  topic: string;
  firstLineAsTopic: boolean;
}
