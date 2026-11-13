#!/usr/bin/env node
// Gerbang format tanggal: komponen, halaman, hook, dan util wajib lewat
// src/utils/dateWib.ts.
//
// Alasan: `new Date(x).toLocaleDateString('id-ID')` memakai zona waktu perangkat.
// Terapis yang membuka dashboard dari luar WIB bisa melihat tanggal jadwal
// bergeser satu hari. Semua format tanggal/jam kini lewat helper yang menyuntik
// timeZone Asia/Jakarta.
//
// Pemindaian menelusuri satu pemanggilan penuh (bukan satu baris), supaya
// pemanggilan multi-baris tidak dilaporkan sebagai pelanggaran palsu.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = [
  join(PKG, 'src', 'components'),
  join(PKG, 'src', 'pages'),
  join(PKG, 'src', 'hooks'),
  join(PKG, 'src', 'utils'),
];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const EXT = new Set(['.ts', '.tsx']);
const PATTERN = /toLocale(Date|Time)String\s*\(/g;
const PATTERN_DATETIME = /toLocaleString\s*\(/g;
const DATETIME_OPTIONS = /\b(day|month|year|hour|minute|second|weekday|dateStyle|timeStyle)\s*:/;

function collect(target, acc = []) {
  const st = statSync(target);
  if (st.isFile()) {
    if (EXT.has(extname(target))) acc.push(target);
    return acc;
  }
  for (const e of readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    collect(join(target, e.name), acc);
  }
  return acc;
}

/** Ambil teks dari awal pemanggilan sampai tanda kurung penutup yang seimbang. */
function callSpan(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

/** Jumlah argumen tingkat atas di dalam pemanggilan. */
function countArgs(span) {
  const inner = span.slice(span.indexOf('(') + 1, -1);
  if (!inner.trim()) return 0;
  let depth = 0;
  let args = 1;
  for (const ch of inner) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) args += 1;
  }
  return args;
}

/** Apakah penerima pemanggilan terlihat seperti objek tanggal? */
function looksLikeDateReceiver(src, index) {
  const before = src.slice(Math.max(0, index - 120), index);
  if (/new Date\s*\([^()]*\)\s*(?:\?\.)?\.\s*$/.test(before)) return true;
  // Variabel bernama pendek yang lazim dipakai untuk Date (d, dt, date, ...).
  return /(?:^|[^\w$.])(?:d|dt|date|dateObj|iso|time)\s*(?:\?\.)?\.\s*$/.test(before);
}

/** True bila pemanggilan memformat tanggal/jam tanpa menyebut zona waktu. */
function isDateViolation(span, kind, src, index) {
  if (/timeZone/.test(span)) return false;
  if (kind === 'date') return true;
  // toLocaleString juga dipakai untuk angka; hanya periksa yang beropsi tanggal.
  if (DATETIME_OPTIONS.test(span)) return true;
  // Tanpa opsi tanggal: format bawaan memuat jam perangkat.
  return countArgs(span) <= 1 && looksLikeDateReceiver(src, index);
}

const violations = [];
for (const file of ROOTS.flatMap((r) => collect(r))) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const lineStartOffsets = [];
  let offset = 0;
  for (const line of lines) {
    lineStartOffsets.push(offset);
    offset += line.length + 1;
  }

  const scans = [
    { re: PATTERN, kind: 'date' },
    { re: PATTERN_DATETIME, kind: 'datetime' },
  ];

  for (const { re, kind } of scans) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(src)) !== null) {
      const span = callSpan(src, match.index);
      if (!isDateViolation(span, kind, src, match.index)) continue;

      let lineNo = 0;
      while (lineNo + 1 < lineStartOffsets.length && lineStartOffsets[lineNo + 1] <= match.index) {
        lineNo += 1;
      }
      violations.push(
        `${relative(PKG, file).split('\\').join('/')}:${lineNo + 1}  ${lines[lineNo].trim().slice(0, 110)}`
      );
    }
  }
}

if (violations.length) {
  console.error(`Format tanggal wajib lewat utils/dateWib.ts. Pelanggaran: ${violations.length}`);
  for (const v of violations) console.error('  ' + v);
  console.error(
    '\nPakai formatWib(), formatWibClock(), atau formatWibDate() dari src/utils/dateWib.ts.'
  );
  process.exit(1);
}

console.log(
  'Format tanggal OK: 0 pemakaian toLocale* langsung di components/pages/hooks/utils.'
);
