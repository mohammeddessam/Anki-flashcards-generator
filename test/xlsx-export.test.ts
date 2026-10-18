/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import ExcelJS from 'exceljs';
import {unzipSync} from 'fflate';
import {describe, expect, it} from 'vitest';

import type {Flashcard, PageImage} from '../src/types';
import {REQUIRED_COLUMNS, buildWorkbook} from '../src/lib/export/xlsx';
import {buildBundle, toAnkiTextImport, toTsv} from '../src/lib/export/bundle';

/**
 * Bytes that begin with the JPEG SOI + APP0 markers. These tests verify
 * packaging and worksheet structure; they do not decode the image.
 */
const fakeJpeg = (size = 256): PageImage['bytes'] => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.set([0xff, 0xd9], size - 2);
  return bytes;
};

const image = (key: string, pageIndex: number, size = 256): PageImage => ({
  key,
  pageIndex,
  bytes: fakeJpeg(size),
  width: 800,
  height: 1130,
});

const card = (over: Partial<Flashcard> = {}): Flashcard => ({
  text: '<b>Heart failure</b> is treated first-line with {{c1::<u>ACE inhibitors</u>}}.',
  extra: '<i>Mechanism:</i> ↓ afterload → ↑ stroke volume.',
  tag: 'MRCP::Passmedicine_notes::Cardiology::Heart_Failure',
  citation: 'notes.pdf — PDF page 3 (printed p. 1) — Heart Failure [notes-p0003.jpg]',
  source: {fileName: 'notes.pdf', pageIndex: 3, printedPage: '1', imageKey: 'notes-p0003.jpg'},
  ...over,
});

const readBack = async (bytes: Uint8Array) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.slice().buffer as ArrayBuffer);
  return wb;
};

describe('Excel schema', () => {
  it('has exactly the four required columns in the required order', async () => {
    const {bytes} = await buildWorkbook({cards: [card()], includeQcSheet: false});
    const sheet = (await readBack(bytes)).getWorksheet('Flashcards')!;
    const header = sheet.getRow(1).values as unknown[];
    // Row values are 1-indexed in exceljs, so index 0 is empty.
    expect(header.slice(1, 5)).toEqual([...REQUIRED_COLUMNS]);
    expect(header.slice(5).filter(Boolean)).toEqual([]);
    expect(sheet.columnCount).toBe(4);
  });

  it('writes Front, Back, Citation and Tags into the matching columns', async () => {
    const {bytes} = await buildWorkbook({cards: [card()], includeQcSheet: false});
    const sheet = (await readBack(bytes)).getWorksheet('Flashcards')!;
    const row = sheet.getRow(2);
    expect(String(row.getCell(1).value)).toContain('{{c1::<u>ACE inhibitors</u>}}');
    expect(String(row.getCell(2).value)).toContain('Mechanism');
    expect(String(row.getCell(3).value)).toContain('PDF page 3 (printed p. 1)');
    expect(String(row.getCell(4).value)).toBe(
      'MRCP::Passmedicine_notes::Cardiology::Heart_Failure',
    );
  });

  it('keeps cloze syntax and HTML as literal editable text, not formulas', async () => {
    const {bytes} = await buildWorkbook({cards: [card()], includeQcSheet: false});
    const cell = (await readBack(bytes)).getWorksheet('Flashcards')!.getCell('A2');
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe(card().text);
  });

  it('puts quality-control output on a separate worksheet, never extra columns', async () => {
    const {bytes} = await buildWorkbook({
      cards: [card({review: ['Verify threshold']})],
      includeQcSheet: true,
      qcNotes: ['1 batch failed.'],
    });
    const wb = await readBack(bytes);
    expect(wb.worksheets.map(w => w.name)).toEqual(['Flashcards', 'Quality Control']);
    expect(wb.getWorksheet('Flashcards')!.columnCount).toBe(4);
    const qc = wb.getWorksheet('Quality Control')!;
    expect(String(qc.getRow(2).getCell(5).value)).toContain('Verify threshold');
  });
});

