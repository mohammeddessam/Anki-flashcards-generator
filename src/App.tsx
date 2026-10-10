/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { 
  ClipboardCopy, 
  Sparkles, 
  Stethoscope, 
  Tag as TagIcon, 
  BookOpen, 
  AlertCircle,
  CheckCircle2,
  Table as TableIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Flashcard {
  text: string;
  extra: string;
  tag: string;
}

// --- App Component ---
export default function App() {
  const [sourceText, setSourceText] = useState('');
  const [part1, setPart1] = useState(() => localStorage.getItem('anki_part1') || 'EMLE');
  const [subject, setSubject] = useState(() => localStorage.getItem('anki_subject') || '');
  const [topic, setTopic] = useState(() => localStorage.getItem('anki_topic') || '');
  const [firstLineAsTopic, setFirstLineAsTopic] = useState<boolean>(() => {
    const saved = localStorage.getItem('anki_first_line_as_topic');
    return saved !== null ? saved === 'true' : false;
  });
  const [generationMode, setGenerationMode] = useState<'default' | 'one_question_max_3'>('default');
  const [isGenerating, setIsGenerating] = useState(false);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const handleFirstLineAsTopicChange = (enabled: boolean) => {
    setFirstLineAsTopic(enabled);
    localStorage.setItem('anki_first_line_as_topic', String(enabled));
  };

  const handlePart1Change = (val: string) => {
    setPart1(val);
    localStorage.setItem('anki_part1', val);
  };

  const handleSubjectChange = (val: string) => {
    setSubject(val);
    localStorage.setItem('anki_subject', val);
  };

  const handleTopicChange = (val: string) => {
    setTopic(val);
    localStorage.setItem('anki_topic', val);
  };

  // Helper to extract clean first line from source content for Topic
  const extractFirstLineAsTopic = (text: string): string => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    const firstLine = lines[0]
      .replace(/^#+\s*/, '') // Remove markdown heading hashes
      .replace(/^[\*\-\•\d+\.]+\s*/, '') // Remove leading bullets or list numbering
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/[:：\-\–\|\t]+$/g, '') // Remove trailing punctuation
      .trim();
    return firstLine;
  };

  const getEffectiveTopic = (): { topicValue: string; isFromFirstLine: boolean } => {
    if (firstLineAsTopic) {
      const extracted = extractFirstLineAsTopic(sourceText);
      if (extracted) {
        return { topicValue: extracted, isFromFirstLine: true };
      }
    }
    return { topicValue: topic.trim(), isFromFirstLine: false };
  };

  const generateCards = async (targetMode: 'default' | 'one_question_max_3' = generationMode) => {
    if (!sourceText.trim()) {
      setError('Please provide Source Content (notes or questions) to generate flashcards.');
      return;
    }

    setGenerationMode(targetMode);
    setIsGenerating(true);
    setError(null);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

      const sanitizedPart1 = part1.trim().replace(/\s+/g, '_') || 'EMLE';
      const sanitizedSubject = subject.trim().replace(/\s+/g, '_');
      
      const { topicValue: effectiveTopicRaw, isFromFirstLine } = getEffectiveTopic();
      const sanitizedTopic = effectiveTopicRaw.replace(/\s+/g, '_');
      const isOneQuestionMode = targetMode === 'one_question_max_3';

      const prompt = `
        You are an elite AnKing-style flashcard generator for medical licensing exams (EMLE / MRCP).
        Your task is to convert the SOURCE text into a table of cloze-deletion flashcards, AND for each card, independently identify the 3-part tag classification:
        1. Part 1: Tag prefix "${sanitizedPart1}".
        2. Part 2 (Subject): The organ system or subspecialty (e.g., Cardiology, Gastroenterology, Neurology, Nephrology, Hematology, Endocrinology, Respiratory, Rheumatology, Infectious_Diseases, Orthopedics, Obstetrics, Surgery, Pediatrics). ${sanitizedSubject ? `Use "${sanitizedSubject}" as specified by the user.` : `Identify the appropriate subject automatically from the clinical context.`}
        3. Part 3 (Topic): The specific disease, drug, condition, or clinical entity (e.g., Aortic_Stenosis, Factor_VII_deficiency, Multiple_Sclerosis, Migraine, Appendicitis, Pre_eclampsia). ${sanitizedTopic ? (isFromFirstLine ? `CRITICAL TOPIC OVERRIDE: The user enabled 'First line in source content is topic'. You MUST use "${sanitizedTopic}" as Part 3 (Topic) for all cards in this set.` : `Use "${sanitizedTopic}" as specified by the user for all cards.`) : `Identify the specific disease/condition topic automatically for each card from the text.`}

        SOURCE TEXT:
        "${sourceText}"

        STRICT TABLE FORMAT:
        Output ONLY a markdown table with exactly these columns (must match casing): | text | extra | tag |

        TAG FORMATTING RULE (3-PART HIERARCHICAL SPECIFICATION: part_1::Subject::Topic):
        The "tag" column MUST be formatted strictly as:
        ${sanitizedPart1}::[Subject]::[Topic]
        - Part 1 prefix: "${sanitizedPart1}"
        - Part 2 (Subject) examples: Cardiology, Neurology, Gastroenterology, Nephrology, Hematology, Orthopedics, Obstetrics, etc. ${sanitizedSubject ? `(User specified: "${sanitizedSubject}")` : ''}
        - Part 3 (Topic) examples: Aortic_Stenosis, Appendicitis, Factor_VII_deficiency, Multiple_Sclerosis, etc. ${sanitizedTopic ? `(User specified: "${sanitizedTopic}")` : ''}
        - All spaces inside Part 1, Subject, and Topic MUST be replaced with underscores (e.g. ${sanitizedPart1}::Cardiology::Aortic_Stenosis).

        ${isOneQuestionMode ? `
        =======================================================
        CRITICAL GENERATION MODE: 1 QUESTION -> 1 TO 3 CARDS MAX
        =======================================================
        - The user has requested the "1 Question 3 Cards" mode.
        - Treat the SOURCE TEXT as ONE question or clinical vignette.
        - STRICT CARD LIMIT: Generate AT LEAST 1 and AT MOST 3 cards total (1, 2, or 3 cards MAXIMUM).
        - DO NOT generate more than 3 cards under any circumstances.
        - Select only the most critical, high-yield learning points from this single question:
          * Card 1: Core clinical question / diagnosis / management question anchor in cloze format.
          * Card 2 (if high-yield): The key diagnostic test / first-line investigation, classic sign, or mechanism.
          * Card 3 (if high-yield): A crucial differential diagnosis clue, pharmacological mechanism, or exam pitfall.
        - If the question only has 1 or 2 high-yield points, produce only 1 or 2 cards.
        =======================================================
        ` : `
        =======================================================
        CRITICAL GENERATION MODE: DEFAULT (COMPREHENSIVE FULL TOPIC)
        =======================================================
        - Treat the input as comprehensive medical notes, full topics, or multi-question sets.
        - STRICTOR REQUIREMENT: Every single distinct fact, medical note, symptom, drug, mechanism, or clinical feature provided in the SOURCE TEXT MUST be represented by at least one dedicated flashcard. You are strictly forbidden from omitting, skipping, or glossing over any queries or facts present in the inputs.
        - Extract all important facts (such as pathogenesis, clinical features, investigations, management, etc.) into separate, individual high-yield cloze cards.
        - Aggregation Strategy: For groups like Adverse Effects, Clinical Features, or Investigations, create ONE summary card listing all items in a single cloze {{c1::<ol><li>Item 1</li><li>Item 2</li></ol>}}, THEN create separate individual cards for each important item, especially if it has specific details or is the "most common/important".
        - EXAM HIGH-YIELD CARDS (EMLE / MRCP PART 1): If there is any additional high-yield clinical information, pathophysiological concept, diagnostic values, laboratory thresholds, inheritance patterns, risk factors, or associations mentioned in the questions, options, or explanation text, you MUST make additional separate cards for it.
        =======================================================
        `}

        COMMON CONTENT RULES (STRICT HTML ONLY):
        1. "text" column: Contains a high-yield clinical fact or question. The answer MUST be inside a cloze: {{c1::answer}}.
        2. "extra" column (Column 2 - Explanation with Causal Arrows '→'):
           - MUST be a full, clinical explanation of the science, physiology, pharmacology, or pathology behind the fact in the "text" column.
           - CRITICAL REQUIREMENT: YOU MUST USE SEQUENTIAL CAUSAL ARROWS ('→') to trace the mechanism step-by-step:
             Format: [Trigger/Cause] → [Physiological mechanism / Pathological cascade] → [Intermediate effect] → [Clinical finding / Outcome].
           - Use the arrow symbol '→' (or '->') to connect each step in the chain of events explaining "how" and "why" things happen.
           - DO NOT use conversational meta-phrases ('This is because...', 'Here is the mechanism:'); provide the explanation directly in italics (<i>...</i>) with arrows: e.g. <i>Trigger → Step 1 → Step 2 → Manifestation.</i>
        3. Phrasing: Use exam-style anchors like "What is...", "Which...", "The <u>most common</u>...", "The <u>first-line</u>...".
        4. Bold/Underline/Italics:
           - NEVER use markdown stars/underscores. ONLY use <b>, <u>, and <i>.
           - For each card, the specific identified topic or disease name MUST be <b>bolded</b> as <b>[Topic Name]</b> in the "text" column.
           - The target keyword or question anchor MUST be <u>underlined</u> as <u>...</u> in the "text" column.
           - CRITICAL RULE FOR DISEASE NAME IN ANSWER: In case the name of the disease, drug, or medical condition is the answer (i.e., inside the cloze {{c1::...}}), you MUST NOT bold the answer inside the cloze. Instead, in this scenario, you MUST bold the main question or core sentence (e.g., <b>What is the most likely bleeding disorder?</b>) and underline the key clinical findings, indicators, or clues in the text using <u>...</u> (e.g., <u>prolonged prothrombin time (PT)</u>; <u>normal aPTT</u>). You can and should underline multiple separate keywords, clues, or phrases in the text.
        5. Etiology Format: Use "A <u>[category]</u> cause of <b>[Topic Name]</b> is {{c1::[answer]}}".
        6. No Commas: Replace all commas with semicolons or periods to ensure CSV compatibility.
        7. Case Based: If the text is a case, generate: most common etiology, investigation of choice, first-line investigation, treatment of choice, and a diagnostic vignette card.
        8. Question Marks: Every time a question mark "?" appears in the "text" column, you MUST write "<br><br>" immediately after it (e.g., "What is the <u>investigation of choice</u> for <b>Multiple Sclerosis</b>?<br><br>{{c1::MRI Brain}}").
        9. EXPLICIT QUESTION HANDLING (WHEN DETECTED):
           - If the user provides an MCQ or question, convert into a dedicated Q/A flashcard with a cloze-deletion.
           - Ensure the answer in the cloze {{c1::...}} is NOT bolded or underlined.
           - Pair the matching clinical explanation directly with its specific question in the "extra" column.

        Example Rows:
        | What is the <u>classic clinical triad</u> associated with <b>Aortic Stenosis</b>?<br><br>{{c1::<ol><li>Angina</li><li>Syncope</li><li>Dyspnoea</li></ol>}} | <i>Stenosed aortic valve → left ventricular outflow obstruction → concentric LV hypertrophy & increased myocardial oxygen demand → exertional subendocardial ischemia & cerebral hypoperfusion → angina → syncope → dyspnea.</i> | ${sanitizedPart1}::Cardiology::Aortic_Stenosis |
        | A 24-year-old male presents with right lower quadrant pain and fever. <b>What is the most likely diagnosis?</b><br><br>{{c1::Acute Appendicitis}} | <i>Appendiceal lumen obstruction (fecalith) → luminal distension & bacterial overgrowth → elevated intraluminal pressure → venous stasis & transmural ischemia → acute appendiceal inflammation & localized peritonitis.</i> | ${sanitizedPart1}::Gastroenterology::Appendicitis |

        Output only the table. No intro or outro.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt
      });
      
      let text = response.text || '';
      
      // Improved markdown table parsing
      const lines = text.split('\n');
      const dataRows = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.startsWith('|') && trimmed.endsWith('|') && !trimmed.includes('---') && !trimmed.toLowerCase().includes('| text |');
      });

      let parsedCards = dataRows.map(row => {
        const cells = row.split('|').map(c => c.trim());
        
        let cellText = cells[1] || '';
        let cellExtra = cells[2] || '';
        let cellTag = cells[3] || '';

        // Format helper for text and extra columns
        const formatCell = (val: string) => {
          return val
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/__(.*?)__/g, '<b>$1</b>')
            .replace(/\*(.*?)\*/g, '<i>$1</i>')
            .replace(/_(.*?)_/g, '<i>$1</i>');
        };

        // Arrow standardization helper for column 2 (explanation)
        const formatExplanationArrows = (val: string) => {
          return val
            .replace(/--+>/g, '→')
            .replace(/->/g, '→')
            .replace(/==+>/g, '→')
            .replace(/=>/g, '→')
            .replace(/&rarr;/gi, '→')
            .replace(/&#8594;/gi, '→')
            .replace(/\\rightarrow/gi, '→')
            .replace(/-\s*>/g, '→')
            .replace(/\s*→\s*/g, ' → ')
            .trim();
        };

        cellText = formatCell(cellText);
        cellExtra = formatExplanationArrows(formatCell(cellExtra));

        // Ensure any question mark "?" has "<br><br>" immediately after it, without duplicating
        cellText = cellText.replace(/\?\s*(?:<br\s*\/?>\s*)*/gi, '?<br><br>');

        // Tags formatting: ensure standard ${sanitizedPart1}::[Subject]::[Topic]
        let rawTag = cellTag
          .replace(/<\/?i>/gi, '')
          .replace(/<\/?[^>]+(>|$)/g, '')
          .replace(/^\(+|\)+$/g, '')
          .trim();

        // Split by '::' or '/' or colons
        let tagParts = rawTag
          .split(/::|\/|(?<=[a-zA-Z0-9]):(?=[a-zA-Z0-9])/)
          .map(p => p.trim().replace(/^_+|_+$/g, '').replace(/\s+/g, '_'))
          .filter(Boolean);

        // Remove leading prefix if present in parts (e.g. user prefix or common historical tags)
        if (tagParts.length > 0 && (
          tagParts[0].toLowerCase() === sanitizedPart1.toLowerCase() ||
          tagParts[0].toUpperCase() === 'EMLE' ||
          tagParts[0].toLowerCase() === 'pastest_mistakes' ||
          tagParts[0].toLowerCase() === 'passmedicine_topics'
        )) {
          tagParts.shift();
        }

        // If discipline was somehow returned as a middle part (3 parts remaining: [Discipline, Subject, Topic]), strip discipline
        if (tagParts.length >= 3) {
          tagParts.shift();
        }

        let detectedSubj = sanitizedSubject || 'General_Medicine';
        let detectedTopic = sanitizedTopic || 'General';

        if (tagParts.length >= 2) {
          detectedSubj = sanitizedSubject || tagParts[0];
          detectedTopic = sanitizedTopic || tagParts.slice(1).join('_');
        } else if (tagParts.length === 1) {
          detectedTopic = sanitizedTopic || tagParts[0];
        }

        if (sanitizedSubject) detectedSubj = sanitizedSubject;
        if (sanitizedTopic) detectedTopic = sanitizedTopic;

        const cleanToken = (val: string) => val.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');

        const sanitizedTag = `${cleanToken(sanitizedPart1)}::${cleanToken(detectedSubj)}::${cleanToken(detectedTopic)}`;

        return {
          text: cellText,
          extra: cellExtra,
          tag: sanitizedTag
        };
      }).filter(c => c.text !== '');

      // Strict enforcement for 1 Question -> Max 3 Cards mode
      if (isOneQuestionMode && parsedCards.length > 3) {
        parsedCards = parsedCards.slice(0, 3);
      }

      if (parsedCards.length === 0) {
        setError("Could not parse the AI response as a table. Please try again.");
      } else {
        setCards(parsedCards);
      }
    } catch (err: any) {
      console.error(err);
      setError('Failed to generate cards. Please check your API key or input.');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = () => {
    if (cards.length === 0) return;
    
    // Format for Excel: text [tab] extra [tab] tag
    const tsv = cards.map(c => `${c.text}\t${c.extra}\t${c.tag}`).join('\n');
    navigator.clipboard.writeText(tsv);
    setCopyStatus('Copied TSV for Excel/Anki');
    setTimeout(() => setCopyStatus(null), 2000);
  };

  const clearAll = () => {
    setSourceText('');
    setCards([]);
    setError(null);
  };

  // Helper to render Column 2 (extra) explanation with styled arrows for UI clarity
  const renderExplanation = (extraText: string) => {
    const hasItalics = /^<i>[\s\S]*<\/i>$/i.test(extraText.trim());
    const clean = extraText.replace(/^<i>|<\/i>$/gi, '').trim();

    if (!clean.includes('→')) {
      return <span className={hasItalics ? 'italic' : ''}>{clean}</span>;
    }

    const parts = clean.split('→');
    return (
      <span className={`${hasItalics ? 'italic' : ''} inline leading-relaxed`}>
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <span className="inline-flex items-center px-1 font-bold not-italic text-indigo-600 text-[13px] select-none mx-0.5">
                →
              </span>
            )}
            <span>{part.trim()}</span>
          </React.Fragment>
        ))}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 bg-white border-b border-slate-200 shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-xl">A</div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800 tracking-tight leading-none">AnKing Card Studio</h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Medical Flashcard Generator</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-md text-[10px] font-mono text-slate-600 border border-slate-200">
            <span className={`w-2 h-2 rounded-full ${generationMode === 'one_question_max_3' ? 'bg-amber-500' : 'bg-emerald-500'} animate-pulse`}></span>
            Mode: {generationMode === 'one_question_max_3' ? '1 Question (Max 3 Cards)' : 'Default (Full Topic)'}
          </div>
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-md text-[10px] font-mono text-slate-600 border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Tag: {part1.trim() || 'part_1'}::{subject.trim() ? subject.trim().replace(/\s+/g, '_') : '[Subject]'}::{getEffectiveTopic().topicValue ? getEffectiveTopic().topicValue.replace(/\s+/g, '_') : '[Topic]'}
          </div>
          <button 
            onClick={copyToClipboard}
            disabled={cards.length === 0}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {copyStatus ? <CheckCircle2 size={16} /> : <ClipboardCopy size={16} />}
            {copyStatus ? 'Copied TSV' : 'Copy TSV for Anki'}
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
                    Tag Structure (3 Parts)
                  </h2>
                  <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded font-medium">
                    part_1::Subject::Topic
                  </span>
                </div>

                {/* Real-time live tag preview */}
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px] text-slate-700 break-all flex items-center gap-1 flex-wrap">
                  <span className="text-slate-400 font-sans text-[9px] font-bold uppercase tracking-wider mr-1">Preview:</span>
                  <span className="text-indigo-600 font-bold bg-indigo-50/80 px-1 py-0.5 rounded border border-indigo-100">{part1.trim() || 'part_1'}</span>
                  <span className="text-slate-400 font-bold">::</span>
                  <span className="text-amber-700 font-semibold bg-amber-50/80 px-1 py-0.5 rounded border border-amber-100">{subject.trim() ? subject.trim().replace(/\s+/g, '_') : '[Subject]'}</span>
                  <span className="text-slate-400 font-bold">::</span>
                  <span className="text-violet-700 font-semibold bg-violet-50/80 px-1 py-0.5 rounded border border-violet-100">
                    {getEffectiveTopic().topicValue 
                      ? getEffectiveTopic().topicValue.replace(/\s+/g, '_') 
                      : (firstLineAsTopic ? '[1st Line in Source]' : '[Topic]')}
                  </span>
                </div>
                
                {/* Part 1: Tag Prefix */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
                      <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 inline-flex items-center justify-center text-[9px] font-bold">1</span>
                      Part 1 (Tag Prefix)
                    </label>
                    <span className="text-[9px] text-slate-400 font-mono">e.g. EMLE</span>
                  </div>
                  <input 
                    type="text" 
                    placeholder="e.g. EMLE, Pastest_mistakes, Passmedicine_Topics"
                    value={part1}
                    onChange={(e) => handlePart1Change(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs font-mono"
                  />
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {['EMLE', 'Pastest_mistakes', 'Passmedicine_Topics', 'MRCP_Part_1'].map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => handlePart1Change(p)}
                        className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                          part1 === p 
                            ? 'bg-indigo-600 text-white border-indigo-600 font-medium' 
                            : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Part 2: Subject Override */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
                      <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-700 inline-flex items-center justify-center text-[9px] font-bold">2</span>
                      Part 2: Subject
                    </label>
                    <span className="text-[9px] text-slate-400 font-mono">auto-detects if empty</span>
                  </div>
                  <input 
                    type="text" 
                    placeholder="e.g. Cardiology, Neurology (or blank to auto-detect)"
                    value={subject}
                    onChange={(e) => handleSubjectChange(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs font-mono"
                  />
                </div>

                {/* Part 3: Topic Override & First Line Option */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
                      <span className="w-4 h-4 rounded-full bg-violet-100 text-violet-700 inline-flex items-center justify-center text-[9px] font-bold">3</span>
                      Part 3: Topic
                    </label>
                    <span className="text-[9px] text-slate-400 font-mono">auto-detects if empty</span>
                  </div>

                  {/* Toggle Option: First Line in Source Content is Topic */}
                  <div className={`p-2.5 rounded-lg border transition-all ${
                    firstLineAsTopic 
                      ? 'bg-violet-50/70 border-violet-200 shadow-2xs' 
                      : 'bg-slate-50 border-slate-200 hover:bg-slate-100/60'
                  }`}>
                    <label className="flex items-center justify-between cursor-pointer select-none">
                      <div className="flex items-center gap-2 pr-2">
                        <TagIcon size={14} className={firstLineAsTopic ? 'text-violet-600' : 'text-slate-400'} />
                        <div>
                          <div className="text-xs font-semibold text-slate-800 leading-tight flex items-center gap-1.5">
                            First line is topic in tag
                            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                              firstLineAsTopic ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-600'
                            }`}>
                              {firstLineAsTopic ? 'ON' : 'OFF'}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                            Uses the very first line of your source text as Part 3 (Topic) in the tag.
                          </p>
                        </div>
                      </div>
                      <input 
                        type="checkbox"
                        checked={firstLineAsTopic}
                        onChange={(e) => handleFirstLineAsTopicChange(e.target.checked)}
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

                  <input 
                    type="text" 
                    disabled={firstLineAsTopic}
                    placeholder={
                      firstLineAsTopic 
                        ? `(Disabled: Using 1st line "${extractFirstLineAsTopic(sourceText) || '...'}")` 
                        : "e.g. Aortic_Stenosis, Appendicitis (or blank to auto-detect)"
                    }
                    value={topic}
                    onChange={(e) => handleTopicChange(e.target.value)}
                    className={`w-full px-3 py-1.5 border rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs font-mono ${
                      firstLineAsTopic 
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' 
                        : 'bg-slate-50 text-slate-800 border-slate-200'
                    }`}
                  />
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {firstLineAsTopic
                      ? "When ON, the first line of your source text is dynamically extracted as the topic for all generated cards."
                      : "You can provide any or all three parts. Subject and Topic are automatically identified by the AI if left empty."}
                  </p>
                </div>

                {/* Column 2 Explanation Arrows Feature Badge */}
                <div className="flex items-center gap-2 p-2 bg-indigo-50/60 border border-indigo-100 rounded-lg text-[10px] text-indigo-800">
                  <span className="font-bold text-indigo-600 text-xs px-1 py-0.2 bg-white rounded border border-indigo-200 shadow-2xs font-mono">→</span>
                  <span className="leading-tight"><strong>Column 2 (Extra):</strong> Pathophysiological explanations use sequential flow arrows.</span>
                </div>
              </div>

              {/* Mode Selection Tabs */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
                  <span>Card Strategy Mode</span>
                  <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded font-medium ${
                    generationMode === 'one_question_max_3' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-600 border border-slate-200'
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
                    }`}
                  >
                    Default Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setGenerationMode('one_question_max_3')}
                    className={`py-1.5 px-2 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1 ${
                      generationMode === 'one_question_max_3'
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    1 Question (Max 3)
                  </button>
                </div>
              </div>

              {/* Source Content Input */}
              <div className="space-y-3 flex-1 flex flex-col min-h-[260px]">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Stethoscope size={14} />
                    Source Content
                  </h2>
                  <button onClick={() => setSourceText('')} className="text-[10px] text-slate-400 hover:text-red-500 underline uppercase tracking-widest">Clear</button>
                </div>
                <textarea 
                  placeholder={
                    generationMode === 'one_question_max_3'
                      ? "Paste 1 question or clinical vignette here to generate 1, 2, or 3 cards maximum..."
                      : "Paste clinical notes, clinical facts, lists of questions, or exam questions here to convert them into high-yielding cloze flashcards..."
                  }
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  className="flex-1 w-full p-4 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none transition-all resize-none text-sm leading-relaxed font-mono"
                />
              </div>
              
              {/* Action Buttons: 1 Question 3 Cards vs Default */}
              <div className="space-y-2 pt-1">
                <button 
                  onClick={() => generateCards('one_question_max_3')}
                  disabled={isGenerating}
                  className={`w-full py-2.5 px-4 text-xs font-bold uppercase tracking-widest rounded-lg transition-all shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 ${
                    generationMode === 'one_question_max_3'
                      ? 'bg-amber-600 text-white hover:bg-amber-700 ring-2 ring-amber-400/30'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300'
                  }`}
                >
                  {isGenerating && generationMode === 'one_question_max_3' ? (
                    <>
                      <div className="w-4 h-4 border-2 border-amber-300 border-t-white rounded-full animate-spin" />
                      Creating 1-3 Cards...
                    </>
                  ) : (
                    <>
                      <Sparkles size={15} />
                      1 Question → 1-3 Cards Max
                    </>
                  )}
                </button>

                <button 
                  onClick={() => generateCards('default')}
                  disabled={isGenerating}
                  className={`w-full py-2.5 px-4 text-xs font-bold uppercase tracking-widest rounded-lg transition-all shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 ${
                    generationMode === 'default'
                      ? 'bg-slate-800 text-white hover:bg-slate-900 ring-2 ring-slate-400/20'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                  }`}
                >
                  {isGenerating && generationMode === 'default' ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-400 border-t-white rounded-full animate-spin" />
                      Generating Default Cards...
                    </>
                  ) : (
                    <>
                      <Sparkles size={15} />
                      Generate Cards (Default)
                    </>
                  )}
                </button>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-xs flex items-center gap-2">
                  <AlertCircle size={14} />
                  {error}
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
                <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-widest ${
                  generationMode === 'one_question_max_3'
                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}>
                  {generationMode === 'one_question_max_3' ? '1 Question (Max 3 Cards)' : 'Default (Comprehensive)'}
                </span>
                <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-widest">
                  {cards.length} Cards Prepared
                </span>
              </div>
            </div>
            
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex-1 relative flex flex-col">
              <AnimatePresence mode="wait">
                {cards.length > 0 ? (
                  <motion.div 
                    key="table"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="overflow-auto flex-1"
                  >
                    <table className="w-full text-left border-collapse table-fixed">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-[5]">
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-widest w-[48%]">Text</th>
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-widest w-[32%]">
                            <div className="flex items-center gap-1.5">
                              <span>Column 2: Extra</span>
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded border border-indigo-200 font-mono text-[9px] font-bold">
                                <span>Mechanism</span>
                                <span>→</span>
                              </span>
                            </div>
                          </th>
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-widest w-[20%]">Tag</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm text-slate-700 divide-y divide-slate-100">
                        {cards.map((card, idx) => (
                          <motion.tr 
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            key={idx} 
                            className="hover:bg-indigo-50/20 transition-colors group"
                          >
                            <td className="px-6 py-5 leading-relaxed font-mono text-[13px] break-words">
                              {card.text}
                            </td>
                            <td className="px-6 py-5 text-slate-600 text-[12px] align-top leading-relaxed">
                              {renderExplanation(card.extra)}
                            </td>
                            <td className="px-6 py-5 align-top">
                              <span className="inline-block px-2 py-1 bg-slate-100 border border-slate-200 rounded text-[10px] text-slate-500 font-mono break-all leading-tight">
                                {card.tag}
                              </span>
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex-1 flex flex-col items-center justify-center p-12 text-center"
                  >
                    <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-6 border border-slate-100 shadow-inner">
                      <TableIcon size={32} className="text-slate-200" />
                    </div>
                    <h3 className="text-slate-800 font-semibold mb-2">Workspace Empty</h3>
                    <p className="text-slate-400 text-sm max-w-sm leading-relaxed">
                      Enter your clinical notes and metadata on the left, then click Generate to populate your Anki card set.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        </div>

        {/* Global Footer Controls */}
        <div className="mt-auto flex flex-col md:flex-row items-center justify-between p-5 bg-slate-800 rounded-xl text-white shadow-2xl gap-4">
          <div className="flex items-center gap-6 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
            <div className="flex items-center gap-2 shrink-0">
              <span className="w-2.5 h-2.5 bg-yellow-400 rounded-full shadow-[0_0_8px_rgba(250,204,21,0.5)]"></span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Guardrails Active</span>
            </div>
            <div className="hidden sm:block h-4 w-px bg-slate-600"></div>
            <div className="flex flex-wrap gap-4 text-[10px] text-slate-400 tracking-wider uppercase font-medium shrink-0">
              <p>Cloze Discipline: <b className="text-slate-100">ON</b></p>
              <p>Column 2 Mechanism: <b className="text-emerald-400">Step Arrows (→)</b></p>
              <p>Topic 1st Line: <b className={firstLineAsTopic ? "text-violet-400" : "text-slate-100"}>{firstLineAsTopic ? "ON" : "OFF"}</b></p>
              <p>No Commas: <b className="text-slate-100">ENFORCED</b></p>
              <p>HTML: <b className="text-slate-100">STANDARDIZED</b></p>
            </div>
          </div>
          <div className="flex gap-3 shrink-0">
            <button 
              onClick={clearAll}
              className="px-4 py-1.5 border border-slate-600 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-colors"
            >
              Clear Queue
            </button>
            <button 
              onClick={copyToClipboard}
              disabled={cards.length === 0}
              className="px-5 py-1.5 bg-white text-slate-900 font-bold rounded text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-all disabled:opacity-50"
            >
              Copy TSV
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
