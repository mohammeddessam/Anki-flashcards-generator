/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {Images, SlidersHorizontal} from 'lucide-react';
import React from 'react';

import type {CardDensity, CitationMode, ExplanationDepth} from '../types';

interface OptionsPanelProps {
  density: CardDensity;
  onDensityChange: (value: CardDensity) => void;
  depth: ExplanationDepth;
  onDepthChange: (value: ExplanationDepth) => void;
  citationMode: CitationMode;
  onCitationModeChange: (value: CitationMode) => void;
  /** Modes the current source can actually support. */
  availableModes: CitationMode[];
  /** Explains why image modes are unavailable, when they are. */
  citationHint?: string;
}

const DENSITY_OPTIONS: Array<{value: CardDensity; label: string}> = [
  {value: 'high_yield', label: 'High-yield'},
  {value: 'balanced', label: 'Balanced'},
  {value: 'comprehensive', label: 'Comprehensive'},
];

const DEPTH_OPTIONS: Array<{value: ExplanationDepth; label: string}> = [
  {value: 'brief', label: 'Brief'},
  {value: 'standard', label: 'Standard'},
  {value: 'deep', label: 'Deep'},
];

const CITATION_OPTIONS: Array<{value: CitationMode; label: string}> = [
  {value: 'page', label: 'Page ref'},
  {value: 'image', label: 'Page image'},
  {value: 'both', label: 'Both'},
];

/** A segmented control in the same visual language as the existing mode tabs. */
const Segmented = <T extends string>({
  value,
  options,
  onChange,
  disabledValues = [],
}: {
  value: T;
  options: Array<{value: T; label: string}>;
  onChange: (value: T) => void;
  disabledValues?: T[];
}) => (
  <div className="grid gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200"
    style={{gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`}}>
    {options.map(option => {
      const disabled = disabledValues.includes(option.value);
      return (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`py-1.5 px-1 rounded-md text-[11px] font-semibold transition-all ${
            value === option.value
              ? 'bg-white text-slate-800 shadow-sm border border-slate-200'
              : disabled
                ? 'text-slate-300 cursor-not-allowed'
                : 'text-slate-500 hover:text-slate-700'
          }`}>
          {option.label}
        </button>
      );
    })}
  </div>
);

export const OptionsPanel: React.FC<OptionsPanelProps> = ({
  density,
  onDensityChange,
  depth,
  onDepthChange,
  citationMode,
  onCitationModeChange,
  availableModes,
  citationHint,
}) => {
  const disabledModes = CITATION_OPTIONS.map(o => o.value).filter(
    v => !availableModes.includes(v),
  );

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
        <SlidersHorizontal size={14} />
        Generation Options
      </h2>

      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-slate-600 uppercase">Card density</label>
        <Segmented value={density} options={DENSITY_OPTIONS} onChange={onDensityChange} />
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-slate-600 uppercase">Explanation depth</label>
        <Segmented value={depth} options={DEPTH_OPTIONS} onChange={onDepthChange} />
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
          <Images size={12} />
          Citation mode
        </label>
        <Segmented
          value={citationMode}
          options={CITATION_OPTIONS}
          onChange={onCitationModeChange}
          disabledValues={disabledModes}
        />
        {citationHint && (
          <p className="text-[10px] text-slate-400 leading-tight">{citationHint}</p>
        )}
      </div>
    </div>
  );
};
