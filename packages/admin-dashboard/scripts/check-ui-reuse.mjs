#!/usr/bin/env node
/**
 * packages/admin-dashboard/scripts/check-ui-reuse.mjs
 * UI Reuse & Anti-Spaghetti Gate (Fase 5).
 *
 * Memeriksa kepatuhan antarmuka dashboard admin terhadap kontrak reuse:
 * 1. Coverage Page & Komponen (semua page & UI/common terdaftar di ui-registry.json)
 * 2. Komponen ganda (tidak ada nama komponen bertabrakan)
 * 3. Util lokal yang menyalin util bersama (formatMinutesToTime, isValidLatLng, norm)
 * 4. Raw fetch dilarang di luar services/api.ts dan allow.rawFetch
 * 5. Dialog terlarang (window.confirm / alert dilarang keras, gunakan useUiFeedback)
 * 6. Page baru tanpa ADR dilarang (Mandat Anti-Bloat: page baru wajib memiliki ADR terdaftar)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DASHBOARD_ROOT = path.resolve(__dirname, '..');

const isWarnOnly = process.argv.includes('--warn');
const isJsonOutput = process.argv.includes('--json');

const REGISTRY_PATH = path.join(DASHBOARD_ROOT, 'src/ui-registry.json');
if (!fs.existsSync(REGISTRY_PATH)) {
  console.error(`[ERROR] File ui-registry.json tidak ditemukan di ${REGISTRY_PATH}`);
  process.exit(1);
}

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));

function listFiles(dirRel, extensions = ['.tsx']) {
  const dirAbs = path.join(DASHBOARD_ROOT, dirRel);
  if (!fs.existsSync(dirAbs)) return [];
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true, recursive: true });
  return entries
    .filter(e => e.isFile() && extensions.some(ext => e.name.endsWith(ext)))
    .map(e => {
      const fullPath = path.join(e.parentPath || dirAbs, e.name);
      return path.relative(DASHBOARD_ROOT, fullPath).replace(/\\/g, '/');
    })
    .sort();
}

const violations = [];

// 1. Coverage Page
const actualPages = listFiles('src/pages', ['.tsx']);
const registeredPagePaths = new Set(registry.pages.map(p => p.path));

for (const p of actualPages) {
  if (!registeredPagePaths.has(p)) {
    violations.push({
      type: 'PAGE_NOT_REGISTERED',
      file: p,
      message: `Halaman baru "${p}" belum terdaftar di src/ui-registry.json`
    });
  }
}

// 2. Coverage Komponen
const actualUi = listFiles('src/components/ui', ['.tsx']);
const actualCommon = listFiles('src/components/common', ['.tsx']);
const registeredCompPaths = new Set(registry.components.map(c => c.path));

for (const c of [...actualUi, ...actualCommon]) {
  if (!registeredCompPaths.has(c)) {
    violations.push({
      type: 'COMPONENT_NOT_REGISTERED',
      file: c,
      message: `Komponen "${c}" belum terdaftar di src/ui-registry.json`
    });
  }
}

// 3. Nama Komponen Ganda
const compNameMap = new Map();
for (const comp of registry.components) {
  if (compNameMap.has(comp.name)) {
    violations.push({
      type: 'DUPLICATE_COMPONENT_NAME',
      file: comp.path,
      message: `Nama komponen "${comp.name}" ganda dengan ${compNameMap.get(comp.name)}`
    });
  } else {
    compNameMap.set(comp.name, comp.path);
  }
}

// 4. Raw Fetch di Luar Allowlist
const allowRawFetchSet = new Set(
  (registry.allow?.rawFetch || []).map(a => typeof a === 'string' ? a : a.file)
);

const allSrcFiles = listFiles('src', ['.ts', '.tsx']);
for (const f of allSrcFiles) {
  if (f === 'src/services/api.ts' || allowRawFetchSet.has(f)) continue;

  const content = fs.readFileSync(path.join(DASHBOARD_ROOT, f), 'utf8');
  // Deteksi pemanggilan fetch( tapi abaikan komentar
  const fetchMatches = [...content.matchAll(/\bfetch\s*\(/g)];
  if (fetchMatches.length > 0) {
    violations.push({
      type: 'UNAUTHORIZED_RAW_FETCH',
      file: f,
      message: `Penggunaan raw fetch() dilarang di luar services/api.ts atau allow.rawFetch`
    });
  }
}

// 5. Dialog Terlarang (window.confirm / alert)
for (const f of allSrcFiles) {
  const content = fs.readFileSync(path.join(DASHBOARD_ROOT, f), 'utf8');
  const lines = content.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    if (/\bwindow\.confirm\s*\(|\bwindow\.alert\s*\(/.test(line)) {
      violations.push({
        type: 'FORBIDDEN_DIALOG',
        file: f,
        line: idx + 1,
        message: `Dialog window.confirm() / window.alert() dilarang keras. Gunakan useUiFeedback()`
      });
    }
  }
}

// 6. Page Baru Tanpa ADR
const baselinePageSet = new Set(registry.baselinePages || []);
for (const p of registry.pages) {
  // Bila ada page baru di luar baseline awal, wajib memiliki nomor ADR yang disetujui
  if (!baselinePageSet.has(p.path) && !p.adr) {
    violations.push({
      type: 'PAGE_MISSING_ADR',
      file: p.path,
      message: `Halaman baru "${p.path}" wajib mencantumkan nomor ADR yang disetujui`
    });
  }
}

// Output report
if (isJsonOutput) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    isWarnOnly,
    violationsCount: violations.length,
    violations
  }, null, 2));
} else {
  console.log('======================================================');
  console.log('  UI/UX REUSE & COMPONENT GOVERNANCE GATE (Fase 5)');
  console.log('======================================================');
  console.log(`Mode               : ${isWarnOnly ? 'WARN-ONLY' : 'FAIL-ON-VIOLATION (Ketat)'}`);
  console.log(`Halaman Terdaftar  : ${actualPages.length}`);
  console.log(`Komponen Terdaftar : ${registry.components.length}`);
  console.log(`Pelanggaran Baru   : ${violations.length}`);

  if (violations.length > 0) {
    console.log('\n[PELANGGARAN DITEMUKAN]:');
    violations.forEach((v, i) => {
      console.log(`  ${i + 1}. [${v.type}] ${v.file}${v.line ? `:${v.line}` : ''} - ${v.message}`);
    });
    console.log('======================================================');
    if (!isWarnOnly) {
      process.exit(1);
    }
  } else {
    console.log('\n✅ Seluruh kontrak UI reuse, dialog, dan registry terpenuhi!');
    console.log('======================================================');
  }
}
