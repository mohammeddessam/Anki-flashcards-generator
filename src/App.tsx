/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  Sparkles,
  Table as TableIcon,
  Tag as TagIcon,
} from 'lucide-react';

import {CardTable} from './components/CardTable';
import {ExportBar} from './components/ExportBar';
import {OptionsPanel} from './components/OptionsPanel';
import {SourcePanel} from './components/SourcePanel';
import {TopicPicker} from './components/TopicPicker';
import {
  APKG_MIME,
  XLSX_MIME,
  ZIP_MIME,
  downloadBytes,
  exportBaseName,
} from './lib/download';
import {buildBundle, toTsv} from './lib/export/bundle';
import {buildApkg} from './lib/export/apkg';
import {buildWorkbook} from './lib/export/xlsx';
import {documentFromPastedText, extractFile, type ExtractResult} from './lib/extract';
import {
  availableCitationModes,
  createGeminiCaller,
  generateCards,
  type GenerateProgress,
} from './lib/generate';
import {splitPrefix} from './lib/tags';
import {detectTopics, wholeDocumentTopic} from './lib/topics';
import type {
  CardDensity,
  CitationMode,
  ExplanationDepth,
  Flashcard,
  GenerationMode,
  PageImage,
  SourceDocument,
  Topic,
} from './types';

/** localStorage-backed state, as the original app did for its tag fields. */
const usePersisted = <T extends string>(key: string, fallback: T) => {
  const [value, setValue] = useState<T>(() => (localStorage.getItem(key) as T) || fallback);
  const update = useCallback(
    (next: T) => {
      setValue(next);
      localStorage.setItem(key, next);
    },
    [key],
  );
  return [value, update] as const;
};

