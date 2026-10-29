#!/usr/bin/env node
/**
 * Gerbang kontras WCAG 2.1 AA untuk token desain.
 *
 * Masalah yang dicegah: nilai token bisa diubah tanpa sadar menurunkan kontras
 * di bawah ambang baca (kasus nyata: `--c-ink-3` sempat 3,05:1 di mode terang).
 * Gerbang ini membaca `src/index.css` sebagai sumber kebenaran (bukan angka
 * hafalan) dan menghitung rasio kontras pasangan token yang wajib terbaca.
 *
 * Ambang: 4,5:1 untuk teks normal (WCAG 2.1 AA). Zero dependency.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const CSS_FILE = join(PKG, 'src', 'index.css');
const MIN_RATIO = 4.5;

/** Pasangan yang WAJIB lulus, beserta alasannya. */
const PAIRS = [
  // Teks utama & sekunder di atas seluruh permukaan.
  ['ink', 'surface', 'teks utama di kartu'],
  ['ink', 'surface-2', 'teks utama di header kartu'],
  ['ink', 'app', 'teks utama di kanvas'],
  ['ink-2', 'surface', 'teks sekunder di kartu'],
  ['ink-2', 'surface-2', 'teks sekunder di header kartu'],
  ['ink-2', 'app', 'teks sekunder di kanvas'],
  ['ink-3', 'surface', 'teks tersier di kartu'],
  ['ink-3', 'surface-2', 'teks tersier di header kartu'],
  ['ink-3', 'app', 'teks tersier di kanvas'],
  // Aksen.
  ['accent', 'surface', 'tautan/teks aksen di kartu'],
  ['accent', 'accent-soft', 'teks aksen di chip aksen'],
  ['accent-ink', 'accent', 'label di tombol aksen'],
  // Konten di atas permukaan warna solid (tombol status).
  ...['success', 'info', 'warning', 'caution', 'danger', 'violet'].flatMap((role) => [
    [`on-solid`, role, `label di tombol ${role}`],
    [`on-solid`, `${role}-hover`, `label di tombol ${role} (hover)`],
    [role, `${role}-soft`, `teks ${role} di chip ${role}`],
  ]),
  // Netral.
  ['neutral', 'neutral-soft', 'teks netral di chip netral'],
];

const readTokens = () => {
  const css = readFileSync(CSS_FILE, 'utf8');
  const darkAt = css.indexOf('.dark');
  if (darkAt < 0) throw new Error('Blok `.dark` tidak ditemukan di index.css');
  const light = {};
  const dark = {};
  const re = /--c-([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g;
  for (const m of css.matchAll(re)) {
    const target = m.index < darkAt ? light : dark;
    target[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return { light, dark };
};

const luminance = ([r, g, b]) => {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const { light, dark } = readTokens();
const failures = [];
const missing = new Set();

for (const [mode, tokens] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, reason] of PAIRS) {
    if (!tokens[fg] || !tokens[bg]) {
      missing.add(`${fg} / ${bg}`);
      continue;
    }
    const ratio = contrast(tokens[fg], tokens[bg]);
    if (ratio < MIN_RATIO) {
      failures.push(
        `${mode}: --c-${fg} di atas --c-${bg} = ${ratio.toFixed(2)}:1 (min ${MIN_RATIO}) — ${reason}`
      );
    }
  }
}

const total = PAIRS.length * 2;
console.log(
  `kontras token: ${total - failures.length - missing.size * 2}/${total} pasangan lulus AA di dua mode`
);

if (missing.size) {
  for (const pair of missing) console.error(`GAGAL token tidak didefinisikan: ${pair}`);
}

if (failures.length) {
  for (const f of failures) console.error(`GAGAL ${f}`);
  console.error('\nPerbaiki nilai token di src/index.css atau lengkapi pasangan light + dark.');
  console.error('Rujukan matriks: docs/QUEUE_DESIGN_SYSTEM_V2.md bagian 5.');
  process.exit(1);
}

process.exit(0);
