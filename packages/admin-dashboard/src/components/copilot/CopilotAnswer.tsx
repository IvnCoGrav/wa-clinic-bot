import React, { useState } from 'react';
import {
  parseCopilotAnswer,
  COPILOT_MAX_VISIBLE_ROWS,
  COPILOT_TOOL_PAGE,
  type CopilotBlock,
} from '../../utils/copilotAnswerParser';
import { ChevronRight, ChevronDown, ExternalLink, MessageCircle } from 'lucide-react';

const INLINE_RE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;

/** Render teks inline dengan penebalan markdown dan tautan aman */
function renderInlineMarkdown(content: string, onNavigate: (url: string) => void): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;

  while ((m = INLINE_RE.exec(content)) !== null) {
    if (m.index > last) {
      nodes.push(content.slice(last, m.index));
    }
    if (m[1] !== undefined) {
      const label = m[1];
      const url = m[2];
      if (url.startsWith('/admin/live-chat')) {
        nodes.push(
          <button
            key={`link-${m.index}`}
            type="button"
            onClick={() => onNavigate(url)}
            className="inline-flex items-center gap-1 align-middle mx-0.5 px-1.5 py-0.5 rounded-md bg-accent hover:bg-accent-hover text-white text-[10px] font-semibold active:scale-[0.97] transition-colors"
          >
            <MessageCircle size={10} /> {label}
          </button>
        );
      } else {
        nodes.push(
          <a
            key={`ext-${m.index}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-accent hover:underline"
          >
            {label}
          </a>
        );
      }
    } else {
      nodes.push(
        <strong key={`b-${m.index}`} className="font-semibold text-ink">
          {m[3]}
        </strong>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    nodes.push(content.slice(last));
  }
  return <>{nodes}</>;
}

/**
 * Render teks baris tabel Copilot (bebas elemen interaktif bersarang).
 * Mendukung **bold**, namun meratakan tautan markdown [label](url) menjadi teks biasa
 * agar tidak melahirkan tag <button>/<a> di dalam wadah baris yang sudah bertindak sebagai tombol.
 */
function renderRowInlineMarkdown(content: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;

  while ((m = INLINE_RE.exec(content)) !== null) {
    if (m.index > last) {
      nodes.push(content.slice(last, m.index));
    }
    if (m[1] !== undefined) {
      // Tautan di dalam baris diratakan menjadi teks label polos tanpa tag interaktif
      nodes.push(m[1]);
    } else if (m[3] !== undefined) {
      nodes.push(
        <strong key={`rb-${m.index}`} className="font-semibold text-ink">
          {m[3]}
        </strong>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    nodes.push(content.slice(last));
  }
  return <>{nodes}</>;
}

export interface CopilotAnswerProps {
  content: string;
  toolsUsed?: string[];
  onNavigate: (url: string) => void;
}

export const CopilotAnswer: React.FC<CopilotAnswerProps> = ({ content, toolsUsed, onNavigate }) => {
  const blocks = parseCopilotAnswer(content);
  const [expanded, setExpanded] = useState(false);

  // Hitung total blok row untuk batas visual 8 baris & tombol "Lihat semua"
  const rowCount = blocks.filter((b) => b.type === 'row').length;
  const isCapped = rowCount > COPILOT_MAX_VISIBLE_ROWS && !expanded;

  // Cek apakah ada pintasan halaman tabel (bila data > 20 baris)
  let pageShortcut: { path: string; label: string } | null = null;
  if (rowCount > 20 && Array.isArray(toolsUsed)) {
    for (const tool of toolsUsed) {
      if (COPILOT_TOOL_PAGE[tool]) {
        pageShortcut = COPILOT_TOOL_PAGE[tool];
        break;
      }
    }
  }

  let visibleRowIndex = 0;

  return (
    <div className="space-y-1.5 text-xs text-ink leading-relaxed">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          return (
            <div
              key={idx}
              className="text-[11px] font-bold uppercase tracking-wide text-ink-2 mt-2.5 mb-1 pt-1 border-t border-divider/40 first:border-t-0 first:pt-0"
            >
              {block.text}
            </div>
          );
        }

        if (block.type === 'row') {
          visibleRowIndex++;
          if (isCapped && visibleRowIndex > COPILOT_MAX_VISIBLE_ROWS) {
            return null;
          }

          const hasLink = Boolean(block.conversationId);
          return (
            <button
              key={idx}
              type="button"
              disabled={!hasLink}
              onClick={() => {
                if (block.conversationId) {
                  onNavigate(`/admin/live-chat?conversationId=${encodeURIComponent(block.conversationId)}`);
                }
              }}
              title={`${block.name} — ${block.status}${block.detail ? ` (${block.detail})` : ''}`}
              className={`w-full min-h-[44px] flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-divider/70 bg-surface-2/60 text-left transition ${
                hasLink
                  ? 'hover:bg-fill-1 hover:border-accent/40 active:scale-[0.99] cursor-pointer'
                  : 'cursor-default'
              }`}
            >
              <div className="min-w-0 flex-1 flex flex-col justify-center">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="font-semibold text-xs text-ink truncate">
                    {renderRowInlineMarkdown(block.name)}
                  </span>
                  <span className="text-[10px] text-ink-3">·</span>
                  <span className="text-[11px] text-ink-2 truncate">
                    {renderRowInlineMarkdown(block.status)}
                  </span>
                </div>
                {block.detail && (
                  <span className="text-[10px] text-ink-3 truncate mt-0.5">
                    {renderRowInlineMarkdown(block.detail)}
                  </span>
                )}
              </div>
              {hasLink && <ChevronRight size={14} className="text-ink-3 shrink-0" />}
            </button>
          );
        }

        if (block.type === 'list') {
          return (
            <div key={idx} className="flex items-start gap-1.5 text-xs text-ink my-0.5">
              <span className="text-ink-3 shrink-0 select-none">•</span>
              <div className="flex-1 min-w-0">{renderInlineMarkdown(block.text, onNavigate)}</div>
            </div>
          );
        }

        return (
          <p key={idx} className="text-xs text-ink leading-relaxed my-1">
            {renderInlineMarkdown(block.text, onNavigate)}
          </p>
        );
      })}

      {/* Tombol Lihat Semua (N) jika baris melebihi batas 8 baris */}
      {rowCount > COPILOT_MAX_VISIBLE_ROWS && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 min-h-[36px] px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-fill-1 text-xs font-semibold text-accent border border-divider active:scale-95 transition cursor-pointer"
          >
            {expanded ? (
              <>
                <ChevronDown size={14} className="rotate-180" /> Ciutkan daftar
              </>
            ) : (
              <>
                <ChevronDown size={14} /> Lihat semua ({rowCount} data)
              </>
            )}
          </button>
        </div>
      )}

      {/* Pintasan ke halaman tabel lengkap untuk daftar > 20 baris */}
      {pageShortcut && (
        <div className="pt-2 border-t border-divider/50">
          <button
            type="button"
            onClick={() => onNavigate(pageShortcut!.path)}
            className="w-full flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 rounded-xl bg-accent-soft hover:bg-accent-soft/80 text-accent font-semibold text-xs border border-accent/30 active:scale-[0.99] transition cursor-pointer"
          >
            <ExternalLink size={14} />
            <span>{pageShortcut.label}</span>
          </button>
        </div>
      )}
    </div>
  );
};
