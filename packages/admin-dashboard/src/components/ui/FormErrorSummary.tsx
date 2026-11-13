import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { FieldIssue } from '../../lib/validateReservation';

/**
 * Ringkasan kesalahan validasi: semua masalah tampil sekaligus, tetap di layar
 * sampai diperbaiki, dan diumumkan ke pembaca layar (role="alert").
 */
export const FormErrorSummary: React.FC<{ issues: FieldIssue[]; className?: string }> = ({
  issues,
  className = '',
}) => {
  if (!issues.length) return null;

  return (
    <div
      role="alert"
      className={`rounded-xl border border-danger-line bg-danger-soft p-3 text-xs text-danger ${className}`}
    >
      <p className="font-bold flex items-center gap-1.5 mb-1">
        <AlertTriangle size={14} aria-hidden="true" />
        <span>Periksa {issues.length} hal berikut sebelum menyimpan:</span>
      </p>
      <ul className="list-disc pl-5 space-y-0.5">
        {issues.map((issue) => (
          <li key={issue.field}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
};
