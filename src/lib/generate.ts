/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, Type} from '@google/genai';

import type {
  CitationMode,
  DocPage,
  Flashcard,
  GenerationSettings,
  SourceDocument,
  Topic,
} from '../types';
import {finalizeCards} from './cloze';
import {makeCardSource, renderCitation} from './citation';
import {buildBatchPrompt} from './prompt';
import {normalizeTagToken, buildTag, trailingComponentsFromModelTag} from './tags';
import {planBatches, type Batch} from './topics';

/**
 * Orchestrates generation: plan batches -> call Gemini per batch -> attach
 * provenance -> validate and de-duplicate across the whole run.
 *
 * The Gemini client and model id are the ones the project already used. What
 * changed is the response format: structured JSON, with the original
 * markdown-table parser kept as a fallback for models that ignore the schema.
 */

export const DEFAULT_MODEL = 'gemini-3.8-flash';

export const resolveModel = (): string =>
  (typeof process !== 'undefined' && process.env?.GEMINI_MODEL) || DEFAULT_MODEL;

/** One card as returned by the model, before provenance and validation. */
export interface RawCard {
  front: string;
  back: string;
  tag_trailing?: string[];
  tag?: string;
  page_index?: number;
  uncertain?: boolean;
  note?: string;
}

const CARD_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cards: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          front: {type: Type.STRING, description: 'HTML cloze sentence using {{c1::...}}'},
          back: {type: Type.STRING, description: 'HTML explanation; no cloze'},
          tag_trailing: {
            type: Type.ARRAY,
            items: {type: Type.STRING},
            description: 'Tag components below the fixed prefix: [Subject, Topic]',
          },
          page_index: {
            type: Type.INTEGER,
            description: 'PAGE_INDEX of the source block this fact came from',
          },
          uncertain: {type: Type.BOOLEAN},
          note: {type: Type.STRING},
        },
        required: ['front', 'back', 'tag_trailing', 'page_index'],
      },
    },
  },
  required: ['cards'],
} as const;

/** Parses the model response, preferring JSON and falling back to a markdown table. */
export const parseModelResponse = (text: string): RawCard[] => {
  const json = tryParseJson(text);
  if (json) return json;
  return parseMarkdownTable(text);
};

const tryParseJson = (text: string): RawCard[] | null => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start));
    const cards = Array.isArray(parsed) ? parsed : parsed?.cards;
    if (!Array.isArray(cards)) return null;
    return cards
      .filter((c: unknown): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c): RawCard => ({
        front: String(c.front ?? c.text ?? ''),
        back: String(c.back ?? c.extra ?? ''),
        tag_trailing: Array.isArray(c.tag_trailing) ? c.tag_trailing.map(String) : undefined,
        tag: typeof c.tag === 'string' ? c.tag : undefined,
        page_index: Number.isFinite(Number(c.page_index)) ? Number(c.page_index) : undefined,
        uncertain: c.uncertain === true,
        note: typeof c.note === 'string' ? c.note : undefined,
      }))
      .filter(c => c.front.trim() !== '');
  } catch {
    return null;
  }
};

/** The original 3-column markdown table format, retained as a fallback. */
export const parseMarkdownTable = (text: string): RawCard[] =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(
      line =>
        line.startsWith('|') &&
        line.endsWith('|') &&
        !line.includes('---') &&
        !/\|\s*(text|front)\s*\|/i.test(line),
    )
    .map(row => {
      const cells = row.split('|').map(c => c.trim());
      const pageCell = cells[4] ?? '';
      const page = /(\d+)/.exec(pageCell);
      return {
        front: cells[1] ?? '',
        back: cells[2] ?? '',
        tag: cells[3] ?? '',
        page_index: page ? Number(page[1]) : undefined,
      };
    })
    .filter(c => c.front !== '');

export interface GenerateProgress {
  completedBatches: number;
  totalBatches: number;
  cards: number;
  currentTopic: string;
}

export interface GenerateOptions {
  doc: SourceDocument;
  topics: Topic[];
  settings: GenerationSettings;
  /** Resolves true when a page image is (or will be) available for this page. */
  hasImageForPage?: (pageIndex: number) => boolean;
  onProgress?: (progress: GenerateProgress) => void;
  /** Injected for tests; defaults to a real Gemini call. */
  callModel?: (prompt: string) => Promise<string>;
  signal?: AbortSignal;
}

export interface GenerateResult {
  cards: Flashcard[];
  /** Cards dropped as duplicates, by count. */
  duplicateCount: number;
  /** Cards dropped as unusable, with the reasons. */
  rejected: Array<{front: string; problems: string[]}>;
  /** Batches that failed outright, so partial results are still reported honestly. */
  failedBatches: Array<{topic: string; pages: number[]; error: string}>;
  limitations: string[];
}

export const createGeminiCaller = (apiKey: string, model = resolveModel()) => {
  const ai = new GoogleGenAI({apiKey});
  return async (prompt: string): Promise<string> => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: CARD_SCHEMA as never,
      },
    });
    return response.text ?? '';
  };
};

