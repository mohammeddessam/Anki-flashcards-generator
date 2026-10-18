/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {Layers} from 'lucide-react';
import React from 'react';

import type {SourceDocument, Topic} from '../types';

interface TopicPickerProps {
  doc: SourceDocument;
  topics: Topic[];
  /** Empty means "the whole document". */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

/** Lets the user generate from one topic, several topics, or the whole document. */
export const TopicPicker: React.FC<TopicPickerProps> = ({doc, topics, selectedIds, onChange}) => {
  const wholeDocument = selectedIds.length === 0;

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter(s => s !== id) : [...selectedIds, id],
    );
  };

  const pageLabel = (topic: Topic) => {
    if (!doc.hasRealPages) {
      return topic.startPage === topic.endPage
        ? `chunk ${topic.startPage}`
        : `chunks ${topic.startPage}–${topic.endPage}`;
    }
    return topic.startPage === topic.endPage
      ? `p. ${topic.startPage}`
      : `pp. ${topic.startPage}–${topic.endPage}`;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <Layers size={14} />
          Detected Topics
        </h2>
        <span className="text-[9px] text-slate-400 font-mono">
          {topics.length} found
        </span>
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`flex-1 py-1.5 px-2 rounded-md text-[11px] font-semibold transition-all border ${
            wholeDocument
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
          }`}>
          Whole document
        </button>
        <button
          type="button"
          onClick={() => onChange(topics.map(t => t.id))}
          className="flex-1 py-1.5 px-2 rounded-md text-[11px] font-semibold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 transition-all">
          Select all topics
        </button>
      </div>

      <div className="max-h-56 overflow-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
        {topics.map(topic => {
          const checked = selectedIds.includes(topic.id);
          return (
            <label
              key={topic.id}
              className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-colors ${
                checked ? 'bg-violet-50/70' : 'bg-white hover:bg-slate-50'
              }`}
              style={{paddingLeft: `${10 + topic.level * 12}px`}}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(topic.id)}
                className="w-3.5 h-3.5 rounded border-slate-300 accent-violet-600 cursor-pointer shrink-0"
              />
              <span className="text-[11px] text-slate-700 flex-1 truncate" title={topic.title}>
                {topic.title}
              </span>
              <span className="text-[9px] text-slate-400 font-mono shrink-0">
                {pageLabel(topic)}
              </span>
            </label>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-400 leading-tight">
        {wholeDocument
          ? 'No topic selected, so the whole document will be processed in page-aligned batches.'
          : `${selectedIds.length} topic(s) selected. Each card is tagged with its own topic.`}
      </p>
    </div>
  );
};
