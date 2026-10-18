/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Development-only console hook.
 *
 * The browser-only paths (canvas page rendering, ExcelJS, the sql.js wasm
 * build) cannot be exercised by the Node test suite, so they are reachable
 * from the devtools console as `window.ankingDev` when running `npm run dev`.
 * This module is never imported in a production build.
 */

export const installDevTools = async (): Promise<void> => {
  const [extract, pdf, topics, generate, cloze, citation, xlsx, apkg, bundle] = await Promise.all([
    import('./lib/extract'),
    import('./lib/extract/pdf'),
    import('./lib/topics'),
    import('./lib/generate'),
    import('./lib/cloze'),
    import('./lib/citation'),
    import('./lib/export/xlsx'),
    import('./lib/export/apkg'),
    import('./lib/export/bundle'),
  ]);

  (window as unknown as {ankingDev: unknown}).ankingDev = {
    ...extract,
    ...pdf,
    ...topics,
    ...generate,
    ...cloze,
    ...citation,
    ...xlsx,
    ...apkg,
    ...bundle,
  };
  console.info('[anking] dev helpers available as window.ankingDev');
};