export default function App() {
  // --- Source ---
  const [sourceText, setSourceText] = useState('');
  const [extraction, setExtraction] = useState<ExtractResult | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // --- Topics ---
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);

  // --- Tag structure (original three-part UI, Part 1 now accepts `::`) ---
  const [part1, setPart1] = usePersisted('anki_part1', 'EMLE');
  const [subject, setSubject] = usePersisted('anki_subject', '');
  const [topic, setTopic] = usePersisted('anki_topic', '');
  const [firstLineAsTopic, setFirstLineAsTopic] = useState<boolean>(
    () => localStorage.getItem('anki_first_line_as_topic') === 'true',
  );

  // --- Generation options ---
  const [density, setDensity] = usePersisted<CardDensity>('anki_density', 'balanced');
  const [depth, setDepth] = usePersisted<ExplanationDepth>('anki_depth', 'standard');
  const [citationMode, setCitationMode] = usePersisted<CitationMode>('anki_citation_mode', 'page');
  const [generationMode, setGenerationMode] = useState<GenerationMode>('default');

  // --- Results ---
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [images, setImages] = useState<Map<string, PageImage>>(new Map());
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [limitations, setLimitations] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busyExport, setBusyExport] = useState<string | null>(null);

  const doc = extraction?.doc ?? null;
  const citationModes = useMemo(() => availableCitationModes(doc), [doc]);

  // Object URLs for the thumbnails have to be released when they are replaced.
  useEffect(
    () => () => {
      for (const url of imageUrls.values()) URL.revokeObjectURL(url);
    },
    [imageUrls],
  );

  // A source that cannot produce page images must not stay in an image mode.
  useEffect(() => {
    if (!citationModes.includes(citationMode)) setCitationMode('page');
  }, [citationModes, citationMode, setCitationMode]);

  const handleFirstLineAsTopicChange = (enabled: boolean) => {
    setFirstLineAsTopic(enabled);
    localStorage.setItem('anki_first_line_as_topic', String(enabled));
  };

  // Helper to extract a clean first line from pasted content for the Topic tag.
  const extractFirstLineAsTopic = (text: string): string => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    return lines[0]
      .replace(/^#+\s*/, '')
      .replace(/^[*\-•\d+.]+\s*/, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[:：\-–|\t]+$/g, '')
      .trim();
  };

  const effectiveTopic = useMemo(() => {
    if (firstLineAsTopic && !doc) {
      const extracted = extractFirstLineAsTopic(sourceText);
      if (extracted) return {value: extracted, fromFirstLine: true};
    }
    return {value: topic.trim(), fromFirstLine: false};
  }, [firstLineAsTopic, doc, sourceText, topic]);

  // --- File handling ---

  const handleFileSelected = async (file: File) => {
    setIsLoadingFile(true);
    setFileError(null);
    setError(null);
    try {
      await extraction?.pdf?.destroy();
      const result = await extractFile(file);
      setExtraction(result);
      const detected = detectTopics(result.doc);
      setTopics(detected);
      setSelectedTopicIds([]);
      setCards([]);
      setImages(new Map());
      setImageUrls(new Map());
      setLimitations([]);
    } catch (err) {
      setExtraction(null);
      setTopics([]);
      setFileError((err as Error)?.message ?? 'Could not read that file.');
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleClearFile = async () => {
    await extraction?.pdf?.destroy();
    setExtraction(null);
    setTopics([]);
    setSelectedTopicIds([]);
    setFileError(null);
  };

  // --- Generation ---

  /**
   * Renders page images only for the pages cards actually cite, so a long PDF
   * does not render hundreds of pages nobody referenced.
   */
  const renderCitedPages = async (generated: Flashcard[]): Promise<Map<string, PageImage>> => {
    const pdf = extraction?.pdf;
    const rendered = new Map<string, PageImage>();
    if (!pdf) return rendered;

    const wanted = new Map<string, number>();
    for (const card of generated) {
      const key = card.source?.imageKey;
      const page = card.source?.pageIndex;
      if (key && page != null && !wanted.has(key)) wanted.set(key, page);
    }

    let done = 0;
    for (const [key, pageIndex] of wanted) {
      try {
        rendered.set(key, await pdf.renderPage(pageIndex));
      } catch (err) {
        console.error(`Could not render page ${pageIndex}`, err);
      }
      done += 1;
      setStatus(`Rendering source pages (${done}/${wanted.size})...`);
    }
    return rendered;
  };

  const generate = async (targetMode: GenerationMode) => {
    const activeDoc: SourceDocument | null = doc ?? (sourceText.trim() ? documentFromPastedText(sourceText) : null);
    if (!activeDoc) {
      setError('Upload a study document or paste source content to generate flashcards.');
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      setError('GEMINI_API_KEY is not configured, so cards cannot be generated.');
      return;
    }

    setGenerationMode(targetMode);
    setIsGenerating(true);
    setError(null);
    setStatus(null);
    setProgress(null);
    setLimitations([]);

    try {
      const activeTopics =
        doc && selectedTopicIds.length > 0
          ? topics.filter(t => selectedTopicIds.includes(t.id))
          : [wholeDocumentTopic(activeDoc)];

      const result = await generateCards({
        doc: activeDoc,
        topics: activeTopics,
        settings: {
          density,
          depth,
          citationMode,
          mode: targetMode,
          tagPrefix: part1,
          subject,
          topic: effectiveTopic.value,
          firstLineAsTopic,
        },
        hasImageForPage: () =>
          citationMode !== 'page' && !!extraction?.pdf && activeDoc.hasRealPages,
        onProgress: setProgress,
        callModel: createGeminiCaller(apiKey),
      });

      setCards(result.cards);

      const notes = [...result.limitations];
      if (result.duplicateCount > 0) {
        notes.push(`${result.duplicateCount} duplicate card(s) were removed.`);
      }
      if (result.rejected.length > 0) {
        notes.push(
          `${result.rejected.length} malformed card(s) were discarded: ${[
            ...new Set(result.rejected.flatMap(r => r.problems)),
          ]
            .slice(0, 3)
            .join('; ')}.`,
        );
      }
      for (const failed of result.failedBatches) {
        notes.push(
          `Batch "${failed.topic}" (pages ${failed.pages.join(', ')}) failed: ${failed.error}`,
        );
      }

      if (result.cards.length === 0) {
        setError(
          result.failedBatches.length > 0
            ? 'No cards could be generated. See the notes below.'
            : 'The model returned no usable cards for this selection.',
        );
      }

      if (citationMode !== 'page') {
        const renderedImages = await renderCitedPages(result.cards);
        setImages(renderedImages);
        const urls = new Map<string, string>();
        for (const [key, image] of renderedImages) {
          urls.set(key, URL.createObjectURL(new Blob([image.bytes.slice().buffer as ArrayBuffer], {type: 'image/jpeg'})));
        }
        setImageUrls(urls);

        const missing = result.cards.filter(
          c => c.source?.imageKey && !renderedImages.has(c.source.imageKey),
        ).length;
        if (missing > 0) {
          notes.push(
            `${missing} card(s) have no source page image; their citation keeps the page reference.`,
          );
        }
      }

      setLimitations([...new Set(notes)]);
      setStatus(null);
    } catch (err) {
      console.error(err);
      setError(
        (err as Error)?.message
          ? `Generation failed: ${(err as Error).message}`
          : 'Generation failed. Check your API key and input.',
      );
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  };

  // --- Exports ---

  const deckName = useMemo(() => {
    const parts = splitPrefix(part1);
    return parts.length > 0 ? parts.join('::') : 'AnKing Card Studio';
  }, [part1]);

  const baseName = exportBaseName(doc?.fileName ?? 'flashcards');

  const withBusy = async (label: string, run: () => Promise<void>) => {
    setBusyExport(label);
    setError(null);
    try {
      await run();
    } catch (err) {
      console.error(err);
      setError(`Export failed: ${(err as Error)?.message ?? 'unknown error'}`);
    } finally {
      setBusyExport(null);
    }
  };

  const copyTsv = () => {
    if (cards.length === 0) return;
    navigator.clipboard.writeText(toTsv(cards));
    setStatus('Copied Front / Back / Citation / Tags as TSV');
    setTimeout(() => setStatus(null), 2500);
  };

  const exportXlsx = () =>
    withBusy('xlsx', async () => {
      const result = await buildWorkbook({
        cards,
        images,
        embedImages: citationMode !== 'page',
        includeQcSheet: true,
        qcNotes: limitations,
      });
      downloadBytes(result.bytes, `${baseName}.xlsx`, XLSX_MIME);
      setStatus(
        result.embeddedImages > 0
          ? `Workbook exported with ${result.embeddedImages} embedded page image(s).`
          : 'Workbook exported.',
      );
    });

  const exportApkg = () =>
    withBusy('apkg', async () => {
      const result = await buildApkg({
        cards,
        deckName,
        images,
        includeMedia: citationMode !== 'page',
      });
      downloadBytes(result.bytes, `${baseName}.apkg`, APKG_MIME);
      setStatus(
        `Deck exported: ${result.noteCount} note(s), ${result.cardCount} card(s), ${result.mediaCount} packaged image(s).`,
      );
    });

  const exportBundle = () =>
    withBusy('bundle', async () => {
      const workbook = await buildWorkbook({
        cards,
        images,
        embedImages: citationMode !== 'page',
        includeQcSheet: true,
        qcNotes: limitations,
      });
      const apkg = await buildApkg({
        cards,
        deckName,
        images,
        includeMedia: citationMode !== 'page',
      });
      const zip = await buildBundle({
        cards,
        images,
        workbook: workbook.bytes,
        workbookName: `${baseName}.xlsx`,
        apkg: apkg.bytes,
        apkgName: `${baseName}.apkg`,
      });
      downloadBytes(zip, `${baseName}-bundle.zip`, ZIP_MIME);
      setStatus('Bundle exported with workbook, deck, TSV and source page images.');
    });

  const clearAll = () => {
    setSourceText('');
    setCards([]);
    setImages(new Map());
    setImageUrls(new Map());
    setLimitations([]);
    setError(null);
    setStatus(null);
  };

  const tagPreview = `${splitPrefix(part1).join('::') || 'part_1'}::${
    subject.trim() ? subject.trim().replace(/\s+/g, '_') : '[Subject]'
  }::${
    effectiveTopic.value
      ? effectiveTopic.value.replace(/\s+/g, '_')
      : firstLineAsTopic && !doc
        ? '[1st Line in Source]'
        : '[Topic]'
  }`;

  const citationSummary =
    citationMode === 'page' ? 'PAGE REF' : citationMode === 'image' ? 'PAGE IMAGE' : 'REF + IMAGE';

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 bg-white border-b border-slate-200 shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-xl">
            A
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800 tracking-tight leading-none">
              AnKing Card Studio
            </h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">
              Medical Flashcard Generator
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-md text-[10px] font-mono text-slate-600 border border-slate-200">
            <span
              className={`w-2 h-2 rounded-full ${
                generationMode === 'one_question_max_3' ? 'bg-amber-500' : 'bg-emerald-500'
              } animate-pulse`}
            />
            Mode: {generationMode === 'one_question_max_3' ? '1 Question (Max 3 Cards)' : 'Default'}
          </div>
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-md text-[10px] font-mono text-slate-600 border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Tag: {tagPreview}
          </div>
          <button
            onClick={copyTsv}
            disabled={cards.length === 0}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2">
            {status?.startsWith('Copied') ? <CheckCircle2 size={16} /> : <ClipboardCopy size={16} />}
            {status?.startsWith('Copied') ? 'Copied TSV' : 'Copy TSV for Anki'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-6 lg:p-8 gap-6 max-w-[1600px] mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
          {/* Left Column: Input Panel */}
          <section className="lg:col-span-4 flex flex-col gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-5">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <BookOpen size={14} />
                    Tag Structure
                  </h2>
                  <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded font-medium">
                    prefix::Subject::Topic
                  </span>
                </div>

                {/* Real-time live tag preview */}
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px] text-slate-700 break-all flex items-center gap-1 flex-wrap">
                  <span className="text-slate-400 font-sans text-[9px] font-bold uppercase tracking-wider mr-1">
                    Preview:
                  </span>
                  <span className="text-indigo-600 font-bold bg-indigo-50/80 px-1 py-0.5 rounded border border-indigo-100">
                    {splitPrefix(part1).join('::') || 'part_1'}
                  </span>
                  <span className="text-slate-400 font-bold">::</span>
                  <span className="text-amber-700 font-semibold bg-amber-50/80 px-1 py-0.5 rounded border border-amber-100">
                    {subject.trim() ? subject.trim().replace(/\s+/g, '_') : '[Subject]'}
                  </span>
                  <span className="text-slate-400 font-bold">::</span>
                  <span className="text-violet-700 font-semibold bg-violet-50/80 px-1 py-0.5 rounded border border-violet-100">
                    {effectiveTopic.value
                      ? effectiveTopic.value.replace(/\s+/g, '_')
                      : firstLineAsTopic && !doc
                        ? '[1st Line in Source]'
                        : doc
                          ? '[Detected topic]'
                          : '[Topic]'}
                  </span>
                </div>

                {/* Tag prefix */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
                      <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 inline-flex items-center justify-center text-[9px] font-bold">
                        1
                      </span>
                      Tag Prefix
                    </label>
                    <span className="text-[9px] text-slate-400 font-mono">
                      `::` nests, e.g. MRCP::Passmedicine_notes
                    </span>
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. MRCP::Passmedicine_notes"
                    value={part1}
                    onChange={e => setPart1(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs font-mono"
                  />
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {['EMLE', 'MRCP::Passmedicine_notes', 'Pastest_mistakes', 'MRCP_Part_1'].map(
                      p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPart1(p)}
                          className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                            part1 === p
                              ? 'bg-indigo-600 text-white border-indigo-600 font-medium'
                              : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                          }`}>
                          {p}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                {/* Subject override */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
                      <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-700 inline-flex items-center justify-center text-[9px] font-bold">
                        2
                      </span>
                      Subject
                    </label>
                    <span className="text-[9px] text-slate-400 font-mono">
                      auto-detects if empty
                    </span>
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. Cardiology, Neurology (or blank to auto-detect)"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs font-mono"
                  />
                </div>

                {/* Topic override & first-line option */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
                      <span className="w-4 h-4 rounded-full bg-violet-100 text-violet-700 inline-flex items-center justify-center text-[9px] font-bold">
                        3
                      </span>
                      Topic
                    </label>
                    <span className="text-[9px] text-slate-400 font-mono">
                      {doc ? 'per-topic if empty' : 'auto-detects if empty'}
                    </span>
                  </div>

                  {!doc && (
                    <div
                      className={`p-2.5 rounded-lg border transition-all ${
                        firstLineAsTopic
                          ? 'bg-violet-50/70 border-violet-200 shadow-2xs'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100/60'
                      }`}>
                      <label className="flex items-center justify-between cursor-pointer select-none">
                        <div className="flex items-center gap-2 pr-2">
                          <TagIcon
                            size={14}
                            className={firstLineAsTopic ? 'text-violet-600' : 'text-slate-400'}
                          />
                          <div>
                            <div className="text-xs font-semibold text-slate-800 leading-tight flex items-center gap-1.5">
                              First line is topic in tag
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                  firstLineAsTopic
                                    ? 'bg-violet-600 text-white'
                                    : 'bg-slate-200 text-slate-600'
                                }`}>
                                {firstLineAsTopic ? 'ON' : 'OFF'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                              Uses the very first line of your pasted text as the Topic component.
                            </p>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={firstLineAsTopic}
                          onChange={e => handleFirstLineAsTopicChange(e.target.checked)}
                          className="w-4 h-4 text-violet-600 rounded border-slate-300 focus:ring-violet-500 cursor-pointer accent-violet-600 shrink-0"
                        />
                      </label>

                      {firstLineAsTopic && (
                        <div className="mt-2 pt-2 border-t border-violet-100/80 flex items-center justify-between text-[10px]">
                          <span className="text-slate-500 font-medium">Detected from line 1:</span>
                          <span className="font-mono font-bold text-violet-700 bg-white px-1.5 py-0.5 rounded border border-violet-200 max-w-[200px] truncate">
                            {extractFirstLineAsTopic(sourceText) || '(Type source content line 1)'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <input
                    type="text"
                    disabled={firstLineAsTopic && !doc}
                    placeholder={
                      firstLineAsTopic && !doc
                        ? `(Disabled: Using 1st line "${extractFirstLineAsTopic(sourceText) || '...'}")`
                        : doc
                          ? 'Blank uses each detected topic per card'
                          : 'e.g. Aortic_Stenosis (or blank to auto-detect)'
                    }
                    value={topic}
                    onChange={e => setTopic(e.target.value)}
                    className={`w-full px-3 py-1.5 border rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs font-mono ${
                      firstLineAsTopic && !doc
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                        : 'bg-slate-50 text-slate-800 border-slate-200'
                    }`}
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <OptionsPanel
                  density={density}
                  onDensityChange={setDensity}
                  depth={depth}
                  onDepthChange={setDepth}
                  citationMode={citationMode}
                  onCitationModeChange={setCitationMode}
                  availableModes={citationModes}
                  citationHint={
                    citationModes.length === 1
                      ? doc
                        ? 'Page images need a PDF; this source has no renderable pages.'
                        : 'Upload a PDF to attach source page images.'
                      : 'Page images are rendered from the PDF and packaged into the Anki deck.'
                  }
                />
              </div>

              {/* Mode Selection Tabs */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
                  <span>Card Strategy Mode</span>
                  <span
                    className={`font-mono text-[9px] px-1.5 py-0.5 rounded font-medium ${
                      generationMode === 'one_question_max_3'
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}>
                    {generationMode === 'one_question_max_3' ? 'Max 3 Cards' : 'Full Topic Cards'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setGenerationMode('default')}
                    className={`py-1.5 px-2 rounded-md text-xs font-semibold transition-all ${
                      generationMode === 'default'
                        ? 'bg-white text-slate-800 shadow-sm border border-slate-200'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}>
                    Default Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setGenerationMode('one_question_max_3')}
                    className={`py-1.5 px-2 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1 ${
                      generationMode === 'one_question_max_3'
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}>
                    1 Question (Max 3)
                  </button>
                </div>
              </div>

              <SourcePanel
                sourceText={sourceText}
                onSourceTextChange={setSourceText}
                doc={doc}
                isLoadingFile={isLoadingFile}
                fileError={fileError}
                onFileSelected={handleFileSelected}
                onClearFile={handleClearFile}
                placeholder={
                  generationMode === 'one_question_max_3'
                    ? 'Paste 1 question or clinical vignette here to generate 1, 2, or 3 cards maximum...'
                    : 'Paste clinical notes, clinical facts, lists of questions, or exam questions here to convert them into high-yielding cloze flashcards...'
                }
              />

              {doc && topics.length > 0 && (
                <div className="border-t border-slate-100 pt-4">
                  <TopicPicker
                    doc={doc}
                    topics={topics}
                    selectedIds={selectedTopicIds}
                    onChange={setSelectedTopicIds}
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => generate('one_question_max_3')}
                  disabled={isGenerating}
                  className={`w-full py-2.5 px-4 text-xs font-bold uppercase tracking-widest rounded-lg transition-all shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 ${
                    generationMode === 'one_question_max_3'
                      ? 'bg-amber-600 text-white hover:bg-amber-700 ring-2 ring-amber-400/30'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300'
                  }`}>
                  {isGenerating && generationMode === 'one_question_max_3' ? (
                    <>
                      <div className="w-4 h-4 border-2 border-amber-300 border-t-white rounded-full animate-spin" />
                      Creating 1-3 Cards...
                    </>
                  ) : (
                    <>
                      <Sparkles size={15} />
                      1 Question &#8594; 1-3 Cards Max
                    </>
                  )}
                </button>

                <button
                  onClick={() => generate('default')}
                  disabled={isGenerating}
                  className={`w-full py-2.5 px-4 text-xs font-bold uppercase tracking-widest rounded-lg transition-all shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 ${
                    generationMode === 'default'
                      ? 'bg-slate-800 text-white hover:bg-slate-900 ring-2 ring-slate-400/20'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                  }`}>
                  {isGenerating && generationMode === 'default' ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-400 border-t-white rounded-full animate-spin" />
                      Generating Cards...
                    </>
                  ) : (
                    <>
                      <Sparkles size={15} />
                      Generate Cards (Default)
                    </>
                  )}
                </button>
              </div>

              {progress && (
                <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-indigo-800">
                    <span className="flex items-center gap-1.5">
                      <Loader2 size={11} className="animate-spin" />
                      {progress.currentTopic}
                    </span>
                    <span className="font-mono">
                      {progress.completedBatches}/{progress.totalBatches} batches
                    </span>
                  </div>
                  <div className="h-1.5 bg-indigo-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 transition-all"
                      style={{
                        width: `${(progress.completedBatches / Math.max(progress.totalBatches, 1)) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-indigo-700 font-mono">
                    {progress.cards} card(s) so far
                  </p>
                </div>
              )}

              {status && !status.startsWith('Copied') && (
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-emerald-800 text-xs flex items-start gap-2">
                  <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                  <span className="leading-tight">{status}</span>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-xs flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span className="leading-tight">{error}</span>
                </div>
              )}
            </div>
          </section>

          {/* Right Column: Output Panel */}
          <section className="lg:col-span-8 flex flex-col gap-4 min-h-[600px]">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <TableIcon size={14} />
                Generated Table View
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-widest bg-slate-100 text-slate-600 border border-slate-200">
                  Citation: {citationSummary}
                </span>
                <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-widest">
                  {cards.length} Cards Prepared
                </span>
              </div>
            </div>

            <CardTable cards={cards} imageUrls={imageUrls} />

            {limitations.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl space-y-1.5">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-amber-800 flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  Notes &amp; limitations for this run
                </h3>
                <ul className="list-disc pl-4 space-y-0.5">
                  {limitations.map(note => (
                    <li key={note} className="text-[11px] text-amber-900 leading-snug">
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        <ExportBar
          cardCount={cards.length}
          busy={busyExport}
          firstLineAsTopic={firstLineAsTopic}
          citationSummary={citationSummary}
          onClear={clearAll}
          onCopyTsv={copyTsv}
          onExportXlsx={exportXlsx}
          onExportApkg={exportApkg}
          onExportBundle={exportBundle}
        />
      </main>
    </div>
  );
}