/** Picks the source page for a card, never accepting a page outside the batch. */
export const resolvePage = (batch: Batch, pageIndex: number | undefined): DocPage | undefined => {
  if (pageIndex != null) {
    const exact = batch.pages.find(p => p.pageIndex === pageIndex);
    if (exact) return exact;
  }
  // A page the model invented is not usable as provenance. Fall back to the
  // only unambiguous answer: the single page of a one-page batch, else none.
  return batch.pages.length === 1 ? batch.pages[0] : undefined;
};

export const generateCards = async (options: GenerateOptions): Promise<GenerateResult> => {
  const {doc, topics, settings, onProgress, signal} = options;
  const callModel = options.callModel ?? mustHaveCaller();
  const hasImageForPage = options.hasImageForPage ?? (() => doc.canRenderPages && doc.hasRealPages);

  const batches = planBatches(doc, topics);
  const seen = new Set<string>();
  const cards: Flashcard[] = [];
  const rejected: GenerateResult['rejected'] = [];
  const failedBatches: GenerateResult['failedBatches'] = [];
  const limitations = new Set<string>();
  let duplicateCount = 0;
  let completedBatches = 0;

  const fixedSubject = normalizeTagToken(settings.subject) || undefined;
  const fixedTopic = normalizeTagToken(settings.topic) || undefined;

  for (const batch of batches) {
    if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');

    try {
      const prompt = buildBatchPrompt({doc, batch, settings, fixedSubject, fixedTopic});
      const text = await callModel(prompt);
      let raw = parseModelResponse(text);

      if (raw.length === 0) {
        failedBatches.push({
          topic: batch.topic.title,
          pages: batch.pages.map(p => p.pageIndex),
          error: 'The model returned nothing parsable for this batch.',
        });
        continue;
      }

      if (settings.mode === 'one_question_max_3') raw = raw.slice(0, 3);

      const prepared = raw.map(item => {
        const page = resolvePage(batch, item.page_index);
        if (!page) {
          limitations.add(
            `Some cards from "${batch.topic.title}" could not be tied to a single source page; their citation names the section only.`,
          );
        }
        const wantsImage = settings.citationMode !== 'page';
        const source = makeCardSource(
          doc,
          page,
          fixedTopic ? undefined : batch.topic.title,
          wantsImage,
        );
        const imageAvailable = !!page && hasImageForPage(page.pageIndex);
        const citation = renderCitation(source, settings.citationMode, imageAvailable);
        if (citation.limitation) limitations.add(citation.limitation);

        const trailing = item.tag_trailing?.length
          ? item.tag_trailing
          : trailingComponentsFromModelTag(item.tag ?? '', settings.tagPrefix);
        // A single component is the specific topic, not the subject.
        const modelSubject = trailing.length >= 2 ? trailing[0] : undefined;
        const modelTopic =
          trailing.length >= 2 ? trailing.slice(1).join('_') : trailing[0];

        const card: Flashcard = {
          text: item.front,
          extra: item.back,
          tag: buildTag({
            prefix: settings.tagPrefix,
            trailing: [fixedSubject ?? modelSubject, fixedTopic ?? modelTopic],
            fallback: ['General_Medicine', normalizeTagToken(batch.topic.title) || 'General'],
          }),
          citation: citation.text,
          source: citation.imageKey ? source : {...source, imageKey: undefined},
        };
        if (item.uncertain) {
          card.review = [item.note?.trim() || 'Flagged by the model as uncertain; verify before study.'];
        }
        return card;
      });

      const result = finalizeCards(prepared, {seen});
      cards.push(...result.cards);
      duplicateCount += result.duplicates.length;
      rejected.push(
        ...result.rejected.map(r => ({front: r.card.text, problems: r.problems})),
      );
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      failedBatches.push({
        topic: batch.topic.title,
        pages: batch.pages.map(p => p.pageIndex),
        error: (err as Error)?.message ?? String(err),
      });
    } finally {
      completedBatches += 1;
      onProgress?.({
        completedBatches,
        totalBatches: batches.length,
        cards: cards.length,
        currentTopic: batch.topic.title,
      });
    }
  }

  for (const warning of doc.warnings) limitations.add(warning);

  return {
    cards,
    duplicateCount,
    rejected,
    failedBatches,
    limitations: [...limitations],
  };
};

const mustHaveCaller = () => {
  const apiKey = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || '';
  if (!apiKey) {
    return async (): Promise<string> => {
      throw new Error('GEMINI_API_KEY is not configured.');
    };
  }
  return createGeminiCaller(apiKey);
};

/** Which citation modes make sense for a given document. */
export const availableCitationModes = (doc: SourceDocument | null): CitationMode[] =>
  doc?.canRenderPages && doc.hasRealPages ? ['page', 'image', 'both'] : ['page'];
