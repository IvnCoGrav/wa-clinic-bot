/**
 * scripts/audit-deadcode.mjs
 * Tooling audit dead code:
 * - Export mati (0 rujukan)
 * - Export hanya dipakai test (test-only)
 * - File yatim (0 import)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ROOT_DIR, 'src');
const TESTS_DIR = path.resolve(ROOT_DIR, 'tests');
const SCRIPTS_DIR = path.resolve(ROOT_DIR, 'scripts');
const DASHBOARD_DIR = path.resolve(ROOT_DIR, 'packages', 'admin-dashboard', 'src');

function getAllFiles(dir, exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs']) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      results.push(...getAllFiles(fullPath, exts));
    } else if (entry.isFile() && exts.includes(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

// 1. Kumpulkan file
const srcFiles = getAllFiles(SRC_DIR, ['.ts', '.tsx']);
const testFiles = getAllFiles(TESTS_DIR, ['.ts', '.tsx']);
const scriptFiles = getAllFiles(SCRIPTS_DIR, ['.ts', '.tsx', '.js', '.mjs']);
const dashboardFiles = getAllFiles(DASHBOARD_DIR, ['.ts', '.tsx']);
const allExternalFiles = [...testFiles, ...scriptFiles, ...dashboardFiles];

console.log(`[AUDIT DEADCODE] Memindai ${srcFiles.length} file di src/ ...`);

// Cache isi file untuk pencarian cepat
const fileContents = new Map();
for (const file of [...srcFiles, ...allExternalFiles]) {
  try {
    fileContents.set(file, fs.readFileSync(file, 'utf8'));
  } catch (err) {
    // ignore
  }
}

// 2. Ekstrak export dari src/
const exportedSymbols = []; // { symbol, file, line, kind }

const EXPORT_REGEXES = [
  // export (const|let|var|function|class|type|interface|enum) Name
  /export\s+(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([a-zA-Z0-9_$]+)/g,
  // export { A, B as C }
  /export\s*\{([^}]+)\}/g,
];

for (const file of srcFiles) {
  const content = fileContents.get(file) || '';
  const lines = content.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (!line.includes('export')) continue;
    // abaikan export default
    if (/export\s+default\b/.test(line)) continue;
    // abaikan export * from
    if (/export\s+\*\s+from/.test(line)) continue;

    // Direct declaration
    const directMatch = /export\s+(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+([a-zA-Z0-9_$]+)/.exec(line);
    if (directMatch) {
      exportedSymbols.push({
        symbol: directMatch[1],
        file: path.relative(ROOT_DIR, file).replace(/\\/g, '/'),
        fullPath: file,
        line: lineIdx + 1,
      });
      continue;
    }

    // Export clause { A, B as C }
    const clauseMatch = /export\s*\{([^}]+)\}/.exec(line);
    if (clauseMatch) {
      const parts = clauseMatch[1].split(',');
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const asMatch = trimmed.match(/(?:[a-zA-Z0-9_$]+\s+as\s+)?([a-zA-Z0-9_$]+)/);
        if (asMatch && asMatch[1]) {
          exportedSymbols.push({
            symbol: asMatch[1],
            file: path.relative(ROOT_DIR, file).replace(/\\/g, '/'),
            fullPath: file,
            line: lineIdx + 1,
          });
        }
      }
    }
  }
}

console.log(`[AUDIT DEADCODE] Ditemukan ${exportedSymbols.length} exported symbols.`);

// 3. Analisis penggunaan setiap export
const deadExports = [];
const testOnlyExports = [];
const activeExports = [];

for (const exp of exportedSymbols) {
  const sym = exp.symbol;
  // Regex identifier boundary
  const refRegex = new RegExp(`\\b${sym}\\b`, 'g');

  let srcRefs = 0;
  let testRefs = 0;
  let otherRefs = 0;

  // Cek di src (selain file asal)
  for (const file of srcFiles) {
    const content = fileContents.get(file) || '';
    const matches = content.match(refRegex);
    if (!matches) continue;
    if (file === exp.fullPath) {
      // Di file sendiri, jika muncul > 1 kali berarti dipakai internal
      if (matches.length > 1) {
        srcRefs += (matches.length - 1);
      }
    } else {
      srcRefs += matches.length;
    }
  }

  // Cek di test
  for (const file of testFiles) {
    const content = fileContents.get(file) || '';
    const matches = content.match(refRegex);
    if (matches) testRefs += matches.length;
  }

  // Cek di scripts & dashboard
  for (const file of [...scriptFiles, ...dashboardFiles]) {
    const content = fileContents.get(file) || '';
    const matches = content.match(refRegex);
    if (matches) otherRefs += matches.length;
  }

  if (srcRefs === 0 && testRefs === 0 && otherRefs === 0) {
    deadExports.push({ ...exp, srcRefs, testRefs, otherRefs });
  } else if (srcRefs === 0 && otherRefs === 0 && testRefs > 0) {
    testOnlyExports.push({ ...exp, srcRefs, testRefs, otherRefs });
  } else {
    activeExports.push({ ...exp, srcRefs, testRefs, otherRefs });
  }
}

// 4. Analisis orphan files di src/
// File tanpa import sama sekali dari mana pun (kecuali entry point)
const ENTRY_POINTS = new Set([
  'src/app.ts',
  'src/worker.ts',
  'src/server.ts',
  'src/cli/',
]);

const orphanFiles = [];
for (const file of srcFiles) {
  const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
  if (Array.from(ENTRY_POINTS).some(ep => rel.startsWith(ep))) continue;

  const baseName = path.basename(file, path.extname(file));
  const importRegex = new RegExp(`['"][^'"]*\\/${baseName}(?:\\.js)?['"]`, 'g');

  let importedCount = 0;
  for (const [targetFile, content] of fileContents.entries()) {
    if (targetFile === file) continue;
    if (importRegex.test(content)) {
      importedCount++;
      break;
    }
  }

  if (importedCount === 0) {
    orphanFiles.push(rel);
  }
}

const report = {
  timestamp: new Date().toISOString(),
  metrics: {
    totalSrcFiles: srcFiles.length,
    totalExportsScanned: exportedSymbols.length,
    deadExportsCount: deadExports.length,
    testOnlyExportsCount: testOnlyExports.length,
    activeExportsCount: activeExports.length,
    orphanFilesCount: orphanFiles.length,
  },
  deadExports: deadExports.map(d => ({
    symbol: d.symbol,
    file: d.file,
    line: d.line,
  })),
  testOnlyExports: testOnlyExports.map(t => ({
    symbol: t.symbol,
    file: t.file,
    line: t.line,
    testRefs: t.testRefs,
  })),
  orphanFiles,
};

const OUT_PATH = path.resolve(ROOT_DIR, 'docs', 'audit', '2026-11-08', 'deadcode-before.json');
fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');

console.log(`\n========================================`);
console.log(`[AUDIT DEADCODE SELESAI]`);
console.log(`- Dead exports (0 rujukan): ${deadExports.length}`);
console.log(`- Test-only exports:        ${testOnlyExports.length}`);
console.log(`- Orphan files (0 import):  ${orphanFiles.length}`);
console.log(`- Laporan disimpan di:      ${path.relative(ROOT_DIR, OUT_PATH)}`);
console.log(`========================================\n`);
