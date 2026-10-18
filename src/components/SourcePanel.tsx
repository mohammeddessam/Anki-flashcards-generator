/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {AlertCircle, FileText, Loader2, Stethoscope, Upload, X} from 'lucide-react';
import React, {useRef, useState} from 'react';

import type {SourceDocument} from '../types';
import {SUPPORTED_EXTENSIONS} from '../lib/extract';

interface SourcePanelProps {
  sourceText: string;
  onSourceTextChange: (value: string) => void;
  doc: SourceDocument | null;
  isLoadingFile: boolean;
  fileError: string | null;
  placeholder: string;
  onFileSelected: (file: File) => void;
  onClearFile: () => void;
}

/**
 * Source input: an uploaded document or, exactly as before, pasted text.
 * The textarea stays the fallback path so the original workflow still works.
 */
export const SourcePanel: React.FC<SourcePanelProps> = ({
  sourceText,
  onSourceTextChange,
  doc,
  isLoadingFile,
  fileError,
  placeholder,
  onFileSelected,
  onClearFile,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFileSelected(file);
  };

  return (
    // The textarea only claims vertical space when it is actually shown.
    <div className={`space-y-3 flex flex-col ${doc ? '' : 'flex-1 min-h-[260px]'}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <Stethoscope size={14} />
          Source Content
        </h2>
        {!doc && (
          <button
            onClick={() => onSourceTextChange('')}
            className="text-[10px] text-slate-400 hover:text-red-500 underline uppercase tracking-widest">
            Clear
          </button>
        )}
      </div>

      {/* Upload target */}
      <div
        onDragOver={e => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-lg border border-dashed transition-all ${
          isDragging
            ? 'border-indigo-400 bg-indigo-50/70'
            : 'border-slate-300 bg-slate-50 hover:bg-slate-100/70'
        }`}>
        <input
          ref={inputRef}
          type="file"
          accept={SUPPORTED_EXTENSIONS.join(',')}
          className="hidden"
          onChange={e => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {doc ? (
          <div className="p-2.5 flex items-start gap-2">
            <FileText size={16} className="text-indigo-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-800 truncate">{doc.fileName}</div>
              <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                {doc.pages.length} {doc.hasRealPages ? 'page(s)' : 'section chunk(s)'}
                {doc.hasPrintedPages ? ' · printed page numbers detected' : ''}
                {doc.canRenderPages ? ' · page images available' : ''}
              </div>
            </div>
            <button
              onClick={onClearFile}
              title="Remove document"
              className="text-slate-400 hover:text-red-500 shrink-0">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isLoadingFile}
            className="w-full p-3 flex items-center justify-center gap-2 text-[11px] font-semibold text-slate-600 disabled:opacity-60">
            {isLoadingFile ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Reading document...
              </>
            ) : (
              <>
                <Upload size={14} />
                Upload a study document
                <span className="font-mono text-[9px] text-slate-400 font-normal">
                  PDF, DOCX, TXT, MD, HTML
                </span>
              </>
            )}
          </button>
        )}
      </div>

      {fileError && (
        <div className="p-2.5 bg-red-50 border border-red-100 rounded-lg text-red-600 text-[11px] flex items-start gap-2">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span className="leading-tight">{fileError}</span>
        </div>
      )}

      {doc?.warnings.map(warning => (
        <div
          key={warning}
          className="p-2.5 bg-amber-50 border border-amber-100 rounded-lg text-amber-800 text-[11px] flex items-start gap-2">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span className="leading-tight">{warning}</span>
        </div>
      ))}

      {!doc && (
        <textarea
          placeholder={placeholder}
          value={sourceText}
          onChange={e => onSourceTextChange(e.target.value)}
          className="flex-1 w-full p-4 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none transition-all resize-none text-sm leading-relaxed font-mono"
        />
      )}
    </div>
  );
};
