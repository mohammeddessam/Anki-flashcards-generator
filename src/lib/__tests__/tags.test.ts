/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it} from 'vitest';

import {
  buildTag,
  normalizeTagToken,
  splitPrefix,
  trailingComponentsFromModelTag,
} from '../tags';

describe('tag components', () => {
  it('replaces whitespace and punctuation with single underscores', () => {
    expect(normalizeTagToken('Heart  Failure')).toBe('Heart_Failure');
    expect(normalizeTagToken('Pre-eclampsia')).toBe('Pre-eclampsia');
    expect(normalizeTagToken('Factor VII deficiency!')).toBe('Factor_VII_deficiency');
  });

  it('never lets `::` survive inside a single component', () => {
    expect(normalizeTagToken('Cardiology::Heart')).toBe('Cardiology_Heart');
  });

  it('strips HTML the model may have wrapped a tag in', () => {
    expect(normalizeTagToken('<i>Cardiology</i>')).toBe('Cardiology');
  });

  it('keeps non-latin letters rather than mangling them', () => {
    expect(normalizeTagToken('Ménière disease')).toBe('Ménière_disease');
  });
});

describe('hierarchical prefixes', () => {
  it('splits a multi-segment prefix into components', () => {
    expect(splitPrefix('MRCP::Passmedicine notes')).toEqual(['MRCP', 'Passmedicine_notes']);
  });

  it('builds the full four-level hierarchy from the brief', () => {
    expect(
      buildTag({
        prefix: 'MRCP::Passmedicine_notes',
        trailing: ['Cardiology', 'Heart Failure'],
      }),
    ).toBe('MRCP::Passmedicine_notes::Cardiology::Heart_Failure');
  });

  it('drops empty trailing components instead of emitting `::::`', () => {
    expect(buildTag({prefix: 'MRCP', trailing: ['', 'Heart_Failure']})).toBe(
      'MRCP::Heart_Failure',
    );
    expect(buildTag({prefix: 'MRCP', trailing: ['Cardiology', undefined]})).toBe(
      'MRCP::Cardiology',
    );
  });

  it('falls back when the model supplied nothing usable', () => {
    expect(
      buildTag({prefix: 'EMLE', trailing: [undefined, ''], fallback: ['General_Medicine', 'General']}),
    ).toBe('EMLE::General_Medicine::General');
  });

  it('never produces a tag containing whitespace', () => {
    const tag = buildTag({prefix: 'My Prefix', trailing: ['Infectious Diseases', 'TB meningitis']});
    expect(tag).toBe('My_Prefix::Infectious_Diseases::TB_meningitis');
    expect(tag).not.toMatch(/\s/);
  });
});

describe('model tag reconciliation', () => {
  it('strips a prefix the model echoed back', () => {
    expect(
      trailingComponentsFromModelTag('MRCP::Passmedicine_notes::Cardiology::Heart_Failure', 'MRCP::Passmedicine_notes'),
    ).toEqual(['Cardiology', 'Heart_Failure']);
  });

  it('keeps components when the model omitted the prefix', () => {
    expect(trailingComponentsFromModelTag('Cardiology::Heart_Failure', 'MRCP')).toEqual([
      'Cardiology',
      'Heart_Failure',
    ]);
  });

  it('drops a stray prefix component the model placed mid-tag', () => {
    expect(trailingComponentsFromModelTag('EMLE::Nephrology', 'EMLE')).toEqual(['Nephrology']);
  });

  it('accepts `/` as a separator, which models sometimes use', () => {
    expect(trailingComponentsFromModelTag('Cardiology/Heart Failure', 'MRCP')).toEqual([
      'Cardiology',
      'Heart_Failure',
    ]);
  });
});
