#!/usr/bin/env node
/**
 * Gerbang pasangan kontras: teks putih di atas permukaan solid.
 *
 * Membaca token warna dari src/index.css (mode terang dan gelap), menghitung
 * rasio kontras WCAG, lalu memeriksa setiap baris kelas yang memuat
 * `bg-<token-solid>` bersama `text-white` tanpa token `on-solid`/`accent-ink`.
 *
 * Kenapa gerbang ini ada: token mode gelap sengaja dibuat terang (#00a884,
 * #f87171, #f59e0b, #38bdf8), sehingga teks putih di atasnya hanya mencapai
 * 2,14:1 - 3,03:1. Standar WCAG AA untuk teks normal adalah 4,5:1.
 *
 * Tanpa dependency. Exit 1 bila ada pelanggaran atau token tidak terbaca.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const CSS = join(PKG, 'src', 'index.css');
const css = readFileSync(CSS, 'utf8');
const SOLID = ['accent', 'success', 'danger', 'warning', 'info', 'caution', 'violet'];

function readBlock(marker, size = 5000) {
  const start = css.indexOf(marker);
  if (start < 0) return {};
  const slice = css.slice(start, start + size);
  const out = {};
  for (const name of SOLID) {
    const m = slice.match(new RegExp(`--c-${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
    if (m) out[name] = [+m[1], +m[2], +m[3]];
    const soft = slice.match(new RegExp(`--c-${name}-soft:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
    if (soft) out[`${name}-soft`] = [+soft[1], +soft[2], +soft[3]];
  }
  return out;
}

const light = readBlock(':root {');
const dark = readBlock('.dark {');

const missing = SOLID.filter((t) => !light[t] || !dark[t]);
if (missing.length) {
  console.error('GAGAL: token tidak terbaca dari src/index.css:', missing.join(', '));
  process.exit(1);
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (p.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

let failures = 0;
const perToken = {};
// Hanya latar SOLID: bukan varian state (hover:/focus:), bukan turunan token
// (-soft/-line/-hover), bukan opasitas (/10).
const bgRe = new RegExp(`(?<![:\\w-])bg-(${SOLID.join('|')})(?![\\w/-])`);
// Hanya teks putih tanpa varian mode/state: `dark:text-white` sengaja dikecualikan
// karena itu justru warna yang benar di atas permukaan gelap.
const whiteRe = /(?<![:\w-])text-white/;

for (const file of walk(join(PKG, 'src'))) {
  const rel = relative(PKG, file).replace(/\\/g, '/');
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (!whiteRe.test(line)) return;
    if (/text-on-solid|text-accent-ink/.test(line)) return;
    const m = line.match(bgRe);
    if (!m) return;
    const token = m[1];
    const r = ratio([255, 255, 255], dark[token]);
    if (r < 4.5) {
      failures += 1;
      perToken[token] = (perToken[token] || 0) + 1;
      console.log(`FAIL ${r.toFixed(2)}:1  ${rel}:${i + 1}  bg-${token} + text-white`);
    }
  });
}

if (failures) {
  console.error(`\nGagal: ${failures} pasangan teks putih di atas permukaan solid (mode gelap).`);
  console.error('Rincian per token:', JSON.stringify(perToken));
  process.exit(1);
}

console.log('Kontras OK: tidak ada teks putih di atas permukaan solid tanpa token on-solid.');
