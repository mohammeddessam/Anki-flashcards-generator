/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {FileSpreadsheet, Loader2, Package, Download} from 'lucide-react';
import React from 'react';

interface ExportBarProps {
  cardCount: number;
  busy: string | null;
  firstLineAsTopic: boolean;
  citationSummary: string;
  onClear: () => void;
  onCopyTsv: () => void;
  onExportXlsx: () => void;
  onExportApkg: () => void;
  onExportBundle: () => void;
}

/** The original dark footer, extended with the Excel, Anki and bundle exports. */
export const ExportBar: React.FC<ExportBarProps> = ({
  cardCount,
  busy,
  firstLineAsTopic,
  citationSummary,
  onClear,
  onCopyTsv,
  onExportXlsx,
  onExportApkg,
  onExportBundle,
}) => {
  const disabled = cardCount === 0 || busy !== null;

  return (
    <div className="mt-auto flex flex-col xl:flex-row items-center justify-between p-5 bg-slate-800 rounded-xl text-white shadow-2xl gap-4">
      <div className="flex items-center gap-6 overflow-x-auto w-full xl:w-auto pb-2 xl:pb-0">
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-2.5 h-2.5 bg-yellow-400 rounded-full shadow-[0_0_8px_rgba(250,204,21,0.5)]" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">
            Guardrails Active
          </span>
        </div>
        <div className="hidden sm:block h-4 w-px bg-slate-600" />
        <div className="flex flex-wrap gap-4 text-[10px] text-slate-400 tracking-wider uppercase font-medium shrink-0">
          <p>
            Cloze Discipline: <b className="text-slate-100">ON</b>
          </p>
          <p>
            Mechanism: <b className="text-emerald-400">Step Arrows (&#8594;)</b>
          </p>
          <p>
            Citation: <b className="text-indigo-300">{citationSummary}</b>
          </p>
          <p>
            Topic 1st Line:{' '}
            <b className={firstLineAsTopic ? 'text-violet-400' : 'text-slate-100'}>
              {firstLineAsTopic ? 'ON' : 'OFF'}
            </b>
          </p>
          <p>
            HTML: <b className="text-slate-100">STANDARDIZED</b>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 shrink-0 justify-end">
        <button
          onClick={onClear}
          className="px-4 py-1.5 border border-slate-600 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-colors">
          Clear Queue
        </button>
        <button
          onClick={onCopyTsv}
          disabled={disabled}
          className="px-4 py-1.5 border border-slate-600 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-colors disabled:opacity-50">
          Copy TSV
        </button>
        <button
          onClick={onExportXlsx}
          disabled={disabled}
          className="px-4 py-1.5 bg-emerald-500 text-slate-900 font-bold rounded text-[10px] uppercase tracking-widest hover:bg-emerald-400 transition-all disabled:opacity-50 flex items-center gap-1.5">
          {busy === 'xlsx' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <FileSpreadsheet size={12} />
          )}
          Excel (.xlsx)
        </button>
        <button
          onClick={onExportApkg}
          disabled={disabled}
          className="px-4 py-1.5 bg-indigo-500 text-white font-bold rounded text-[10px] uppercase tracking-widest hover:bg-indigo-400 transition-all disabled:opacity-50 flex items-center gap-1.5">
          {busy === 'apkg' ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
          Anki (.apkg)
        </button>
        <button
          onClick={onExportBundle}
          disabled={disabled}
          className="px-4 py-1.5 bg-white text-slate-900 font-bold rounded text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-all disabled:opacity-50 flex items-center gap-1.5">
          {busy === 'bundle' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Download size={12} />
          )}
          Bundle (.zip)
        </button>
      </div>
    </div>
  );
};
