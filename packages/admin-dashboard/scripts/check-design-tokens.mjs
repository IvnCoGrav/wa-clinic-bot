#!/usr/bin/env node
// Gerbang anti-regresi warna hardcode. Zero dependency (node:fs saja).
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const SCAN_ROOTS = [join(PKG, 'src'), join(PKG, 'index.html')];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.html', '.css']);
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const BASELINE_FILE = join(PKG, 'scripts', 'design-token-baseline.json');

function collect(target, acc = []) {
  const st = statSync(target);
  if (st.isFile()) {
    if (SCAN_EXT.has(extname(target))) acc.push(target);
    return acc;
  }
  for (const e of readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    collect(join(target, e.name), acc);
  }
  return acc;
}

const key = (f) => relative(PKG, f).split('\\').join('/');
const files = SCAN_ROOTS.filter((r) => existsSync(r)).flatMap((r) => collect(r));

const counts = {};
for (const f of files) {
  // Komentar bukan warna aktif. Dua jenis komentar dibuang:
  // 1. Blok /* ... */ (termasuk dokumentasi token CSS).
  // 2. Komentar baris yang dimulai di awal baris (`//`, `*`, `<!--`).
  //    Sengaja hanya yang di awal baris supaya `https://` di dalam string tidak
  //    memotong sisa baris dan menyembunyikan warna sungguhan.
  // Alasan: referensi audit seperti `#301` / `#316` berbentuk mirip warna 3 digit
  // dan sebelumnya salah dihitung sebagai hex hardcode.
  let text = readFileSync(f, 'utf8');
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  text = text.replace(/^\s*\/\/.*$/gm, '');
  text = text.replace(/^\s*\*.*$/gm, '');
  text = text.replace(/^\s*<!--[\s\S]*?-->/gm, '');
  // <meta name="theme-color"> dibaca browser sebelum CSS dimuat, jadi nilainya
  // wajib literal dan tidak bisa memakai var(--token). Pengecualian platform ini
  // bukan celah: tetap dijaga manual agar sama dengan kanvas terang/gelap.
  text = text.replace(/<meta[^>]*name="theme-color"[^>]*>/g, '');
  const n = (text.match(HEX_RE) || []).length;
  if (n > 0) counts[key(f)] = n;
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
  console.log(`Baseline diperbarui: ${sum(counts)} hex di ${Object.keys(counts).length} file.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  : {};

const over = Object.entries(counts).filter(([f, n]) => n > (baseline[f] ?? 0));
const now = sum(counts), base = sum(baseline);

console.log(`hex hardcode: ${now} (baseline ${base}, files ${Object.keys(counts).length})`);

if (over.length) {
  for (const [f, n] of over) {
    console.error(`GAGAL ${f}: ${n} hex, batas ${baseline[f] ?? 0}`);
  }
  console.error('\nDilarang menambah warna hardcode. Pakai token dari src/index.css.');
  process.exit(1);
}
if (now < base) console.log('Baseline bisa diturunkan: npm run check:tokens -- --update');

// `transition-all` menganimasikan SEMUA properti, termasuk width/height/padding
// yang memicu layout sinkron tiap frame. Pakai `transition` (warna, latar,
// border, opacity, shadow, transform) atau `transition-[properti]` eksplisit.
const transitionAll = [];
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const hits = raw.match(/\btransition-all\b/g);
  if (hits) transitionAll.push(`${key(f)}: ${hits.length}`);
}

if (transitionAll.length) {
  console.error(`GAGAL: transition-all ditemukan di ${transitionAll.length} berkas.`);
  for (const entry of transitionAll) console.error('  ' + entry);
  console.error('\nGanti dengan `transition` atau `transition-[properti]` yang spesifik.');
  process.exit(1);
}

process.exit(0);
