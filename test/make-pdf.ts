/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds a small, real PDF in memory so tests can check page attribution
 * against a document whose page text and page labels are known exactly.
 *
 * The `/PageLabels` tree is what makes the printed page number differ from the
 * PDF page index, which is the distinction the citation code has to preserve.
 */

export interface MakePdfOptions {
  /** One entry per page; each entry is the lines of text on that page. */
  pages: string[][];
  /**
   * Page label ranges, as `[startPageIndex0Based, PDF label dictionary]`.
   * Omit for a PDF that declares no page labels at all.
   */
  pageLabels?: Array<[number, string]>;
}

const escapePdfText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export const makePdf = ({pages, pageLabels}: MakePdfOptions): Uint8Array => {
  const objects: string[] = [];
  /** Reserves an object number (1-based) and returns it. */
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  // Object numbers are allocated up front so the tree can cross-reference.
  const catalogNum = 1;
  const pagesNum = 2;
  const fontNum = 3;
  objects.push('', '', ''); // placeholders for 1..3

  const pageNums: number[] = [];
  for (const lines of pages) {
    const content =
      `BT /F1 12 Tf 72 720 Td 14 TL\n` +
      lines.map(line => `(${escapePdfText(line)}) Tj T*`).join('\n') +
      `\nET`;
    const streamNum = add(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
    const pageNum = add(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${streamNum} 0 R >>`,
    );
    pageNums.push(pageNum);
  }

  const labelsEntry = pageLabels
    ? ` /PageLabels << /Nums [${pageLabels.map(([n, dict]) => `${n} ${dict}`).join(' ')}] >>`
    : '';

  objects[catalogNum - 1] =
    `<< /Type /Catalog /Pages ${pagesNum} 0 R${labelsEntry} >>`;
  objects[pagesNum - 1] =
    `<< /Type /Pages /Count ${pageNums.length} /Kids [${pageNums
      .map(n => `${n} 0 R`)
      .join(' ')}] >>`;
  objects[fontNum - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  // --- Serialize with a correct xref table ---
  const parts: string[] = ['%PDF-1.4\n'];
  let offset = parts[0].length;
  const offsets: number[] = [];

  objects.forEach((body, i) => {
    offsets.push(offset);
    const chunk = `${i + 1} 0 obj\n${body}\nendobj\n`;
    parts.push(chunk);
    offset += chunk.length;
  });

  const xrefStart = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) {
    xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(xref);

  // Every byte written here is ASCII, so a 1:1 char/byte encoding is correct
  // and keeps the recorded xref offsets valid.
  const text = parts.join('');
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
};

/** A File-like object good enough for the extraction code, usable in Node. */
export const asFile = (bytes: Uint8Array, name: string) => ({
  name,
  async arrayBuffer() {
    return bytes.slice().buffer as ArrayBuffer;
  },
});
