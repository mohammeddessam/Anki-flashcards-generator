/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it, vi} from 'vitest';

import type {GenerationSettings, SourceDocument} from '../../types';
import {
  generateCards,
  parseMarkdownTable,
  parseModelResponse,
  resolvePage,
} from '../generate';
import {detectTopics, planBatches, wholeDocumentTopic} from '../topics';

const settings = (over: Partial<GenerationSettings> = {}): GenerationSettings => ({
  density: 'balanced',
  depth: 'standard',
  citationMode: 'both',
  mode: 'default',
  tagPrefix: 'MRCP::Passmedicine_notes',
  subject: '',
  topic: '',
  firstLineAsTopic: false,
  ...over,
});

/** A multi-topic, multi-page document long enough to require several batches. */
const longDoc = (): SourceDocument => ({
  fileName: 'passmed.pdf',
  kind: 'pdf',
  pages: [
    {pageIndex: 1, printedPage: 'i', text: `HEART FAILURE\n${'ACE inhibitors reduce afterload. '.repeat(160)}`},
    {pageIndex: 2, printedPage: 'ii', text: `${'Beta blockers reduce mortality. '.repeat(160)}`},
    {pageIndex: 3, printedPage: '1', text: `${'Spironolactone is added in class III. '.repeat(160)}`},
    {pageIndex: 4, printedPage: '2', text: `AORTIC STENOSIS\n${'Ejection systolic murmur radiates. '.repeat(160)}`},
    {pageIndex: 5, printedPage: '3', text: `${'Valve area below one indicates severe disease. '.repeat(160)}`},
  ],
  hasRealPages: true,
  hasPrintedPages: true,
  canRenderPages: true,
  warnings: [],
});

/** Responds with one card per page present in the prompt, echoing its index. */
const echoingModel = (extra: Partial<Record<string, unknown>> = {}) =>
  vi.fn(async (prompt: string) => {
    const pageIndexes = [...prompt.matchAll(/PAGE_INDEX=(\d+)/g)].map(m => Number(m[1]));
    return JSON.stringify({
      cards: pageIndexes.map(page => ({
        front: `<b>Topic</b> fact from page ${page} is {{c1::<u>answer ${page}</u>}}.`,
        back: `<i>Mechanism:</i> cause → effect on page ${page}.`,
        tag_trailing: ['Cardiology', 'Heart_Failure'],
        page_index: page,
        ...extra,
      })),
    });
  });

describe('response parsing', () => {
  it('parses the JSON schema response', () => {
    const cards = parseModelResponse(
      '{"cards":[{"front":"a {{c1::b}}","back":"c","tag_trailing":["X","Y"],"page_index":4}]}',
    );
    expect(cards).toEqual([
      {front: 'a {{c1::b}}', back: 'c', tag_trailing: ['X', 'Y'], page_index: 4, tag: undefined, uncertain: false, note: undefined},
    ]);
  });

  it('parses JSON wrapped in a code fence', () => {
    expect(parseModelResponse('```json\n{"cards":[{"front":"a","back":"b"}]}\n```')).toHaveLength(1);
  });

  it('parses a bare array', () => {
    expect(parseModelResponse('[{"front":"a","back":"b"}]')).toHaveLength(1);
  });

  it('falls back to the original markdown table format', () => {
    const table = [
      '| text | extra | tag |',
      '| --- | --- | --- |',
      '| Q {{c1::A}} | because | EMLE::Cardiology::HF |',
    ].join('\n');
    expect(parseModelResponse(table)).toEqual([
      {front: 'Q {{c1::A}}', back: 'because', tag: 'EMLE::Cardiology::HF', page_index: undefined},
    ]);
  });

  it('reads a page column from the table fallback when present', () => {
    expect(
      parseMarkdownTable('| Q {{c1::A}} | because | EMLE::X::Y | page 7 |')[0].page_index,
    ).toBe(7);
  });

  it('returns nothing for unparsable output rather than throwing', () => {
    expect(parseModelResponse('Sorry, I cannot help with that.')).toEqual([]);
  });
});

describe('page resolution', () => {
  const doc = longDoc();
  const batch = planBatches(doc, [wholeDocumentTopic(doc)], 20_000)[0];

  it('accepts a page index that is actually in the batch', () => {
    expect(resolvePage(batch, 3)?.pageIndex).toBe(3);
  });

  it('refuses a page index the model invented', () => {
    expect(resolvePage(batch, 99)).toBeUndefined();
    expect(resolvePage(batch, undefined)).toBeUndefined();
  });

  it('uses the only page of a single-page batch when the model gave none', () => {
    const single = {topic: batch.topic, pages: [doc.pages[2]]};
    expect(resolvePage(single, undefined)?.pageIndex).toBe(3);
    // Even a wrong index cannot point anywhere else in a one-page batch.
    expect(resolvePage(single, 42)?.pageIndex).toBe(3);
  });
});

