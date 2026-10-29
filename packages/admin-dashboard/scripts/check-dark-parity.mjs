#!/usr/bin/env node
/**
 * Gerbang paritas mode gelap (design system v2).
 *
 * Masalah yang dicegah: warna latar/teks yang hanya didefinisikan untuk satu mode
 * (mis. `bg-white` atau `bg-emerald-50` tanpa pasangan `dark:` dan tanpa token)
 * akan membuat UI menyala terang di dark mode.
 *
 * Metrik dihitung per file dan HANYA BOLEH TURUN. Jalankan `--update` setelah
 * sengaja menurunkan angka (ratchet).
 *
 * Batasan yang disadari: deteksi berbasis baris. `className` multi-baris yang
 * menaruh `dark:` di baris berbeda akan terhitung sebagai belum berpasangan —
 * itu sengaja (konservatif), bukan bug gerbang.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(PKG, 'src');
const BASELINE_FILE = join(PKG, 'scripts', 'dark-parity-baseline.json');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const EXT = new Set(['.ts', '.tsx']);

/**
 * Pengecualian eksplisit (keputusan D-5).
 *
 * `StitchShowcase.tsx` adalah GALERI REFERENSI DESAIN: isi halamannya memang
 * memamerkan palet mentah beserta contoh terang/gelapnya. Memetakannya ke token
 * akan menghapus fungsi peraganya. Karena itu ia dikecualikan PERMANEN dengan
 * nama (bukan dibiarkan sebagai angka dalam baseline) supaya:
 *   1. baseline file lain bisa turun ke 0 dan gerbang kembali ketat, dan
 *   2. pengecualian ini terlihat jelas saat file di-review.
 *
 * Bila halaman ini suatu saat berhenti menjadi galeri, hapus entri ini dan
 * migrasikan seperti modul lain.
 */
const EXCLUDED_FILES = new Set(['src/pages/StitchShowcase.tsx']);

// Kelas palet Tailwind mentah = kosakata warna paralel di luar token semantik.
const HUES = 'emerald|green|teal|lime|amber|yellow|orange|rose|red|pink|sky|blue|indigo|cyan|violet|purple|fuchsia|slate|gray|zinc|neutral|stone';
const PALETTE_RE = new RegExp(`\\b(?:bg|text|border|ring|from|via|to|divide|fill|stroke)-(?:${HUES})-\\d{2,3}\\b`, 'g');
const BG_WHITE_RE = /\bbg-white(?![\w/-])/g;

function collect(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p, acc);
    else if (EXT.has(extname(p))) acc.push(p);
  }
  return acc;
}

const key = (f) => relative(PKG, f).split('\\').join('/');

const current = {};
for (const f of collect(SRC)) {
  const k = key(f);
  if (EXCLUDED_FILES.has(k)) continue;
  let bgWhite = 0;
  let palette = 0;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (/dark:/.test(line)) continue;
    bgWhite += (line.match(BG_WHITE_RE) || []).length;
    palette += (line.match(PALETTE_RE) || []).length;
  }
  if (bgWhite || palette) current[k] = { bgWhite, palette };
}

const sum = (field) => Object.values(current).reduce((a, v) => a + (v[field] || 0), 0);

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2) + '\n');
  console.log(`Baseline paritas diperbarui: bgWhite=${sum('bgWhite')} palette=${sum('palette')} di ${Object.keys(current).length} file.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};
const failures = [];

for (const [file, now] of Object.entries(current)) {
  const base = baseline[file] || { bgWhite: 0, palette: 0 };
  if (now.bgWhite > (base.bgWhite || 0)) failures.push(`${file}: bg-white tanpa dark: ${now.bgWhite} (batas ${base.bgWhite || 0})`);
  if (now.palette > (base.palette || 0)) failures.push(`${file}: kelas palet tanpa dark: ${now.palette} (batas ${base.palette || 0})`);
}

console.log(`paritas dark: bgWhite=${sum('bgWhite')} palette=${sum('palette')} (baseline bgWhite=${Object.values(baseline).reduce((a, v) => a + (v.bgWhite || 0), 0)}, palette=${Object.values(baseline).reduce((a, v) => a + (v.palette || 0), 0)})`);

// Sanity check: pengecualian yang sudah tidak ada filenya = pengecualian basi.
const staleExclusions = [...EXCLUDED_FILES].filter((rel) => !existsSync(join(PKG, rel)));
if (staleExclusions.length) {
  for (const f of staleExclusions) console.error(`GAGAL pengecualian basi (file tidak ada): ${f}`);
  process.exit(1);
}

if (failures.length) {
  for (const f of failures) console.error(`GAGAL ${f}`);
  console.error('\nGunakan token (bg-surface, text-success, border-warning-line, ...) atau pasangkan dark:.');
  console.error('Rincian kontrak: docs/QUEUE_DESIGN_SYSTEM_V2.md');
  process.exit(1);
}

const improved = Object.entries(current).some(([file, now]) => {
  const base = baseline[file] || { bgWhite: 0, palette: 0 };
  return now.bgWhite < (base.bgWhite || 0) || now.palette < (base.palette || 0);
});
if (improved) console.log('Baseline bisa diturunkan: npm run check:dark-parity -- --update');
process.exit(0);
