import fs from 'fs';
import {createRequire} from 'module';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, loadEnv, type Plugin} from 'vite';

/** Directories pdf.js loads at runtime when a PDF uses standard fonts or CJK encodings. */
const PDFJS_ASSETS = ['standard_fonts', 'cmaps'] as const;

const requireFrom = createRequire(import.meta.url);
const pdfjsDir = (name: string) =>
  path.join(path.dirname(requireFrom.resolve('pdfjs-dist/package.json')), name);

/**
 * Serves pdf.js's font and cmap data under `/pdfjs/` in dev and copies it into
 * `dist/pdfjs/` on build. Without it, rendering a page that uses a standard
 * font falls back to a substitute and the page image does not match the source.
 */
const pdfjsAssets = (): Plugin => ({
  name: 'pdfjs-assets',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const match = /^\/pdfjs\/([a-z_]+)\/(.+)$/.exec((req.url ?? '').split('?')[0]);
      if (!match || !PDFJS_ASSETS.includes(match[1] as (typeof PDFJS_ASSETS)[number])) {
        return next();
      }
      const file = path.join(pdfjsDir(match[1]), path.normalize(match[2]).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(pdfjsDir(match[1])) || !fs.existsSync(file)) return next();
      res.setHeader('Content-Type', 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
      return undefined;
    });
  },
  writeBundle(options) {
    const outDir = options.dir ?? 'dist';
    for (const name of PDFJS_ASSETS) {
      fs.cpSync(pdfjsDir(name), path.join(outDir, 'pdfjs', name), {recursive: true});
    }
  },
});

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), pdfjsAssets()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      // Lets the Gemini model be swapped without a code change.
      'process.env.GEMINI_MODEL': JSON.stringify(env.GEMINI_MODEL),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // pdf.js, ExcelJS and sql.js are large and only needed on demand, so they
      // are split out of the entry chunk instead of inflating first load.
      chunkSizeWarningLimit: 1200,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify, file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
