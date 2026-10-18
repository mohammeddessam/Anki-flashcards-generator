# AnKing Card Studio

Turns medical study documents into Anki cloze flashcards with **traceable source
citations**, hierarchical Anki tags, a four-column Excel workbook and a ready-to-import
`.apkg` deck.

Built with React 19, TypeScript, Vite and Google GenAI. Everything runs in the browser;
there is no backend.

---

## Running it

```bash
npm install
```

Create a `.env` (or `.env.local`) from `.env.example`:

```
GEMINI_API_KEY="your-key"
```

Then:

```bash
npm run dev        # http://localhost:3000
npm run build      # production build into dist/
npm run preview    # serve the production build
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

`GEMINI_MODEL` is optional and overrides the default model (`gemini-3.8-flash`).

> The API key is injected into the client bundle at build time, exactly as in the
> original project. Do not deploy a build made with a key you would not expose publicly.

---

## Workflow

**Upload → select options → generate → review → export.**

1. **Upload** a PDF, DOCX, TXT, MD or HTML file — or keep using the paste box, which
   works exactly as before.
2. **Topics** are detected from headings and listed with their page ranges. Pick one,
   several, or leave everything unselected to process the whole document.
3. **Options**: card density (high-yield / balanced / comprehensive), explanation depth
   (brief / standard / deep), citation mode (page reference / page image / both), and
   the hierarchical tag prefix.
4. **Generate.** Long documents are split into page-aligned batches; each page goes to
   exactly one batch, so nothing is lost or duplicated.
5. **Review** the table, including the Citation column, source page thumbnails and any
   cards the model flagged as uncertain.
6. **Export** to `.xlsx`, `.apkg`, or a `.zip` bundle containing both plus the page images.

### Citations

Every card carries where it came from, taken from the document and never invented:

| | |
|---|---|
| Source filename | always |
| **PDF page index** | position of the page in the file |
| **Printed page number** | only when the PDF declares page labels — never inferred from the index |
| Topic / section | the detected heading |
| Page image | rendered from the PDF, optimized JPEG, one per page |

A citation looks like:

```
Passmedicine Cardiology.pdf — PDF page 12 (printed p. 7) — Heart Failure
```

If an image cannot be produced, the page reference is kept and the limitation is shown
in the run notes. DOCX, TXT, MD and HTML have no pages, so their citations reference the
detected section instead — they never claim a PDF-style page number.

### Tags

Cards get real hierarchical Anki tags, not descriptive text:

```
MRCP::Passmedicine_notes::Cardiology::Heart_Failure
└──────── your prefix ────────┘└ subject ┘└── topic ──┘
```

The prefix can itself contain `::`. Subject and topic are detected per card unless you
pin them. In a multi-topic document each card gets its own topic component.

---

## Exporting and importing

### Excel

`Export → Excel (.xlsx)` produces a workbook whose **Flashcards** sheet has exactly four
columns in this order:

| Front | Back | Citation | Tags |
|---|---|---|---|
| HTML cloze sentence | HTML explanation | readable page reference | hierarchical tag |

Front, Back and Tags are plain editable text. In an image citation mode the source page
image is embedded next to the Citation column (one copy per page, not per card). A second
**Quality Control** sheet carries cloze counts, plain-text fronts and review flags — the
main sheet never gets extra columns.

To get the workbook into Anki: save it as tab-separated text, then in Anki choose
**File → Import**, set the field separator to Tab, enable **Allow HTML in fields**, map
column 4 to Tags, and choose a Cloze note type. The `cards.tsv` file inside the export
bundle is already in that form, and `Copy TSV` puts the same four columns on your clipboard.

> **Images in a worksheet do not transfer into Anki.** Use the `.apkg` export if you want
> the page images on your cards.

### Anki deck

`Export → Anki (.apkg)` writes a complete deck. Import it with **File → Import** in Anki.

It contains a cloze note type named *AnKing Cloze + Citation* with three fields —
`Text`, `Extra`, `Citation` — a card template that shows the cloze on the front and the
explanation plus citation on the back, your hierarchical tags, and the source page images
packaged as deck media. The images are referenced by plain filename, so the deck does not
depend on the original document still being on your disk.

### Bundle

`Export → Bundle (.zip)` ships the workbook, the deck, `cards.tsv`, the source page images
and a README explaining the contents.

---

## What has been verified

`npm test` runs 131 tests covering cloze and HTML formatting, the four-column Excel
schema and column order, tag hierarchy, page attribution, missing images, media packaging,
long multi-topic documents, duplicate and malformed cards, and the original paste-text
behaviour.

Page attribution is checked against a synthetic PDF built in the test
(`test/make-pdf.ts`) whose pages and page labels are known exactly, including a case where
the printed page number differs from the PDF page index.

The `.apkg` is validated by unzipping it and opening the SQLite collection inside: schema
version, note type, fields, templates, deck name, notes, per-cloze card rows, tags and the
media manifest.

**Not verified:** importing the generated `.apkg` into a real Anki installation — no Anki
is available in the development environment. The package is structurally valid; confirm the
first import yourself.

---

## Development notes

- `src/lib/extract/` — document extraction, page text, page labels, page rendering
- `src/lib/topics.ts` — heading detection, topic page ranges, batch planning
- `src/lib/prompt.ts` — prompt construction (the original AnKing rules, extended)
- `src/lib/generate.ts` — batching, model calls, provenance, validation
- `src/lib/cloze.ts` — cloze/HTML normalization, validation, deduplication
- `src/lib/citation.ts` — citation modes and formatting
- `src/lib/export/` — Excel, `.apkg` and bundle writers

In `npm run dev` these modules are also exposed on `window.ankingDev` so the browser-only
paths (canvas page rendering, ExcelJS, sql.js) can be exercised from the devtools console.
This hook is excluded from production builds.
