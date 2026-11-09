import React from 'react';
import { ExternalLink } from 'lucide-react';
import { extractImageCaption } from './mediaExtractor';

/**
 * Pisahkan tanda baca akhir dari URL agar tautan tidak menyerap titik/koma
 * kalimat. Kurung tutup hanya dipertahankan bila berpasangan (mis. URL Wikipedia).
 */
function trimUrlTrailingPunctuation(raw: string): { url: string; trailing: string } {
  let url = raw;
  let trailing = '';
  const alwaysTrailing = /[.,;:!?'"]$/;
  while (url && alwaysTrailing.test(url)) {
    trailing = url.slice(-1) + trailing;
    url = url.slice(0, -1);
  }
  const pairs: Array<[string, string]> = [['(', ')'], ['[', ']']];
  for (const [open, close] of pairs) {
    while (
      url.endsWith(close) &&
      url.split(open).length < url.split(close).length
    ) {
      trailing = close + trailing;
      url = url.slice(0, -1);
    }
  }
  return { url, trailing };
}

/**
 * Render teks pesan LiveChat dengan tautan yang bisa diklik.
 * - URL http(s) dan www. dirender sebagai <a target="_blank" rel="noopener noreferrer">.
 * - Segmen non-URL tetap memakai renderHighlightedText agar fitur pencarian aman.
 */
export function renderFormattedMessageContent(text: string, query?: string): React.ReactNode {
  if (!text) return text;
  const parts = text.split(/((?:https?:\/\/|www\.)[^\s<]+)/gi);
  if (parts.length <= 1) return renderHighlightedText(text, query || '');

  return parts.map((part, index) => {
    if (!part) return null;
    const isUrl = /^(?:https?:\/\/|www\.)/i.test(part);
    if (!isUrl) {
      return (
        <React.Fragment key={`text-${index}`}>
          {renderHighlightedText(part, query || '')}
        </React.Fragment>
      );
    }

    const { url, trailing } = trimUrlTrailingPunctuation(part);
    if (!url) return part;
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    return (
      <React.Fragment key={`url-${index}`}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline hover:text-accent-hover break-all inline-flex items-center gap-0.5 cursor-pointer font-medium"
          onClick={(e) => e.stopPropagation()}
        >
          {url}
          <ExternalLink size={10} className="shrink-0 opacity-70" />
        </a>
        {trailing}
      </React.Fragment>
    );
  });
}

export function renderHighlightedText(text: string, query: string): React.ReactNode {
  if (!query || !query.trim() || !text) return text;
  const q = query.trim();
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    const regex = new RegExp(`(^|\\W)(${escaped})($|\\W)`, 'gi');
    const parts = text.split(regex);
    if (parts.length <= 1) return text;
    const testRegex = new RegExp(`^${escaped}$`, 'i');
    return parts.map((part, i) =>
      testRegex.test(part) ? (
        <mark key={i} className="bg-amber-200 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 font-bold px-0.5 rounded">
          {part}
        </mark>
      ) : (
        part
      )
    );
  } catch {
    return text;
  }
}

export function cleanSnippetText(s: string): string {
  const c = extractImageCaption(s);
  return (c || s || '').trim();
}

export function extractSmartSearchSnippet(fullText: string, query: string, maxLength = 85): string {
  const text = cleanSnippetText(fullText);
  if (!query || !query.trim() || text.length <= maxLength) return text;
  const q = query.trim().toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text.slice(0, maxLength) + '...';
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, start + maxLength);
  return `${start > 0 ? '...' : ''}${text.slice(start, end).trim()}${end < text.length ? '...' : ''}`;
}
