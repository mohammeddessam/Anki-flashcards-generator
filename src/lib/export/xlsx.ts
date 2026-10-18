/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Flashcard, PageImage} from '../../types';
import {stripHtml} from '../cloze';

/**
 * Excel export.
 *
 * The main worksheet has exactly four columns in this order:
 *   Front | Back | Citation | Tags
 * No extra columns are added to it. Quality-control output, when requested,
 * goes on a second worksheet instead.
 *
 * Page images, when available, are embedded next to their row as floating
 * images anchored to the Citation column. They are deduplicated per page, so a
 * workbook with 200 cards drawn from 12 pages embeds 12 images, not 200.
 */

export const REQUIRED_COLUMNS = ['Front', 'Back', 'Citation', 'Tags'] as const;

export interface XlsxOptions {
  cards: Flashcard[];
  /** Page images keyed by {@link PageImage.key}. */
  images?: Map<string, PageImage>;
  /** Embed images into the worksheet. Ignored when no images are supplied. */
  embedImages?: boolean;
  /** Add a second "Quality Control" worksheet. */
  includeQcSheet?: boolean;
  /** Notes to list on the QC sheet (limitations, failed batches). */
  qcNotes?: string[];
  /** Hard cap on embedded image bytes, to keep the workbook openable. */
  maxEmbeddedBytes?: number;
}

export interface XlsxResult {
  bytes: Uint8Array;
  embeddedImages: number;
  /** Reasons images were not embedded, if any. */
  notes: string[];
}

const DEFAULT_MAX_EMBEDDED_BYTES = 24 * 1024 * 1024;
const IMAGE_ROW_HEIGHT = 150;
const IMAGE_DISPLAY_WIDTH = 150;

export const buildWorkbook = async ({
  cards,
  images,
  embedImages = true,
  includeQcSheet = true,
  qcNotes = [],
  maxEmbeddedBytes = DEFAULT_MAX_EMBEDDED_BYTES,
}: XlsxOptions): Promise<XlsxResult> => {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AnKing Card Studio';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Flashcards');
  sheet.columns = [
    {header: 'Front', key: 'front', width: 70},
    {header: 'Back', key: 'back', width: 70},
    {header: 'Citation', key: 'citation', width: 46},
    {header: 'Tags', key: 'tags', width: 42},
  ];
  sheet.getRow(1).font = {bold: true};
  sheet.views = [{state: 'frozen', ySplit: 1}];

  const notes: string[] = [];
  let embeddedBytes = 0;
  let embeddedImages = 0;
  // One workbook image id per page, reused by every card citing that page.
  const imageIds = new Map<string, number>();

  cards.forEach((card, i) => {
    const row = sheet.addRow({
      front: card.text,
      back: card.extra,
      citation: card.citation ?? '',
      tags: card.tag,
    });
    row.alignment = {vertical: 'top', wrapText: true};

    const key = card.source?.imageKey;
    if (!embedImages || !key || !images?.has(key)) return;

    const image = images.get(key)!;
    let id = imageIds.get(key);
    if (id == null) {
      if (embeddedBytes + image.bytes.length > maxEmbeddedBytes) {
        if (!notes.some(n => n.startsWith('Image embedding stopped'))) {
          notes.push(
            `Image embedding stopped at ${(maxEmbeddedBytes / 1024 / 1024).toFixed(0)} MB to keep the workbook usable; remaining rows keep their page reference and the images stay in the export bundle.`,
          );
        }
        return;
      }
      id = workbook.addImage({
        // exceljs wants a Buffer-like value; a copied ArrayBuffer is accepted.
        buffer: image.bytes.slice().buffer as ArrayBuffer,
        extension: 'jpeg',
      });
      imageIds.set(key, id);
      embeddedBytes += image.bytes.length;
    }

    const rowNumber = i + 2;
    const aspect = image.height > 0 ? image.height / image.width : 1.4;
    sheet.getRow(rowNumber).height = IMAGE_ROW_HEIGHT;
    sheet.addImage(id, {
      // Columns and rows are zero-based in this anchor form; col 2 is Citation.
      tl: {col: 2.05, row: rowNumber - 0.95},
      ext: {width: IMAGE_DISPLAY_WIDTH, height: Math.round(IMAGE_DISPLAY_WIDTH * aspect)},
      editAs: 'oneCell',
    });
    embeddedImages += 1;
  });

  if (includeQcSheet) {
    addQcSheet(workbook, cards, qcNotes, notes);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {bytes: new Uint8Array(buffer as ArrayBuffer), embeddedImages, notes};
};

const addQcSheet = (
  workbook: import('exceljs').Workbook,
  cards: Flashcard[],
  qcNotes: string[],
  exportNotes: string[],
) => {
  const qc = workbook.addWorksheet('Quality Control');
  qc.columns = [
    {header: 'Card #', key: 'index', width: 9},
    {header: 'Cloze count', key: 'clozes', width: 13},
    {header: 'Front (plain text)', key: 'plain', width: 70},
    {header: 'Page image', key: 'image', width: 16},
    {header: 'Review flags', key: 'flags', width: 60},
  ];
  qc.getRow(1).font = {bold: true};

  cards.forEach((card, i) => {
    qc.addRow({
      index: i + 1,
      clozes: (card.text.match(/\{\{c\d+::/g) ?? []).length,
      plain: stripHtml(card.text),
      image: card.source?.imageKey ? 'yes' : 'no',
      flags: (card.review ?? []).join(' | '),
    }).alignment = {vertical: 'top', wrapText: true};
  });

  const allNotes = [...qcNotes, ...exportNotes];
  if (allNotes.length > 0) {
    qc.addRow({});
    qc.addRow({index: 'Notes'}).font = {bold: true};
    for (const note of allNotes) qc.addRow({plain: note});
  }
};
