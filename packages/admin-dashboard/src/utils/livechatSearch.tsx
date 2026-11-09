import React from 'react';
import { extractImageCaption } from './mediaExtractor';

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
