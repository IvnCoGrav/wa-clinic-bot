#!/usr/bin/env node
/**
 * Gerbang string aksesibilitas (tanpa dependency).
 *
 * Memeriksa empat pola yang terbukti berulang di audit UI/UX:
 *   1. <label> tanpa htmlFor
 *   2. <button> yang hanya berisi ikon tanpa nama aksesibel
 *   3. <div|span> dengan onClick tanpa role
 *   4. outline-none / outline-0 tanpa pengganti fokus di baris yang sama
 *
 * Catatan `title`: `title` TIDAK dihitung sebagai nama aksesibel yang sah.
 * Tooltip tidak muncul di layar sentuh dan tidak diumumkan pembaca layar secara
 * konsisten; tombol ikon wajib punya `aria-label`/`aria-labelledby`. `title`
 * boleh tetap dipakai sebagai tooltip untuk pengguna mouse.
 *
 * Sifat gerbang: RATCHET. Angka per file hanya boleh TURUN.
 * Baseline disimpan di scripts/a11y-baseline.json.
 *
 * Catatan konservatif: <label> yang membungkus input (implicit association)
 * tetap dihitung sebagai pelanggaran. Ini disengaja karena pemeriksaan berbasis
 * baris; angka yang lebih tinggi dari kenyataan tidak berbahaya selama hanya
 * boleh turun.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(PKG, 'src');
const BASELINE = join(PKG, 'scripts', 'a11y-baseline.json');
const UPDATE = process.argv.includes('--update');

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (p.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

const counts = {};
const details = [];

for (const file of walk(SRC)) {
  const rel = relative(PKG, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  let n = 0;
  const bump = (msg) => {
    n += 1;
    details.push(`${rel}: ${msg}`);
  };

  for (const m of text.matchAll(/<label\b[^>]*>/g)) {
    if (!/htmlFor=/.test(m[0])) bump('label tanpa htmlFor');
  }

  for (const m of text.matchAll(/<button\b[\s\S]*?<\/button>/g)) {
    const block = m[0];
    const hasIcon = /<[A-Z]\w*[^>]*\/>/.test(block);
    const inner = block.replace(/<[^>]+>/g, ' ').replace(/\{[^{}]*\}/g, ' ').trim();
    const hasText = /[A-Za-z]{2,}/.test(inner);
    const named = /aria-label=|aria-labelledby=/.test(block);
    if (hasIcon && !hasText && !named) bump('tombol ikon tanpa nama');
  }

  for (const m of text.matchAll(/<(div|span)\b[^>]*onClick=[^>]*>/g)) {
    if (!/role=/.test(m[0])) bump('<div|span> onClick tanpa role');
  }

  for (const line of text.split(/\r?\n/)) {
    if (/outline-none|outline-0/.test(line) && !/focus-visible|ring-|border-/.test(line)) {
      bump('outline-none tanpa pengganti');
    }
  }

  if (n) counts[rel] = n;
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;

if (UPDATE || !baseline) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
  console.log(`Baseline a11y ditulis: ${total} pola di ${Object.keys(counts).length} file.`);
  process.exit(0);
}

const over = Object.entries(counts).filter(([f, n]) => n > (baseline[f] ?? 0));
const baseTotal = Object.values(baseline).reduce((a, b) => a + b, 0);

if (over.length) {
  console.error('GAGAL: pola aksesibilitas bertambah');
  for (const [f, n] of over) console.error(`  ${f}: ${n} (batas ${baseline[f] ?? 0})`);
  details.slice(0, 40).forEach((d) => console.error('  ' + d));
  process.exit(1);
}

console.log(`a11y OK: ${total} pola (batas ${baseTotal}) di ${Object.keys(counts).length} file.`);
if (total < baseTotal) {
  console.log('Baseline bisa diturunkan: node scripts/check-a11y-strings.mjs --update');
}
