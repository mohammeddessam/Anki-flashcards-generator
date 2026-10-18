/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it} from 'vitest';

import type {Flashcard} from '../../types';
import {
  breakAfterQuestionMark,
  cardFingerprint,
  finalizeCards,
  findUnbalancedTags,
  inspectCloze,
  markdownToHtml,
  normalizeArrows,
  normalizeField,
  renumberCloze,
  replaceCommasOutsideTags,
  sanitizeHtml,
  validateCard,
} from '../cloze';

const card = (over: Partial<Flashcard> = {}): Flashcard => ({
  text: '<b>Nephrotic syndrome</b> causes {{c1::<u>heavy proteinuria</u>}}.',
  extra: '<i>Mechanism:</i> ↑ glomerular permeability → urinary protein loss.',
  tag: 'MRCP::Nephrology::Nephrotic_Syndrome',
  ...over,
});

describe('cloze syntax', () => {
  it('keeps native Anki cloze syntax intact, including HTML inside the cloze', () => {
    const front = normalizeField(card().text, {isFront: true, replaceCommas: true});
    expect(front).toContain('{{c1::<u>heavy proteinuria</u>}}');
    expect(front).toContain('<b>Nephrotic syndrome</b>');
  });

  it('counts clozes and detects malformed braces', () => {
    expect(inspectCloze('{{c1::a}} and {{c2::b}}').count).toBe(2);
    expect(inspectCloze('{{c1::a}} and {{c2::b}}').malformed).toBe(false);
    expect(inspectCloze('{{c1::a}} and {{c2::b').malformed).toBe(true);
    expect(inspectCloze('{{c1::}}').emptyAnswers).toEqual([1]);
  });

  it('treats an HTML-only cloze answer as empty', () => {
    expect(inspectCloze('{{c1::<b></b>}}').emptyAnswers).toEqual([1]);
  });

  it('renumbers clozes to a contiguous sequence but keeps grouping', () => {
    expect(renumberCloze('{{c3::a}} {{c7::b}} {{c3::c}}')).toBe(
      '{{c1::a}} {{c2::b}} {{c1::c}}',
    );
  });

  it('does not treat a cloze hint as a second cloze', () => {
    expect(inspectCloze('{{c1::answer::hint}}').count).toBe(1);
  });
});

describe('HTML formatting', () => {
  it('converts stray markdown emphasis to HTML tags', () => {
    expect(markdownToHtml('**Asthma** is *reversible*')).toBe(
      '<b>Asthma</b> is <i>reversible</i>',
    );
  });

  it('normalizes every arrow spelling onto the Unicode arrows', () => {
    expect(normalizeArrows('a -> b --> c => d &rarr; e')).toBe(
      'a → b → c → d → e',
    );
    expect(normalizeArrows('&uarr; Na &darr; K')).toBe('↑ Na ↓ K');
  });

  it('strips tags outside the allowlist but keeps their text', () => {
    expect(sanitizeHtml('<script>bad()</script><b>good</b>')).toBe('bad()<b>good</b>');
    expect(sanitizeHtml('<a href="http://x">link</a>')).toBe('link');
  });

  it('keeps highlighting styles and table spans', () => {
    expect(sanitizeHtml('<span style="background-color:#fff3bf">hi</span>')).toBe(
      '<span style="background-color:#fff3bf">hi</span>',
    );
    expect(sanitizeHtml('<td colspan="2">x</td>')).toBe('<td colspan="2">x</td>');
  });

  it('drops style values that are not plain CSS', () => {
    expect(sanitizeHtml('<span style="background:url(javascript:1)">x</span>')).toBe(
      '<span>x</span>',
    );
  });

  it('reports unbalanced tags', () => {
    expect(findUnbalancedTags('<b>bold')).toEqual(['unclosed <b>']);
    expect(findUnbalancedTags('bold</b>')).toEqual(['stray </b>']);
    expect(findUnbalancedTags('<ol><li>a</li></ol><br>')).toEqual([]);
  });

  it('follows every question mark with a double line break exactly once', () => {
    expect(breakAfterQuestionMark('What is X? {{c1::Y}}')).toBe(
      'What is X?<br><br>{{c1::Y}}',
    );
    expect(breakAfterQuestionMark('What is X?<br><br>{{c1::Y}}')).toBe(
      'What is X?<br><br>{{c1::Y}}',
    );
  });

  it('replaces commas outside tags only', () => {
    expect(replaceCommasOutsideTags('<td colspan="2">a, b</td>')).toBe(
      '<td colspan="2">a; b</td>',
    );
  });

  it('does not leave a trailing line break on a question-ending front', () => {
    expect(normalizeField('Diagnosis {{c1::MI}}?', {isFront: true, replaceCommas: true})).toBe(
      'Diagnosis {{c1::MI}}?',
    );
  });
});

describe('validation', () => {
  it('accepts a well-formed card', () => {
    expect(validateCard(card()).ok).toBe(true);
  });

  it('rejects a front with no cloze', () => {
    expect(validateCard(card({text: 'Nephrotic syndrome causes proteinuria.'})).problems).toContain(
      'Front has no cloze deletion',
    );
  });

  it('rejects a cloze in the Back field', () => {
    expect(validateCard(card({extra: 'Because {{c1::x}}'})).problems).toContain(
      'Back contains a cloze deletion (it would hide the explanation)',
    );
  });

  it('rejects a tag containing whitespace or an empty component', () => {
    expect(validateCard(card({tag: 'MRCP::Heart Failure'})).problems).toContain(
      'Tag is empty or contains whitespace',
    );
    expect(validateCard(card({tag: 'MRCP::'})).problems).toContain(
      'Tag has an empty hierarchy component',
    );
  });

  it('rejects a trivially short front', () => {
    expect(validateCard(card({text: '{{c1::A}}?'})).problems).toContain(
      'Front is too short to be a usable card',
    );
  });
});

describe('deduplication', () => {
  it('ignores HTML and cloze markers when fingerprinting', () => {
    expect(cardFingerprint('<b>A</b> is {{c1::<u>B</u>}}')).toBe(
      cardFingerprint('A is B'),
    );
  });

  it('drops duplicates across batches via a shared seen set', () => {
    const seen = new Set<string>();
    const first = finalizeCards([card()], {seen});
    const second = finalizeCards([card()], {seen});
    expect(first.cards).toHaveLength(1);
    expect(second.cards).toHaveLength(0);
    expect(second.duplicates).toHaveLength(1);
  });

  it('separates malformed cards into `rejected` with reasons', () => {
    const result = finalizeCards([card({text: 'no cloze at all here'})]);
    expect(result.cards).toHaveLength(0);
    expect(result.rejected[0].problems).toContain('Front has no cloze deletion');
  });

  it('keeps two genuinely different cards', () => {
    const result = finalizeCards([
      card(),
      card({text: '<b>Nephrotic syndrome</b> causes {{c1::hypoalbuminaemia}}.'}),
    ]);
    expect(result.cards).toHaveLength(2);
  });
});