describe('generation over a long multi-topic document', () => {
  it('batches the document and still cites the correct page for each card', async () => {
    const doc = longDoc();
    const callModel = echoingModel();
    const result = await generateCards({
      doc,
      topics: detectTopics(doc),
      settings: settings(),
      callModel,
    });

    // More than one request was needed for this document.
    expect(callModel.mock.calls.length).toBeGreaterThan(1);
    expect(result.cards).toHaveLength(5);
    expect(result.failedBatches).toEqual([]);

    for (const card of result.cards) {
      const page = /page (\d+)/.exec(card.text)![1];
      expect(card.source?.pageIndex).toBe(Number(page));
      expect(card.citation).toContain(`PDF page ${page}`);
    }
  });

  it('keeps the printed page number distinct from the PDF page index', async () => {
    const doc = longDoc();
    const result = await generateCards({
      doc,
      topics: detectTopics(doc),
      settings: settings(),
      callModel: echoingModel(),
    });
    const page3 = result.cards.find(c => c.source?.pageIndex === 3)!;
    expect(page3.source?.printedPage).toBe('1');
    expect(page3.citation).toContain('PDF page 3 (printed p. 1)');
  });

  it('assigns each card the tag of its own topic', async () => {
    const doc = longDoc();
    const callModel = vi.fn(async (prompt: string) => {
      const section = /SECTION: (.*)/.exec(prompt)![1];
      const page = Number(/PAGE_INDEX=(\d+)/.exec(prompt)![1]);
      return JSON.stringify({
        cards: [
          {
            front: `<b>${section}</b> key fact is {{c1::<u>answer ${page}</u>}}.`,
            back: `<i>Mechanism:</i> a → b.`,
            tag_trailing: ['Cardiology', section],
            page_index: page,
          },
        ],
      });
    });
    const result = await generateCards({
      doc,
      topics: detectTopics(doc),
      settings: settings(),
      callModel,
    });
    const tags = new Set(result.cards.map(c => c.tag));
    expect(tags).toContain('MRCP::Passmedicine_notes::Cardiology::Heart_Failure');
    expect(tags).toContain('MRCP::Passmedicine_notes::Cardiology::Aortic_Stenosis');
  });

  it('honours a user-fixed subject and topic over the model tag', async () => {
    const doc = longDoc();
    const result = await generateCards({
      doc,
      topics: [wholeDocumentTopic(doc)],
      settings: settings({subject: 'Nephrology', topic: 'Nephrotic syndrome'}),
      callModel: echoingModel(),
    });
    for (const card of result.cards) {
      expect(card.tag).toBe(
        'MRCP::Passmedicine_notes::Nephrology::Nephrotic_syndrome',
      );
    }
  });

  it('collapses cards duplicated across batches', async () => {
    const doc = longDoc();
    const constant = vi.fn(async (prompt: string) => {
      const page = Number(/PAGE_INDEX=(\d+)/.exec(prompt)![1]);
      return JSON.stringify({
        cards: [
          {
            front: '<b>Heart failure</b> first-line therapy is {{c1::ACE inhibitors}}.',
            back: '<i>Mechanism:</i> ↓ afterload → ↑ stroke volume.',
            tag_trailing: ['Cardiology', 'Heart_Failure'],
            page_index: page,
          },
        ],
      });
    });
    const result = await generateCards({
      doc,
      topics: detectTopics(doc),
      settings: settings(),
      callModel: constant,
    });
    expect(result.cards).toHaveLength(1);
    expect(result.duplicateCount).toBe(constant.mock.calls.length - 1);
  });

  it('drops a card whose page the model invented from the citation, not from the deck', async () => {
    // Short pages, so the batch holds several pages and the fallback for a
    // single-page batch cannot apply.
    const doc: SourceDocument = {
      ...longDoc(),
      pages: [1, 2, 3].map(pageIndex => ({pageIndex, text: `Short page ${pageIndex} content.`})),
    };
    const callModel = vi.fn(async () =>
      JSON.stringify({
        cards: [
          {
            front: '<b>Heart failure</b> is treated with {{c1::diuretics}}.',
            back: '<i>Mechanism:</i> a → b.',
            tag_trailing: ['Cardiology', 'Heart_Failure'],
            page_index: 404,
          },
        ],
      }),
    );
    const result = await generateCards({
      doc,
      topics: [{id: 't', title: 'All', startPage: 1, endPage: 3, level: 0, charCount: 0}],
      settings: settings(),
      callModel,
    });
    expect(result.cards.length).toBeGreaterThan(0);
    for (const card of result.cards) {
      expect(card.source?.pageIndex).toBeUndefined();
      expect(card.citation).not.toMatch(/page 404/);
      expect(card.citation).toContain('passmed.pdf');
    }
    expect(result.limitations.join(' ')).toMatch(/could not be tied to a single source page/);
  });

  it('reports progress for every batch', async () => {
    const doc = longDoc();
    const onProgress = vi.fn();
    await generateCards({
      doc,
      topics: detectTopics(doc),
      settings: settings(),
      callModel: echoingModel(),
      onProgress,
    });
    const last = onProgress.mock.lastCall![0];
    expect(last.completedBatches).toBe(last.totalBatches);
    expect(onProgress).toHaveBeenCalledTimes(last.totalBatches);
  });

  it('records a failed batch instead of losing the whole run', async () => {
    const doc = longDoc();
    let call = 0;
    const flaky = vi.fn(async (prompt: string) => {
      call += 1;
      if (call === 1) throw new Error('503 model overloaded');
      const page = Number(/PAGE_INDEX=(\d+)/.exec(prompt)![1]);
      return JSON.stringify({
        cards: [
          {
            front: `<b>Topic</b> fact ${page} is {{c1::answer ${page}}}.`,
            back: '<i>Mechanism:</i> a → b.',
            tag_trailing: ['Cardiology', 'Heart_Failure'],
            page_index: page,
          },
        ],
      });
    });
    const result = await generateCards({
      doc,
      topics: detectTopics(doc),
      settings: settings(),
      callModel: flaky,
    });
    expect(result.failedBatches).toHaveLength(1);
    expect(result.failedBatches[0].error).toMatch(/503/);
    expect(result.cards.length).toBeGreaterThan(0);
  });

  it('reports an unparsable batch as failed rather than silently empty', async () => {
    const doc = longDoc();
    const result = await generateCards({
      doc,
      topics: [wholeDocumentTopic(doc)],
      settings: settings(),
      callModel: vi.fn(async () => 'I am unable to produce cards.'),
    });
    expect(result.cards).toEqual([]);
    expect(result.failedBatches.length).toBeGreaterThan(0);
    expect(result.failedBatches[0].error).toMatch(/nothing parsable/);
  });

  it('caps the one-question mode at three cards per batch', async () => {
    const doc: SourceDocument = {
      fileName: 'q.txt',
      kind: 'pasted',
      pages: [{pageIndex: 1, text: 'A 24-year-old man with right iliac fossa pain.'}],
      hasRealPages: false,
      hasPrintedPages: false,
      canRenderPages: false,
      warnings: [],
    };
    const result = await generateCards({
      doc,
      topics: [wholeDocumentTopic(doc)],
      settings: settings({mode: 'one_question_max_3', citationMode: 'page'}),
      callModel: vi.fn(async () =>
        JSON.stringify({
          cards: Array.from({length: 7}, (_, i) => ({
            front: `<b>Appendicitis</b> fact number ${i} is {{c1::answer ${i}}}.`,
            back: '<i>Mechanism:</i> obstruction → inflammation.',
            tag_trailing: ['Surgery', 'Appendicitis'],
            page_index: 1,
          })),
        }),
      ),
    });
    expect(result.cards).toHaveLength(3);
  });

  it('flags model-reported uncertainty for review instead of discarding the card', async () => {
    const doc = longDoc();
    const result = await generateCards({
      doc,
      topics: [wholeDocumentTopic(doc)],
      settings: settings(),
      callModel: echoingModel({uncertain: true, note: 'Threshold not stated in source.'}),
    });
    expect(result.cards[0].review).toEqual(['Threshold not stated in source.']);
  });

  it('surfaces document warnings as run limitations', async () => {
    const doc = {...longDoc(), warnings: ['3 of 5 pages have no extractable text.']};
    const result = await generateCards({
      doc,
      topics: [wholeDocumentTopic(doc)],
      settings: settings(),
      callModel: echoingModel(),
    });
    expect(result.limitations).toContain('3 of 5 pages have no extractable text.');
  });

  it('attaches no image key when the document cannot produce page images', async () => {
    const doc: SourceDocument = {...longDoc(), canRenderPages: false};
    const result = await generateCards({
      doc,
      topics: [wholeDocumentTopic(doc)],
      settings: settings({citationMode: 'both'}),
      callModel: echoingModel(),
      hasImageForPage: () => false,
    });
    for (const card of result.cards) {
      expect(card.source?.imageKey).toBeUndefined();
      expect(card.citation).toContain('PDF page');
    }
    expect(result.limitations.join(' ')).toMatch(/page reference retained/);
  });
});
