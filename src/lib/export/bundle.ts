/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Flashcard, PageImage} from '../../types';
import {REQUIRED_COLUMNS} from './xlsx';

/**
 * The flat text exports (TSV/CSV), plus the zip bundle that ships the workbook
 * together with the page image files for the cases where embedding them in the
 * worksheet is not enough (Excel images do not transfer into Anki).
 */

/**
 * Tab-separated rows in the required column order.
 * Tabs and newlines inside fields would break the row, so they are replaced;
 * HTML and cloze markers are left untouched.
 */
export const toTsv = (cards: Flashcard[], includeHeader = false): string => {
  const cell = (value: string) =>
    (value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
  const rows = cards.map(c =>
    [cell(c.text), cell(c.extra), cell(c.citation ?? ''), cell(c.tag)].join('\t'),
  );
  return includeHeader ? [REQUIRED_COLUMNS.join('\t'), ...rows].join('\n') : rows.join('\n');
};

/** Anki's own text-import format, with the header lines that configure the import. */
export const toAnkiTextImport = (cards: Flashcard[], deckName: string): string => {
  const header = [
    '#separator:tab',
    '#html:true',
    `#deck:${deckName}`,
    '#notetype:Cloze',
    '#tags column:4',
    '',
  ].join('\n');
  return header + toTsv(cards);
};

export interface BundleOptions {
  workbook?: Uint8Array;
  workbookName?: string;
  apkg?: Uint8Array;
  apkgName?: string;
  images?: Map<string, PageImage>;
  cards: Flashcard[];
  /** README contents describing what is in the bundle. */
  readme?: string;
}

/**
 * Zips the workbook, the deck and the referenced page images into one download.
 * Only images actually cited by a card are included.
 */
export const buildBundle = async ({
  workbook,
  workbookName = 'flashcards.xlsx',
  apkg,
  apkgName = 'flashcards.apkg',
  images,
  cards,
  readme,
}: BundleOptions): Promise<Uint8Array> => {
  const {zipSync} = await import('fflate');
  const encoder = new TextEncoder();
  const entries: Record<string, Uint8Array | Record<string, Uint8Array>> = {};

  if (workbook) entries[workbookName] = workbook;
  if (apkg) entries[apkgName] = apkg;
  entries['cards.tsv'] = encoder.encode(toTsv(cards, true));

  if (images) {
    const used = new Set(
      cards.map(c => c.source?.imageKey).filter((k): k is string => !!k),
    );
    const folder: Record<string, Uint8Array> = {};
    for (const key of used) {
      const image = images.get(key);
      if (image) folder[key] = image.bytes;
    }
    if (Object.keys(folder).length > 0) entries['source-pages'] = folder;
  }

  entries['README.txt'] = encoder.encode(readme ?? defaultReadme(cards.length));
  return zipSync(entries as never, {level: 6});
};

const defaultReadme = (cardCount: number) => `AnKing Card Studio export
${cardCount} card(s).

Contents
  flashcards.xlsx  Workbook with exactly four columns: ${REQUIRED_COLUMNS.join(' | ')}.
                   Page images, where available, are embedded beside the Citation column.
  flashcards.apkg  Anki deck. Import with File > Import in Anki. Page images are
                   packaged inside the deck, so it does not need the original document.
  cards.tsv        The same four columns as tab-separated text.
  source-pages/    The page images referenced by the Citation column.

Note: images embedded in an Excel worksheet do NOT transfer into Anki. Use the
.apkg file if you want the page images on your cards.
`;
