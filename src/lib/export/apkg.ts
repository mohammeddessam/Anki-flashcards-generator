/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Flashcard, PageImage} from '../../types';
import {stripHtml} from '../cloze';

/**
 * Anki `.apkg` writer.
 *
 * An apkg is a zip containing a SQLite collection (`collection.anki2`), a
 * `media` JSON manifest mapping numeric zip entry names to real filenames, and
 * the media files themselves stored under those numeric names. This builds the
 * legacy schema-11 collection, which every current Anki version imports.
 *
 * Media is referenced from the note HTML by plain filename (`<img src="x.jpg">`)
 * and packaged into the deck, so the deck does not depend on the user still
 * having the original document on disk.
 */

export const NOTE_TYPE_NAME = 'AnKing Cloze + Citation';
export const FIELD_NAMES = ['Text', 'Extra', 'Citation'] as const;

const CARD_CSS = `.card {
  font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-size: 20px;
  text-align: left;
  color: #1e293b;
  background-color: #ffffff;
  line-height: 1.55;
  padding: 16px;
}
.cloze { font-weight: bold; color: #4f46e5; }
.extra {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
  font-size: 17px;
  color: #334155;
}
.citation {
  margin-top: 14px;
  font-size: 13px;
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-word;
}
.citation-image { margin-top: 8px; }
.citation-image img { max-width: 100%; border: 1px solid #e2e8f0; border-radius: 6px; }
table { border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #cbd5e1; padding: 4px 8px; font-size: 16px; }
`;

const QFMT = '{{cloze:Text}}';
const AFMT = `{{cloze:Text}}

<div class="extra">{{Extra}}</div>
<div class="citation-wrap">{{Citation}}</div>`;

const SCHEMA_SQL = `
CREATE TABLE col (
  id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null,
  conf text not null, models text not null, decks text not null, dconf text not null, tags text not null
);
CREATE TABLE notes (
  id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null,
  csum integer not null, flags integer not null, data text not null
);
CREATE TABLE cards (
  id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null,
  due integer not null, ivl integer not null, factor integer not null, reps integer not null,
  lapses integer not null, left integer not null, odue integer not null, odid integer not null,
  flags integer not null, data text not null
);
CREATE TABLE revlog (
  id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null,
  type integer not null
);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

/** 1 character of Anki's base-91 note guid alphabet. */
const GUID_CHARS =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&()*+,-./:;<=>?@[]^_`{|}~';

/** Deterministic per-note guid derived from the note's own content. */
export const noteGuid = (seed: string): string => {
  // FNV-1a over the seed, expanded into 10 base-91 characters.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = '';
  let value = h;
  for (let i = 0; i < 10; i += 1) {
    out += GUID_CHARS[value % GUID_CHARS.length];
    value = Math.floor(value / GUID_CHARS.length) + (i + 1) * 7919;
  }
  return out;
};

