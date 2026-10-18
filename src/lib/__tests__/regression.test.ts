/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it, vi} from 'vitest';

import type {GenerationSettings} from '../../types';
import {documentFromPastedText, extensionOf, fromPlainText, htmlToText} from '../extract';
import {generateCards} from '../generate';
import {toTsv} from '../export/bundle';
import {wholeDocumentTopic} from '../topics';

/**
 * Guards the behaviour the original single-file app had, so the upgrade does
 * not regress the paste-text workflow, the arrow formatting, the `?<br><br>`
 * rule, the comma rule or the three-part tag.
 */

const settings = (over: Partial<GenerationSettings> = {}): GenerationSettings => ({
  density: 'comprehensive',
  depth: 'standard',
  citationMode: 'page',
  mode: 'default',
  tagPrefix: 'EMLE',
  subject: '',
  topic: '',
  firstLineAsTopic: false,
  ...over,
});

describe('pasted text still works end to end', () => {
  const pasted = `Aortic stenosis

The classic triad is angina, syncope and dyspnoea. The investigation of choice is echocardiography.`;

  it('wraps pasted text into a document with no invented page numbers', () => {
    const doc = documentFromPastedText(pasted);
    expect(doc.fileName).toBe('Pasted text');
    expect(doc.hasRealPages).toBe(false);
    expect(doc.canRenderPages).toBe(false);
    expect(doc.pages.length).toBeGreaterThan(0);
  });

  it('produces cards whose citation names the source but no page', async () => {
    const doc = documentFromPastedText(pasted);
    const result = await generateCards({
      doc,
      topics: [wholeDocumentTopic(doc)],
      settings: settings({subject: 'Cardiology', topic: 'Aortic Stenosis'}),
      callModel: vi.fn(async () =>
        JSON.stringify({
          cards: [
            {
              front:
                'What is the <u>investigation of choice</u> for <b>Aortic Stenosis</b>? {{c1::Echocardiography}}',
              back: 'Stenosed valve -> outflow obstruction -> LV hypertrophy, ischaemia.',
              tag_trailing: ['Cardiology', 'Aortic_Stenosis'],
              page_index: 1,
            },
          ],
        }),
      ),
    });

    expect(result.cards).toHaveLength(1);
    const card = result.cards[0];

    // The original three-part tag shape is preserved.
    expect(card.tag).toBe('EMLE::Cardiology::Aortic_Stenosis');
    // The `?` rule from the original prompt still applies.
    expect(card.text).toContain('?<br><br>{{c1::Echocardiography}}');
    // Arrows are still standardized, and commas still become semicolons.
    expect(card.extra).toContain('→');
    expect(card.extra).not.toContain('->');
    expect(card.extra).not.toContain(',');
    // Provenance exists but claims no page number for page-less input.
    expect(card.source?.fileName).toBe('Pasted text');
    expect(card.source?.pageIndex).toBeUndefined();
    expect(card.citation).toBe('Pasted text');
  });

  it('still exports a TSV row per card for the clipboard path', async () => {
    const doc = documentFromPastedText(pasted);
    const result = await generateCards({
      doc,
      topics: [wholeDocumentTopic(doc)],
      settings: settings(),
      callModel: vi.fn(async () =>
        JSON.stringify({
          cards: [
            {
              front: '<b>Aortic Stenosis</b> triad includes {{c1::syncope}}.',
              back: '<i>Mechanism:</i> obstruction → hypoperfusion.',
              tag_trailing: ['Cardiology', 'Aortic_Stenosis'],
              page_index: 1,
            },
          ],
        }),
      ),
    });
    const rows = toTsv(result.cards).split('\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].split('\t')).toHaveLength(4);
  });
});

describe('format support', () => {
  it('recognizes the supported extensions, case-insensitively', () => {
    expect(extensionOf('Notes.PDF')).toBe('.pdf');
    expect(extensionOf('notes')).toBe('');
  });

  it('keeps headings recognizable when converting HTML to text', () => {
    const text = htmlToText('<h2>Heart Failure</h2><p>ACE inhibitors first.</p><ul><li>Ramipril</li></ul>');
    expect(text).toContain('## Heart Failure');
    expect(text).toContain('- Ramipril');
    expect(text).not.toContain('<');
  });

  it('decodes entities rather than leaving them in the card text', () => {
    expect(htmlToText('<p>Na&nbsp;&lt;&nbsp;135&nbsp;mmol/L &amp; falling</p>')).toBe(
      'Na < 135 mmol/L & falling',
    );
  });

  it('numbers page-less chunks from 1 without claiming they are pages', () => {
    // Two paragraphs large enough that they cannot share one chunk.
    const doc = fromPlainText('n.txt', 'text', `${'a'.repeat(2500)}\n\n${'b'.repeat(2500)}`, []);
    expect(doc.pages.map(p => p.pageIndex)).toEqual([1, 2]);
    expect(doc.hasRealPages).toBe(false);
  });
});
