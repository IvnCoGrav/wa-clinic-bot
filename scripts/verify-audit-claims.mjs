#!/usr/bin/env node
/**
 * verify-audit-claims.mjs — Gerbang integritas artefak audit (Ar-009).
 *
 * Masalah: laporan audit lama mengutip `file:line` yang bisa basi (file
 * dipindah/di-refactor) sehingga status PASS tidak lagi didukung bukti.
 *
 * Skrip ini memindai tabel laporan audit, mengekstrak SETIAP rujukan
 * `path.ext:line` / `path.ext:start-end` di dalam backtick, lalu memverifikasi:
 * - file benar-benar ada,
 * - nomor baris berada di dalam ukuran file.
 *
 * Keluar dengan kode 1 bila ada rujukan file hilang atau di luar batas.
 *
 * Pakai:
 *   node scripts/verify-audit-claims.mjs <laporan.md> [...]
 *   node scripts/verify-audit-claims.mjs --all
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

let suffixIndex = null;
function buildSuffixIndex() {
  if (suffixIndex) return suffixIndex;
  const index = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const rel = path.relative(ROOT, p).split(path.sep).join('/');
        index.set(rel, p);
      }
    }
  };
  walk(ROOT);
  suffixIndex = index;
  return index;
}


const DEFAULT_TARGETS = [
  'docs/audit/2026-11-02/fase-01/LAPORAN_FASE_01.md',
  'docs/audit/2026-11-02/fase-11/LAPORAN_FASE_11.md',
];

// `src/a.ts:12`, `src/a.ts:12-30`, `src/a.ts:12, 80`
const REFERENCE_RE = /`([A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|json|md|sql|prisma|yml|yaml|sh)):([0-9][0-9,\s-]*)`/g;

function resolveReference(rawPath) {
  const candidates = [
    path.join(ROOT, rawPath),
    path.join(ROOT, 'packages/admin-dashboard', rawPath),
  ];
  const direct = candidates.find((c) => fs.existsSync(c));
  if (direct) return direct;

  // Rujukan audit lama kadang hanya menulis nama file relatif tanpa folder
  // (mis. `customer.repository.ts`). Cari sufiks unik di repo.
  const needle = `/${rawPath.replace(/^\.?\//, '')}`;
  const matches = [];
  for (const [rel, abs] of buildSuffixIndex()) {
    if (rel === rawPath || `/${rel}`.endsWith(needle)) matches.push(abs);
  }
  return matches.length === 1 ? matches[0] : null;
}

function parseLines(spec) {
  // "12", "12-30", "12,80", "320-360, 400"
  const parts = spec.split(',').map((s) => s.trim()).filter(Boolean);
  const values = [];
  for (const part of parts) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      values.push({ start: Number(range[1]), end: Number(range[2]) });
    } else if (/^\d+$/.test(part)) {
      values.push({ start: Number(part), end: Number(part) });
    }
  }
  return values;
}

function verifyReport(reportPath) {
  const abs = path.isAbsolute(reportPath) ? reportPath : path.join(ROOT, reportPath);
  if (!fs.existsSync(abs)) {
    return { reportPath, error: 'laporan tidak ditemukan', refs: [] };
  }
  const content = fs.readFileSync(abs, 'utf8');
  const lineCountCache = new Map();
  const refs = [];

  for (const match of content.matchAll(REFERENCE_RE)) {
    const [, rawPath, spec] = match;
    const resolved = resolveReference(rawPath);
    if (!resolved) {
      refs.push({ rawPath, spec, status: 'MISSING_FILE' });
      continue;
    }
    let lineCount = lineCountCache.get(resolved);
    if (lineCount === undefined) {
      lineCount = fs.readFileSync(resolved, 'utf8').split(/\r?\n/).length;
      lineCountCache.set(resolved, lineCount);
    }
    const ranges = parseLines(spec);
    if (ranges.length === 0) {
      refs.push({ rawPath, spec, status: 'INVALID_SPEC' });
      continue;
    }
    const outOfRange = ranges.filter((r) => r.start < 1 || r.end > lineCount || r.start > r.end);
    if (outOfRange.length > 0) {
      refs.push({
        rawPath,
        spec,
        status: 'OUT_OF_RANGE',
        detail: `file hanya ${lineCount} baris; rujukan ${outOfRange
          .map((r) => `${r.start}-${r.end}`)
          .join(', ')} di luar batas`,
      });
    } else {
      refs.push({ rawPath, spec, status: 'OK' });
    }
  }

  return { reportPath, refs };
}

function main() {
  const args = process.argv.slice(2);
  const targets = args.length === 0 || args.includes('--all') ? DEFAULT_TARGETS : args;

  let failures = 0;
  let totalRefs = 0;

  for (const target of targets) {
    const { error, refs } = verifyReport(target);
    console.log(`\n📄 ${target}`);
    if (error) {
      console.error(`  ❌ ${error}`);
      failures += 1;
      continue;
    }
    totalRefs += refs.length;
    const bad = refs.filter((r) => r.status !== 'OK');
    const okCount = refs.length - bad.length;
    console.log(`  Rujukan diperiksa: ${refs.length} (OK ${okCount}, bermasalah ${bad.length})`);
    for (const r of bad) {
      console.error(`  ❌ ${r.status}: ${r.rawPath}:${r.spec}${r.detail ? ` — ${r.detail}` : ''}`);
      failures += 1;
    }
  }

  console.log(`\nTotal rujukan: ${totalRefs}`);
  if (failures > 0) {
    console.error(`\n❌ [AUDIT CLAIM GATE] ${failures} rujukan tidak valid. Perbaiki laporan/rujukan.`);
    process.exit(1);
  }
  console.log('\n✅ [AUDIT CLAIM GATE] Semua rujukan file:line valid.');
}

main();