/** Anki's field checksum: first 8 hex digits of sha1 over the stripped sort field. */
export const fieldChecksum = async (sortField: string): Promise<number> => {
  const data = new TextEncoder().encode(stripHtml(sortField));
  const digest = await crypto.subtle.digest('SHA-1', data);
  const hex = [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return parseInt(hex.slice(0, 8), 16);
};

/** Cloze ordinals present in a field, 0-based as Anki stores them. */
export const clozeOrdinals = (text: string): number[] => {
  const found = new Set<number>();
  for (const m of text.matchAll(/\{\{c(\d+)::/g)) {
    const n = Number(m[1]);
    if (n >= 1) found.add(n - 1);
  }
  // A note with no cloze would generate no cards at all; Anki itself falls back
  // to ordinal 0 in that case, so do the same rather than dropping the note.
  return found.size > 0 ? [...found].sort((a, b) => a - b) : [0];
};

export interface ApkgOptions {
  cards: Flashcard[];
  /** Deck name; `::` creates subdecks in Anki. */
  deckName: string;
  images?: Map<string, PageImage>;
  /** Include page images as packaged media. */
  includeMedia?: boolean;
  /** Overrides how sql.js locates its wasm file (used by tests in Node). */
  locateFile?: (file: string) => string;
}

export interface ApkgResult {
  bytes: Uint8Array;
  noteCount: number;
  cardCount: number;
  mediaCount: number;
  notes: string[];
}

export const buildApkg = async ({
  cards,
  deckName,
  images,
  includeMedia = true,
  locateFile,
}: ApkgOptions): Promise<ApkgResult> => {
  if (cards.length === 0) throw new Error('There are no cards to export.');

  const SQL = await loadSqlJs(locateFile);
  const db = new SQL.Database();
  db.run(SCHEMA_SQL);

  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const modelId = now;
  const deckId = now + 1;
  // Collection creation time is conventionally 04:00 local on the current day.
  const crt = Math.floor(new Date(new Date().toDateString()).getTime() / 1000) + 4 * 3600;

  const models = {
    [String(modelId)]: {
      id: modelId,
      name: NOTE_TYPE_NAME,
      type: 1, // cloze
      mod: nowSec,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          name: 'Cloze',
          ord: 0,
          qfmt: QFMT,
          afmt: AFMT,
          did: null,
          bqfmt: '',
          bafmt: '',
          bfont: '',
          bsize: 0,
        },
      ],
      flds: FIELD_NAMES.map((name, ord) => ({
        name,
        ord,
        sticky: false,
        rtl: false,
        font: 'Arial',
        size: 20,
        media: [],
        description: '',
      })),
      css: CARD_CSS,
      latexPre:
        '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
      latexPost: '\\end{document}',
      latexsvg: false,
      req: [[0, 'any', [0]]],
      tags: [],
      vers: [],
    },
  };

  const decks = {
    '1': defaultDeck(1, 'Default', nowSec),
    [String(deckId)]: defaultDeck(deckId, deckName, nowSec),
  };

  const dconf = {
    '1': {
      id: 1,
      name: 'Default',
      mod: 0,
      usn: 0,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      new: {bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20},
      rev: {bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2},
      lapse: {delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0},
      dyn: false,
      newMix: 0,
      newPerDayMinimum: 0,
      interdayLearningMix: 0,
      reviewOrder: 0,
    },
  };

  const conf = {
    nextPos: 1,
    estTimes: true,
    activeDecks: [deckId],
    sortType: 'noteFld',
    timeLim: 0,
    sortBackwards: false,
    addToCur: true,
    curDeck: deckId,
    newBury: true,
    newSpread: 0,
    dueCounts: true,
    curModel: String(modelId),
    collapseTime: 1200,
    schedVer: 2,
  };

  db.run(
    'INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)',
    [
      crt,
      now,
      now,
      JSON.stringify(conf),
      JSON.stringify(models),
      JSON.stringify(decks),
      JSON.stringify(dconf),
      '{}',
    ],
  );

  // --- Media ---
  const mediaManifest: Record<string, string> = {};
  const mediaFiles: Record<string, Uint8Array> = {};
  const packaged = new Map<string, string>();
  const notes: string[] = [];

  if (includeMedia && images) {
    for (const card of cards) {
      const key = card.source?.imageKey;
      if (!key || packaged.has(key)) continue;
      const image = images.get(key);
      if (!image) continue;
      const entry = String(packaged.size);
      packaged.set(key, entry);
      mediaManifest[entry] = key;
      mediaFiles[entry] = image.bytes;
    }
  }

  const missingImages = cards.filter(
    c => c.source?.imageKey && !packaged.has(c.source.imageKey),
  ).length;
  if (missingImages > 0) {
    notes.push(
      `${missingImages} card(s) reference a page image that was not available; their Citation field keeps the page reference only.`,
    );
  }

  // --- Notes and cards ---
  const noteStmt = db.prepare(
    'INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?,?,?,?,-1,?,?,?,?,0,?)',
  );
  const cardStmt = db.prepare(
    'INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?,?,?,?,?,-1,0,0,?,0,0,0,0,0,0,0,0,?)',
  );

  let noteId = now;
  let cardId = now;
  let cardCount = 0;
  let due = 1;

  for (const card of cards) {
    const citationHtml = citationFieldHtml(card, packaged.has(card.source?.imageKey ?? ''));
    const fields = [card.text, card.extra, citationHtml];
    // 0x1f separates fields in the `flds` column.
    const flds = fields.join('\u001f');
    // Anki stores tags space-separated and space-padded.
    const tags = card.tag ? ` ${card.tag} ` : ' ';

    noteStmt.run([
      noteId,
      noteGuid(`${card.tag}|${stripHtml(card.text)}`),
      modelId,
      nowSec,
      tags,
      flds,
      stripHtml(card.text),
      await fieldChecksum(card.text),
      '',
    ]);

    for (const ord of clozeOrdinals(card.text)) {
      cardStmt.run([cardId, noteId, deckId, ord, nowSec, due, '']);
      cardId += 1;
      cardCount += 1;
      due += 1;
    }
    noteId += 1;
  }

  noteStmt.free();
  cardStmt.free();

  const collection = db.export();
  db.close();

  const {zipSync} = await import('fflate');
  const zipInput: Record<string, Uint8Array> = {
    'collection.anki2': collection,
    media: new TextEncoder().encode(JSON.stringify(mediaManifest)),
    ...mediaFiles,
  };
  const bytes = zipSync(zipInput, {level: 6});

  return {
    bytes,
    noteCount: cards.length,
    cardCount,
    mediaCount: packaged.size,
    notes,
  };
};

/** The Citation field's HTML: reference text, plus the `<img>` only if packaged. */
export const citationFieldHtml = (card: Flashcard, imagePackaged: boolean): string => {
  const reference = (card.citation ?? '').replace(/\s*\[[^\]]+\.jpg\]\s*$/i, '').trim();
  const escaped = reference
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const text = `<div class="citation">${escaped}</div>`;
  if (!imagePackaged || !card.source?.imageKey) return text;
  return `${text}<div class="citation-image"><img src="${card.source.imageKey}"></div>`;
};

const defaultDeck = (id: number, name: string, mod: number) => ({
  id,
  name,
  mod,
  usn: -1,
  lrnToday: [0, 0],
  revToday: [0, 0],
  newToday: [0, 0],
  timeToday: [0, 0],
  collapsed: false,
  browserCollapsed: false,
  desc: '',
  dyn: 0,
  conf: 1,
  extendRev: 50,
  extendNew: 10,
});

type SqlJsStatic = Awaited<ReturnType<typeof import('sql.js')>>;

let sqlPromise: Promise<SqlJsStatic> | null = null;

const loadSqlJs = async (locateFile?: (file: string) => string): Promise<SqlJsStatic> => {
  if (locateFile) {
    const initSqlJs = (await import('sql.js')).default;
    return initSqlJs({locateFile});
  }
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const initSqlJs = (await import('sql.js')).default;
      const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default;
      return initSqlJs({locateFile: () => wasmUrl});
    })();
  }
  return sqlPromise;
};
