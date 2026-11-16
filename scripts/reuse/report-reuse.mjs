#!/usr/bin/env node
/**
 * scripts/reuse/report-reuse.mjs
 * Laporan Burn-down Status Reuse, Arsitektur & UI Governance (Fase 7).
 *
 * Murni data-driven: membaca langsung dari file baseline dan ui-registry.json.
 * DILARANG menggunakan angka fallback hardcode; jika baseline hilang/rusak, wajib fail.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const BASELINE_DIR = path.join(__dirname, 'baselines');

export function readJsonStrict(filePath, requiredKey = null) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[REPORT ERROR] File baseline tidak ditemukan: ${filePath}`);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`[REPORT ERROR] Gagal membaca/parse JSON pada ${filePath}: ${err.message}`);
  }
  if (requiredKey && (data[requiredKey] === undefined || data[requiredKey] === null)) {
    throw new Error(`[REPORT ERROR] Kunci wajib "${requiredKey}" tidak ditemukan di ${filePath}`);
  }
  return data;
}

export function collectMetrics(baselineDir = BASELINE_DIR, rootDir = ROOT_DIR) {
  const dupBaseline = readJsonStrict(path.join(baselineDir, 'duplication.json'), 'groups');
  const forbiddenBaseline = readJsonStrict(path.join(baselineDir, 'forbidden-declarations.json'), 'violations');
  const fileSizeBaseline = readJsonStrict(path.join(baselineDir, 'file-size.json'), 'files');
  const deadBaseline = readJsonStrict(path.join(baselineDir, 'dead-exports.json'), 'deadExports');
  const archBaseline = readJsonStrict(path.join(baselineDir, 'architecture.json'), 'prismaBudget');
  const uiRegistry = readJsonStrict(path.join(rootDir, 'packages/admin-dashboard/src/ui-registry.json'), 'pages');

  if (typeof archBaseline.prismaBudget?.totalCalls !== 'number') {
    throw new Error(`[REPORT ERROR] prismaBudget.totalCalls wajib bernilai number di architecture.json`);
  }
  if (!Array.isArray(archBaseline.cycles)) {
    throw new Error(`[REPORT ERROR] cycles wajib bernilai array di architecture.json`);
  }

  const baselinePageSet = new Set(uiRegistry.baselinePages || []);
  const pagesWithoutAdr = uiRegistry.pages.filter(p => !baselinePageSet.has(p.path) && !p.adr).length;

  return {
    duplicationGroups: dupBaseline.groups.length,
    forbiddenDeclarations: forbiddenBaseline.violations.length,
    filesOver1500: fileSizeBaseline.files.length,
    prismaRouteCalls: archBaseline.prismaBudget.totalCalls,
    deadExports: deadBaseline.deadExports.length,
    architectureCycles: archBaseline.cycles.length,
    rawFetchDashboard: uiRegistry.allow?.rawFetch?.length ?? 0,
    pagesWithoutAdr,
    uiComponentsCount: uiRegistry.components?.length ?? 0,
    uiPagesCount: uiRegistry.pages?.length ?? 0
  };
}

export function generateReport(baselineDir = BASELINE_DIR, rootDir = ROOT_DIR) {
  // Metrik Awal (Fase 0 - 2026-11-16 Baseline Terkunci)
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

  const current = collectMetrics(baselineDir, rootDir);

  const rows = [
    {
      kategori: 'Duplikasi Fungsi (Grup AST)',
      awal: INITIAL_BASELINE.duplicationGroups,
      sekarang: current.duplicationGroups,
      satuan: 'grup'
    },
    {
      kategori: 'Deklarasi Simbol Terlarang',
      awal: INITIAL_BASELINE.forbiddenDeclarations,
      sekarang: current.forbiddenDeclarations,
      satuan: 'simbol'
    },
    {
      kategori: 'Siklus Circular Import',
      awal: INITIAL_BASELINE.architectureCycles,
      sekarang: current.architectureCycles,
      satuan: 'siklus'
    },
    {
      kategori: 'File Fisik >1.500 Baris',
      awal: INITIAL_BASELINE.filesOver1500,
      sekarang: current.filesOver1500,
      satuan: 'file'
    },
    {
      kategori: 'Panggilan Prisma di Rute',
      awal: INITIAL_BASELINE.prismaRouteCalls,
      sekarang: current.prismaRouteCalls,
      satuan: 'panggilan'
    },
    {
      kategori: 'Dead Exports Runtime',
      awal: INITIAL_BASELINE.deadExports,
      sekarang: current.deadExports,
      satuan: 'export'
    },
    {
      kategori: 'Raw Fetch di Komponen UI',
      awal: INITIAL_BASELINE.rawFetchDashboard,
      sekarang: current.rawFetchDashboard,
      satuan: 'file (allowlist)'
    },
    {
      kategori: 'Halaman Baru Tanpa ADR',
      awal: INITIAL_BASELINE.pagesWithoutAdr,
      sekarang: current.pagesWithoutAdr,
      satuan: 'halaman'
    }
  ];

  return { current, rows };
}

export function printReport() {
  const { current, rows } = generateReport();

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
  console.log(`Komponen UI Terdaftar : ${current.uiComponentsCount} komponen`);
  console.log(`Halaman Terdaftar     : ${current.uiPagesCount} halaman`);
  console.log('========================================================================================\n');
}

// Eksekusi langsung jika dipanggil dari CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    printReport();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
