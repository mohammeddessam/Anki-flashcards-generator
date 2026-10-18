/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {AlertTriangle, Image as ImageIcon, Table as TableIcon} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import React from 'react';

import type {Flashcard} from '../types';

interface CardTableProps {
  cards: Flashcard[];
  /** Object URLs for rendered page images, keyed by media key. */
  imageUrls: Map<string, string>;
}

/**
 * The generated table, with the new Citation column alongside the original
 * Text / Extra / Tag columns.
 */
export const CardTable: React.FC<CardTableProps> = ({cards, imageUrls}) => (
  <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex-1 relative flex flex-col">
    <AnimatePresence mode="wait">
      {cards.length > 0 ? (
        <motion.div
          key="table"
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          className="overflow-auto flex-1">
          <table className="w-full text-left border-collapse table-fixed">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-[5]">
                <th className="px-5 py-4 text-xs font-semibold text-slate-500 uppercase tracking-widest w-[36%]">
                  Front
                </th>
                <th className="px-5 py-4 text-xs font-semibold text-slate-500 uppercase tracking-widest w-[27%]">
                  <div className="flex items-center gap-1.5">
                    <span>Back</span>
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded border border-indigo-200 font-mono text-[9px] font-bold">
                      <span>Mechanism</span>
                      <span>&#8594;</span>
                    </span>
                  </div>
                </th>
                <th className="px-5 py-4 text-xs font-semibold text-slate-500 uppercase tracking-widest w-[22%]">
                  Citation
                </th>
                <th className="px-5 py-4 text-xs font-semibold text-slate-500 uppercase tracking-widest w-[15%]">
                  Tags
                </th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700 divide-y divide-slate-100">
              {cards.map((card, idx) => (
                <motion.tr
                  initial={{opacity: 0, y: 5}}
                  animate={{opacity: 1, y: 0}}
                  transition={{delay: Math.min(idx * 0.02, 0.4)}}
                  key={`${card.tag}-${idx}`}
                  className="hover:bg-indigo-50/20 transition-colors group align-top">
                  <td className="px-5 py-4 leading-relaxed font-mono text-[12px] break-words align-top">
                    {card.text}
                    {card.review && card.review.length > 0 && (
                      <div className="mt-2 flex items-start gap-1.5 p-1.5 bg-amber-50 border border-amber-100 rounded text-[10px] text-amber-800 font-sans">
                        <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                        <span className="leading-tight">{card.review.join(' ')}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-slate-600 text-[12px] align-top leading-relaxed break-words">
                    <Explanation html={card.extra} />
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="text-[10px] text-slate-500 font-mono leading-tight break-words">
                      {card.citation ?? '—'}
                    </div>
                    <PageThumbnail card={card} imageUrls={imageUrls} />
                  </td>
                  <td className="px-5 py-4 align-top">
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
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          className="flex-1 flex flex-col items-center justify-center p-12 text-center">
          <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-6 border border-slate-100 shadow-inner">
            <TableIcon size={32} className="text-slate-200" />
          </div>
          <h3 className="text-slate-800 font-semibold mb-2">Workspace Empty</h3>
          <p className="text-slate-400 text-sm max-w-sm leading-relaxed">
            Upload a study document or paste your notes on the left, choose your topics, then
            generate to populate your Anki card set.
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

const PageThumbnail: React.FC<{card: Flashcard; imageUrls: Map<string, string>}> = ({
  card,
  imageUrls,
}) => {
  const key = card.source?.imageKey;
  if (!key) return null;
  const url = imageUrls.get(key);
  if (!url) {
    return (
      <div className="mt-2 flex items-center gap-1 text-[9px] text-slate-400 font-mono">
        <ImageIcon size={10} />
        {key}
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block mt-2">
      <img
        src={url}
        alt={`Source page ${card.source?.pageIndex ?? ''}`}
        className="w-full max-w-[140px] rounded border border-slate-200 hover:border-indigo-400 transition-colors"
      />
    </a>
  );
};

/** Renders the explanation with the arrows styled, as the original UI did. */
const Explanation: React.FC<{html: string}> = ({html}) => {
  const hasItalics = /^<i>[\s\S]*<\/i>$/i.test(html.trim());
  const clean = html.replace(/^<i>|<\/i>$/gi, '').trim();

  if (!clean.includes('→')) {
    return <span className={hasItalics ? 'italic' : ''}>{clean}</span>;
  }

  return (
    <span className={`${hasItalics ? 'italic' : ''} inline leading-relaxed`}>
      {clean.split('→').map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span className="inline-flex items-center px-1 font-bold not-italic text-indigo-600 text-[13px] select-none mx-0.5">
              &#8594;
            </span>
          )}
          <span>{part.trim()}</span>
        </React.Fragment>
      ))}
    </span>
  );
};