describe('Excel image embedding', () => {
  it('embeds the page image and anchors it to the citation column', async () => {
    const images = new Map([['notes-p0003.jpg', image('notes-p0003.jpg', 3)]]);
    const result = await buildWorkbook({cards: [card()], images, includeQcSheet: false});
    expect(result.embeddedImages).toBe(1);

    const wb = await readBack(result.bytes);
    expect(wb.model.media).toHaveLength(1);
    expect(wb.model.media[0].extension).toBe('jpeg');
    const anchored = wb.getWorksheet('Flashcards')!.getImages();
    expect(anchored).toHaveLength(1);
    expect(anchored[0].range.tl.nativeCol).toBe(2);
  });

  it('embeds one copy per page, not one per card', async () => {
    const images = new Map([['notes-p0003.jpg', image('notes-p0003.jpg', 3)]]);
    const result = await buildWorkbook({
      cards: [card(), card({text: '<b>HF</b> also responds to {{c1::beta blockers}}.'})],
      images,
      includeQcSheet: false,
    });
    expect(result.embeddedImages).toBe(2);
    const wb = await readBack(result.bytes);
    // Two anchors referencing a single stored image.
    expect(wb.getWorksheet('Flashcards')!.getImages()).toHaveLength(2);
    expect(wb.model.media).toHaveLength(1);
  });

  it('stops embedding at the size cap and says so, keeping the page reference', async () => {
    const images = new Map([
      ['a.jpg', image('a.jpg', 1, 4096)],
      ['b.jpg', image('b.jpg', 2, 4096)],
    ]);
    const result = await buildWorkbook({
      cards: [
        card({source: {fileName: 'n.pdf', pageIndex: 1, imageKey: 'a.jpg'}}),
        card({
          text: '<b>HF</b> worsens with {{c1::NSAIDs}}.',
          source: {fileName: 'n.pdf', pageIndex: 2, imageKey: 'b.jpg'},
        }),
      ],
      images,
      includeQcSheet: false,
      maxEmbeddedBytes: 5000,
    });
    expect(result.embeddedImages).toBe(1);
    expect(result.notes.join(' ')).toMatch(/Image embedding stopped/);
    const sheet = (await readBack(result.bytes)).getWorksheet('Flashcards')!;
    // The unembedded row still carries its readable citation.
    expect(String(sheet.getRow(3).getCell(3).value)).toContain('PDF page 3');
  });

  it('writes a usable workbook when no image is available at all', async () => {
    const result = await buildWorkbook({
      cards: [card({source: {fileName: 'n.docx'}, citation: 'n.docx — Heart Failure'})],
      images: new Map(),
      includeQcSheet: false,
    });
    expect(result.embeddedImages).toBe(0);
    const sheet = (await readBack(result.bytes)).getWorksheet('Flashcards')!;
    expect(String(sheet.getRow(2).getCell(3).value)).toBe('n.docx — Heart Failure');
  });
});

describe('flat text exports', () => {
  it('emits the four columns in order, tab separated', () => {
    const [front, back, citation, tags] = toTsv([card()]).split('\t');
    expect(front).toContain('{{c1::');
    expect(back).toContain('Mechanism');
    expect(citation).toContain('PDF page 3');
    expect(tags).toBe('MRCP::Passmedicine_notes::Cardiology::Heart_Failure');
  });

  it('never lets a field break the row with a tab or newline', () => {
    const tsv = toTsv([card({extra: 'line one\nline two\twith tab'})]);
    expect(tsv.split('\n')).toHaveLength(1);
    expect(tsv.split('\t')).toHaveLength(4);
  });

  it('declares html and the tags column for Anki text import', () => {
    const text = toAnkiTextImport([card()], 'Medicine::MRCP');
    expect(text).toContain('#separator:tab');
    expect(text).toContain('#html:true');
    expect(text).toContain('#tags column:4');
    expect(text).toContain('#deck:Medicine::MRCP');
  });
});

describe('export bundle', () => {
  it('ships the workbook, the deck, the TSV and only the cited page images', async () => {
    const images = new Map([
      ['notes-p0003.jpg', image('notes-p0003.jpg', 3)],
      ['notes-p0099.jpg', image('notes-p0099.jpg', 99)],
    ]);
    const zip = await buildBundle({
      cards: [card()],
      workbook: new Uint8Array([1, 2, 3]),
      apkg: new Uint8Array([4, 5, 6]),
      images,
    });
    const entries = Object.keys(unzipSync(zip)).sort();
    expect(entries).toEqual([
      'README.txt',
      'cards.tsv',
      'flashcards.apkg',
      'flashcards.xlsx',
      // fflate writes an entry for the folder itself as well as its contents.
      'source-pages/',
      'source-pages/notes-p0003.jpg',
    ]);
  });

  it('warns in the README that Excel images do not reach Anki', async () => {
    const zip = await buildBundle({cards: [card()]});
    const readme = new TextDecoder().decode(unzipSync(zip)['README.txt']);
    expect(readme).toMatch(/do NOT transfer into Anki/);
  });
});
