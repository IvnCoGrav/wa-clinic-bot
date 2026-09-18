/**
 * src/v3/guardrails/sentence-salvage.ts
 * P4 revisi fondasional — surgical salvage TINGKAT KALIMAT.
 *
 * Saat reprompt faktual gagal, pipeline lama membuang SELURUH balasan dan
 * mengganti fallback generik (inti valid ikut hilang). Modul ini menyaring
 * per kalimat memakai validator deterministik yang sama
 * (validateFactualClaims): kalimat lolos dipertahankan VERBATIM, kalimat
 * melanggar dibuang + pelanggarannya diagregat untuk kurasi admin.
 *
 * MANDAT ANTI-MUTILASI: DILARANG mengedit isi kalimat (regex mid-sentence).
 * Satu-satunya operasi string adalah split di BATAS kalimat dan join —
 * kept.every(s => input.includes(s)) dijamin dan dipin test.
 */

import {
  validateFactualClaims,
  type FactualValidationOptions,
} from './factual-claim-validator';

interface SalvageToolExec {
  name: string;
  args?: any;
  result: any;
}

export interface SalvageResult {
  /** Kalimat utuh yang lolos — verbatim substring input. */
  kept: string[];
  /** Kalimat yang melanggar — untuk audit/kurasi, tidak dikirim. */
  dropped: string[];
  /** Agregat pelanggaran dari kalimat yang dibuang. */
  droppedViolations: string[];
}

/** Terminator kalimat (ASCII + elipsis/seru-tanya ganda). Emoji dipertahankan. */
const SENTENCE_BOUNDARY_RE = /([.!?…]+)(\s+|$)/g;

/**
 * Potong teks HANYA di batas kalimat. Terminator menempel pada kalimatnya.
 * Teks tanpa terminator = satu kalimat. Selalu kembalikan irisan utuh input.
 */
export function splitSentences(text: string): string[] {
  const input = String(text || '');
  if (!input.trim()) return [];
  const parts: string[] = [];
  let start = 0;
  SENTENCE_BOUNDARY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_BOUNDARY_RE.exec(input)) !== null) {
    const end = m.index + m[1].length;
    const piece = input.slice(start, end).trim();
    if (piece) parts.push(piece);
    start = m.index + m[0].length;
    if (m[0].length === 0) break;
  }
  const tail = input.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

export function salvageValidSentences(
  replyText: string,
  executedTools: SalvageToolExec[],
  retrievedChunks?: Array<{ content?: string }>,
  opts?: FactualValidationOptions
): SalvageResult {
  const kept: string[] = [];
  const dropped: string[] = [];
  const droppedViolations: string[] = [];
  for (const sentence of splitSentences(replyText)) {
    const check = validateFactualClaims(sentence, executedTools as any, retrievedChunks, opts);
    if (check.isValid) {
      kept.push(sentence);
    } else {
      dropped.push(sentence);
      droppedViolations.push(...check.violations);
    }
  }
  return { kept, dropped, droppedViolations };
}
