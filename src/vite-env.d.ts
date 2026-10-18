/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Vite's `?url` asset imports, used to locate the pdf.js worker and sql.js wasm. */
declare module '*?url' {
  const url: string;
  export default url;
}

/** mammoth ships a browser bundle without its own type declarations. */
declare module 'mammoth/mammoth.browser' {
  export interface ConvertResult {
    value: string;
    messages: Array<{type: string; message: string}>;
  }
  export function convertToHtml(input: {arrayBuffer: ArrayBuffer}): Promise<ConvertResult>;
  export function extractRawText(input: {arrayBuffer: ArrayBuffer}): Promise<ConvertResult>;
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
