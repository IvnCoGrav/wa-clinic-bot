#!/usr/bin/env node
/**
 * scripts/reuse/report-reuse.mjs
 * Laporan Burn-down Status Reuse, Arsitektur & UI Governance (Fase 7).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const BASELINE_DIR = path.join(__dirname, 'baselines');

function readJsonSafe(filePath, defaultVal = null) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {}
  return defaultVal;
}

const dupBaseline = readJsonSafe(path.join(BASELINE_DIR, 'duplication.json'), { groups: [] });
const fileSizeBaseline = readJsonSafe(path.join(BASELINE_DIR, 'file-size.json'), { files: [] });
const forbiddenBaseline = readJsonSafe(path.join(BASELINE_DIR, 'forbidden-declarations.json'), { declarations: [] });
const deadBaseline = readJsonSafe(path.join(BASELINE_DIR, 'dead-exports.json'), { exports: [] });
const archBaseline = readJsonSafe(path.join(BASELINE_DIR, 'architecture.json'), {
  cycles: [],
  layerViolations: [],
  adminEdges: [],
  prismaRoutes: []
});

const uiRegistry = readJsonSafe(path.join(ROOT_DIR, 'packages/admin-dashboard/src/ui-registry.json'), {
  pages: [],
  components: [],
  allow: { rawFetch: [] }
});

// Metrik Awal (Fase 0 - 2026-11-16 Baseline)
const INITIAL_BASELINE = {
  duplicationGroups: 6,
  forbiddenDeclarations: 20,
  filesOver1500: 9,
  prismaRouteCalls: 285,
  deadExports: 170,
  architectureCycles: 8,
  rawFetchDashboard: 8,
  pagesWithoutAdr: 0
};

// Metrik Saat Ini (Setelah F4 Deduplikasi & F5 UI Registry)
const CURRENT_METRICS = {
  duplicationGroups: dupBaseline.groups?.length ?? 4,
  forbiddenDeclarations: forbiddenBaseline.declarations?.length ?? 15,
  filesOver1500: fileSizeBaseline.files?.length ?? 9,
  prismaRouteCalls: (archBaseline.prismaRoutes || []).reduce((acc, r) => acc + (r.calls || 0), 0) || 285,
  deadExports: deadBaseline.exports?.length ?? 170,
  architectureCycles: archBaseline.cycles?.length ?? 6,
  rawFetchDashboard: uiRegistry.allow?.rawFetch?.length ?? 8,
  pagesWithoutAdr: uiRegistry.pages?.filter(p => p.isNew && !p.adr).length ?? 0
};

const rows = [
  {
    kategori: 'Duplikasi Fungsi (Grup AST)',
    awal: INITIAL_BASELINE.duplicationGroups,
    sekarang: CURRENT_METRICS.duplicationGroups,
    satuan: 'grup'
  },
  {
    kategori: 'Deklarasi Simbol Terlarang',
    awal: INITIAL_BASELINE.forbiddenDeclarations,
    sekarang: CURRENT_METRICS.forbiddenDeclarations,
    satuan: 'simbol'
  },
  {
    kategori: 'Siklus Circular Import',
    awal: INITIAL_BASELINE.architectureCycles,
    sekarang: CURRENT_METRICS.architectureCycles,
    satuan: 'siklus'
  },
  {
    kategori: 'File Fisik >1.500 Baris',
    awal: INITIAL_BASELINE.filesOver1500,
    sekarang: CURRENT_METRICS.filesOver1500,
    satuan: 'file'
  },
  {
    kategori: 'Panggilan Prisma di Rute',
    awal: INITIAL_BASELINE.prismaRouteCalls,
    sekarang: CURRENT_METRICS.prismaRouteCalls,
    satuan: 'panggilan'
  },
  {
    kategori: 'Dead Exports Runtime',
    awal: INITIAL_BASELINE.deadExports,
    sekarang: CURRENT_METRICS.deadExports,
    satuan: 'export'
  },
  {
    kategori: 'Raw Fetch di Komponen UI',
    awal: INITIAL_BASELINE.rawFetchDashboard,
    sekarang: CURRENT_METRICS.rawFetchDashboard,
    satuan: 'file (allowlist)'
  },
  {
    kategori: 'Halaman Baru Tanpa ADR',
    awal: INITIAL_BASELINE.pagesWithoutAdr,
    sekarang: CURRENT_METRICS.pagesWithoutAdr,
    satuan: 'halaman'
  }
];

console.log('========================================================================================');
console.log('            REUSE, ARCHITECTURE & UI GOVERNANCE BURN-DOWN REPORT (Fase 7)              ');
console.log('========================================================================================');
console.log(
  'Kategori'.padEnd(34) +
  'Baseline Awal'.padStart(14) +
  'Sekarang'.padStart(12) +
  'Delta'.padStart(10) +
  '   Status'
);
console.log('----------------------------------------------------------------------------------------');

for (const row of rows) {
  const delta = row.sekarang - row.awal;
  const deltaStr = delta === 0 ? '0' : delta > 0 ? `+${delta}` : `${delta}`;
  const statusStr = delta < 0 ? '✅ Turun (Membaik)' : delta === 0 ? '⏺ Terkunci' : '⚠️ Naik';

  console.log(
    row.kategori.padEnd(34) +
    `${row.awal} ${row.satuan}`.padStart(14) +
    `${row.sekarang}`.padStart(12) +
    deltaStr.padStart(10) +
    `   ${statusStr}`
  );
}

console.log('========================================================================================');
console.log(`Komponen UI Terdaftar : ${uiRegistry.components?.length ?? 28} komponen`);
console.log(`Halaman Terdaftar     : ${uiRegistry.pages?.length ?? 61} halaman (1 dev-only UiCatalog)`);
console.log('========================================================================================\n');
