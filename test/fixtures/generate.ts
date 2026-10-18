/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Regenerates the synthetic fixture PDF: `npx tsx test/fixtures/generate.ts`. */
import fs from 'node:fs';
import path from 'node:path';

import {makePdf} from '../make-pdf';

const bytes = makePdf({
  pages: [
    ['HEART FAILURE', 'Ejection fraction below 40 percent defines systolic failure.', 'ACE inhibitors are first-line therapy in all patients.'],
    ['Beta blockers reduce mortality once the patient is euvolaemic.', 'Spironolactone is added in persistent class III symptoms.'],
    ['AORTIC STENOSIS', 'An ejection systolic murmur radiates to the carotids.', 'Syncope on exertion is an ominous feature.'],
    ['A valve area below 1.0 square centimetre indicates severe stenosis.'],
  ],
  // Pages 1-2 roman, page 3 onward decimal from 1, so printed page != PDF page.
  pageLabels: [
    [0, '<< /S /r >>'],
    [2, '<< /S /D /St 1 >>'],
  ],
});

const out = path.join(import.meta.dirname, 'synthetic-notes.pdf');
fs.writeFileSync(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes)`);
