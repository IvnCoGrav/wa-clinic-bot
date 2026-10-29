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
  // Komentar CSS mendokumentasikan nilai token (mis. /* #f0f2f5 */) — bukan warna aktif.
  let text = readFileSync(f, 'utf8');
  if (extname(f) === '.css') text = text.replace(/\/\*[\s\S]*?\*\//g, '');
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
process.exit(0);
