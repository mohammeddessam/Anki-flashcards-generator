/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import {unzipSync} from 'fflate';
import initSqlJs, {type Database} from 'sql.js';
import {beforeAll, describe, expect, it} from 'vitest';

import type {Flashcard, PageImage} from '../src/types';
import {
  FIELD_NAMES,
  NOTE_TYPE_NAME,
  buildApkg,
  citationFieldHtml,
  clozeOrdinals,
  fieldChecksum,
  noteGuid,
} from '../src/lib/export/apkg';

/**
 * Validates the generated `.apkg` by inspecting its internals: the zip entries,
 * the `media` manifest, and the SQLite collection it contains (opened here with
 * the same sql.js build the app uses).
 *
 * This proves the package is structurally a valid Anki collection with the
 * expected notes, cards, tags and media. It does not prove Anki's own importer
 * accepts it; no Anki installation is available in this environment.
 */

/** sql.js needs a filesystem path to its wasm when running under Node. */
const locateFile = (file: string) =>
  path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file);

const fakeJpeg = (size = 128) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.set([0xff, 0xd9], size - 2);
  return bytes;
};

const image = (key: string, pageIndex: number): PageImage => ({
  key,
  pageIndex,
  bytes: fakeJpeg(),
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

interface OpenedPackage {
  entries: Record<string, Uint8Array>;
  db: Database;
  col: Record<string, string>;
}

const open = async (bytes: Uint8Array): Promise<OpenedPackage> => {
  const entries = unzipSync(bytes);
  const SQL = await initSqlJs({locateFile});
  const db = new SQL.Database(entries['collection.anki2']);
  const result = db.exec('SELECT conf, models, decks, dconf, ver FROM col')[0];
  const col = Object.fromEntries(
    result.columns.map((name, i) => [name, String(result.values[0][i])]),
  );
  return {entries, db, col};
};

const rows = (db: Database, sql: string): unknown[][] => {
  const result = db.exec(sql);
  return result.length === 0 ? [] : result[0].values;
};

describe('apkg helpers', () => {
  it('derives one card ordinal per distinct cloze number, zero-based', () => {
    expect(clozeOrdinals('{{c1::a}} {{c2::b}}')).toEqual([0, 1]);
    expect(clozeOrdinals('{{c1::a}} {{c1::b}}')).toEqual([0]);
    expect(clozeOrdinals('{{c3::a}}')).toEqual([2]);
  });

  it('falls back to a single card rather than dropping a cloze-less note', () => {
    expect(clozeOrdinals('no cloze here')).toEqual([0]);
  });

  it('computes a 32-bit checksum from the stripped sort field', async () => {
    const withHtml = await fieldChecksum('<b>Heart failure</b>');
    const plain = await fieldChecksum('Heart failure');
    expect(withHtml).toBe(plain);
    expect(withHtml).toBeGreaterThan(0);
    expect(withHtml).toBeLessThanOrEqual(0xffffffff);
  });

  it('produces a stable guid for identical content and a different one otherwise', () => {
    expect(noteGuid('a|b')).toBe(noteGuid('a|b'));
    expect(noteGuid('a|b')).not.toBe(noteGuid('a|c'));
    expect(noteGuid('a|b')).toHaveLength(10);
  });

  it('omits the img tag when the image was not packaged', () => {
    expect(citationFieldHtml(card(), false)).not.toContain('<img');
    expect(citationFieldHtml(card(), true)).toContain('<img src="notes-p0003.jpg">');
  });

  it('drops the bracketed filename from the readable reference', () => {
    expect(citationFieldHtml(card(), false)).not.toContain('[notes-p0003.jpg]');
    expect(citationFieldHtml(card(), false)).toContain('PDF page 3 (printed p. 1)');
  });
});

describe('apkg package structure', () => {
  let pkg: OpenedPackage;
  let result: Awaited<ReturnType<typeof buildApkg>>;

  beforeAll(async () => {
    result = await buildApkg({
      cards: [
        card(),
        card({
          text: '<b>Aortic stenosis</b> murmur radiates to the {{c1::carotids}} and causes {{c2::syncope}}.',
          tag: 'MRCP::Passmedicine_notes::Cardiology::Aortic_Stenosis',
          citation: 'notes.pdf — PDF page 9 — Aortic Stenosis [notes-p0009.jpg]',
          source: {fileName: 'notes.pdf', pageIndex: 9, imageKey: 'notes-p0009.jpg'},
        }),
      ],
      deckName: 'Medicine::MRCP Part 1',
      images: new Map([
        ['notes-p0003.jpg', image('notes-p0003.jpg', 3)],
        ['notes-p0009.jpg', image('notes-p0009.jpg', 9)],
      ]),
      locateFile,
    });
    pkg = await open(result.bytes);
  });

  it('contains the collection, the media manifest and the media files', () => {
    const names = Object.keys(pkg.entries).sort();
    expect(names).toEqual(['0', '1', 'collection.anki2', 'media']);
  });

  it('maps numeric zip entries to real filenames in the media manifest', () => {
    const manifest = JSON.parse(new TextDecoder().decode(pkg.entries['media']));
    expect(Object.values(manifest).sort()).toEqual(['notes-p0003.jpg', 'notes-p0009.jpg']);
    // Each manifest key must be an entry that actually exists in the zip.
    for (const key of Object.keys(manifest)) expect(pkg.entries[key]).toBeDefined();
    expect(result.mediaCount).toBe(2);
  });

  it('declares schema version 11 and the expected tables', () => {
    expect(pkg.col.ver).toBe('11');
    const tables = rows(pkg.db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map(r => String(r[0]));
    expect(tables).toEqual(['cards', 'col', 'graves', 'notes', 'revlog']);
  });

  it('registers a cloze note type with the Text, Extra and Citation fields', () => {
    const models = Object.values(JSON.parse(pkg.col.models)) as Array<Record<string, unknown>>;
    expect(models).toHaveLength(1);
    const model = models[0];
    expect(model.name).toBe(NOTE_TYPE_NAME);
    expect(model.type).toBe(1); // 1 = cloze
    expect((model.flds as Array<{name: string}>).map(f => f.name)).toEqual([...FIELD_NAMES]);
    const tmpl = (model.tmpls as Array<{qfmt: string; afmt: string}>)[0];
    expect(tmpl.qfmt).toContain('{{cloze:Text}}');
    expect(tmpl.afmt).toContain('{{Extra}}');
    expect(tmpl.afmt).toContain('{{Citation}}');
  });

  it('creates the named deck, so `::` nests it under a parent', () => {
    const names = Object.values(JSON.parse(pkg.col.decks)).map(
      d => (d as {name: string}).name,
    );
    expect(names).toContain('Medicine::MRCP Part 1');
  });

  it('writes one note per card with the three fields separated by 0x1f', () => {
    const notes = rows(pkg.db, 'SELECT flds, tags, sfld FROM notes ORDER BY id');
    expect(notes).toHaveLength(2);
    const fields = String(notes[0][0]).split('\u001f');
    expect(fields).toHaveLength(3);
    expect(fields[0]).toContain('{{c1::<u>ACE inhibitors</u>}}');
    expect(fields[1]).toContain('Mechanism');
    expect(fields[2]).toContain('PDF page 3');
    // The sort field is the plain text of the front.
    expect(String(notes[0][2])).toContain('Heart failure');
    expect(String(notes[0][2])).not.toContain('<b>');
  });

  it('stores the hierarchical tag space-padded, as Anki expects', () => {
    const tags = rows(pkg.db, 'SELECT tags FROM notes ORDER BY id').map(r => String(r[0]));
    expect(tags[0]).toBe(' MRCP::Passmedicine_notes::Cardiology::Heart_Failure ');
    expect(tags[1]).toBe(' MRCP::Passmedicine_notes::Cardiology::Aortic_Stenosis ');
  });

  it('generates one card row per cloze ordinal, all in the new-card queue', () => {
    const cards = rows(pkg.db, 'SELECT nid, ord, type, queue FROM cards ORDER BY id');
    // Note 1 has one cloze, note 2 has two.
    expect(cards).toHaveLength(3);
    expect(result.cardCount).toBe(3);
    expect(cards.map(c => Number(c[1]))).toEqual([0, 0, 1]);
    expect(cards.every(c => Number(c[2]) === 0 && Number(c[3]) === 0)).toBe(true);
  });

  it('points every card at a note that exists and at the new deck', () => {
    const orphans = rows(
      pkg.db,
      'SELECT count(*) FROM cards WHERE nid NOT IN (SELECT id FROM notes)',
    );
    expect(Number(orphans[0][0])).toBe(0);
    const deckIds = new Set(
      rows(pkg.db, 'SELECT DISTINCT did FROM cards').map(r => String(r[0])),
    );
    expect(deckIds.size).toBe(1);
    expect(Object.keys(JSON.parse(pkg.col.decks))).toContain([...deckIds][0]);
  });

  it('references media by plain filename, resolvable after import', () => {
    const citationFields = rows(pkg.db, 'SELECT flds FROM notes ORDER BY id').map(
      r => String(r[0]).split('\u001f')[2],
    );
    expect(citationFields[0]).toContain('<img src="notes-p0003.jpg">');
    expect(citationFields[1]).toContain('<img src="notes-p0009.jpg">');
    const manifest: Record<string, string> = JSON.parse(
      new TextDecoder().decode(pkg.entries['media']),
    );
    // Every filename referenced by a note is present in the package.
    for (const file of Object.values(manifest)) {
      expect(citationFields.join(' ')).toContain(file);
    }
  });

  it('gives every note a distinct id and guid', () => {
    const ids = rows(pkg.db, 'SELECT id, guid FROM notes');
    expect(new Set(ids.map(r => String(r[0]))).size).toBe(ids.length);
    expect(new Set(ids.map(r => String(r[1]))).size).toBe(ids.length);
  });
});

describe('apkg without media', () => {
  it('omits media entries and notes the limitation when images are unavailable', async () => {
    const result = await buildApkg({
      cards: [card()],
      deckName: 'Medicine',
      images: new Map(),
      locateFile,
    });
    const entries = Object.keys(unzipSync(result.bytes)).sort();
    expect(entries).toEqual(['collection.anki2', 'media']);
    expect(result.mediaCount).toBe(0);
    expect(result.notes.join(' ')).toMatch(/page reference only/);

    const pkg = await open(result.bytes);
    const citation = String(rows(pkg.db, 'SELECT flds FROM notes')[0][0]).split('\u001f')[2];
    expect(citation).not.toContain('<img');
    expect(citation).toContain('PDF page 3');
  });

  it('skips media when the user turned it off, keeping the citation text', async () => {
    const result = await buildApkg({
      cards: [card()],
      deckName: 'Medicine',
      images: new Map([['notes-p0003.jpg', image('notes-p0003.jpg', 3)]]),
      includeMedia: false,
      locateFile,
    });
    expect(result.mediaCount).toBe(0);
    expect(Object.keys(unzipSync(result.bytes)).sort()).toEqual(['collection.anki2', 'media']);
  });

  it('refuses to build an empty deck', async () => {
    await expect(buildApkg({cards: [], deckName: 'Medicine', locateFile})).rejects.toThrow(
      /no cards/i,
    );
  });
});
