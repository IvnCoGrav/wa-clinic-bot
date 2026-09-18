import React, { useMemo } from 'react';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * HighlightMatches — deterministik tanpa dangerouslySetInnerHTML.
 * Membagi teks menjadi token aman dan membungkus kata kunci dengan <mark>.
 * - Query di-escape sehingga "(" / "[" / "+" tidak melempar SyntaxError (ReDoS-proof).
 * - Tanpa flag global pada RegExp uji (stateless .test) — split memakai regex group capture.
 * - max query 100 char, teks dibatasi visual line-clamp di caller.
 */
export const HighlightMatches: React.FC<{ text: string; query: string; className?: string }> = ({ text, query, className }) => {
  const nodes = useMemo(() => {
    if (!query || !query.trim() || !text) return [text] as React.ReactNode[];
    const q = query.trim().slice(0, 100);
    const escaped = escapeRegExp(q);
    try {
      const regex = new RegExp(`(${escaped})`, 'gi');
      const parts = text.split(regex);
      if (parts.length <= 1) return [text] as React.ReactNode[];
      // For highlight test, use separate case-insensitive check without global flag to avoid lastIndex trap.
      const testRe = new RegExp(`^${escaped}$`, 'i');
      return parts.map((part, i) =>
        testRe.test(part) ? (
          <mark key={i} className={className || 'bg-amber-300 text-amber-950 font-bold px-0.5 rounded'}>
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      );
    } catch {
      return [text] as React.ReactNode[];
    }
  }, [text, query, className]);

  return <>{nodes}</>;
};

export default HighlightMatches;
