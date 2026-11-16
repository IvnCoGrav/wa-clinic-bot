#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, toAbsolute, toRelative, exists, listFiles } from './lib/paths.mjs';
import { loadRegistry, validateRegistry } from './lib/registry.mjs';
import { listTsFiles, parseTsFile, collectFunctionLike, collectTopLevelDeclarations, collectExports } from './lib/ast.mjs';
import { computeFingerprint } from './lib/fingerprint.mjs';
import { BASELINE_DIR, getCurrentCommit, loadBaseline, saveBaseline } from './lib/baseline.mjs';

function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = {
    warn: false,
    json: false,
    only: null, // duplication | forbidden | dead-exports | file-size
    root: 'src',
    baselineDir: BASELINE_DIR,
    maxLines: 1500,
    updateBaseline: false,
    allowUpdate: false
  };

  for (const arg of args) {
    if (arg === '--warn') options.warn = true;
    else if (arg === '--json') options.json = true;
    else if (arg.startsWith('--only=')) options.only = arg.split('=')[1];
    else if (arg.startsWith('--root=')) options.root = arg.split('=')[1];
    else if (arg.startsWith('--baseline-dir=')) options.baselineDir = arg.split('=')[1];
    else if (arg.startsWith('--max-lines=')) options.maxLines = parseInt(arg.split('=')[1], 10);
    else if (arg === '--update-baseline') options.updateBaseline = true;
    else if (arg === '--allow-update') options.allowUpdate = true;
  }

  return options;
}

async function runCheck() {
  const options = parseCliArgs();

  // Guard: update-baseline membutuhkan allow-update
  if (options.updateBaseline && !options.allowUpdate) {
    console.error('[REUSE GATE ERROR] Flag --update-baseline membutuhkan --allow-update secara eksplisit.');
    process.exit(1);
  }

  const targetRoot = options.root;
  const isCustomRoot = targetRoot !== 'src';

  // 1. Muat Registry (dan validasi jika target adalah repositori utama src)
  let registry = null;
  const registryErrors = [];
  try {
    registry = loadRegistry();
    if (!isCustomRoot) {
      const val = validateRegistry(registry);
      if (!val.valid) {
        registryErrors.push(...val.errors);
      }
    }
  } catch (err) {
    registryErrors.push(`Gagal memuat registry: ${err.message}`);
  }

  // 2. Kumpulkan file TS target
  const excludePatterns = isCustomRoot ? [] : ['src/scripts', 'src/cli'];
  const tsFiles = listTsFiles(targetRoot, { exclude: excludePatterns });

  // Pre-load file content untuk dead exports dan file size
  const fileCache = new Map();
  for (const f of tsFiles) {
    try {
      const full = toAbsolute(f);
      const text = fs.readFileSync(full, 'utf8');
      const lines = text.split(/\r?\n/).length;
      fileCache.set(f, { text, lines });
    } catch {}
  }

  // Pre-load tests files jika ada (untuk pencarian dead export)
  const testFiles = isCustomRoot ? [] : listFiles('tests', { extensions: ['.ts', '.tsx'] });
  const testCache = new Map();
  if (!isCustomRoot) {
    for (const tf of testFiles) {
      try {
        const full = toAbsolute(tf);
        testCache.set(tf, fs.readFileSync(full, 'utf8'));
      } catch {}
    }
  }

  const allViolations = [];
  const structuralWarnings = [];

  // -------------------------------------------------------------
  // CHECK A: FORBIDDEN DECLARATIONS
  // -------------------------------------------------------------
  const currentForbiddenViolations = [];
  if (!options.only || options.only === 'forbidden') {
    if (registry && registry.capabilities) {
      for (const cap of registry.capabilities) {
        const forbiddenNames = new Set(cap.forbiddenDeclarations || []);
        if (forbiddenNames.size === 0) continue;

        const allowed = new Set((cap.allowedFiles || []).concat(cap.canonical || []).map(f => toRelative(f)));

        for (const f of tsFiles) {
          if (allowed.has(f)) continue;

          let sf;
          try {
            sf = parseTsFile(f);
          } catch {
            continue;
          }

          const decls = collectTopLevelDeclarations(sf);
          for (const d of decls) {
            if (forbiddenNames.has(d.name)) {
              currentForbiddenViolations.push({
                type: 'FORBIDDEN_DECLARATION',
                capabilityId: cap.id,
                name: d.name,
                canonical: cap.canonical,
                file: f,
                line: d.startLine
              });
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // CHECK B: DUPLICATION (EXACT HASH & STRUCTURAL)
  // -------------------------------------------------------------
  const currentDuplicateGroups = [];
  if (!options.only || options.only === 'duplication') {
    const exactMap = new Map();
    const structMap = new Map();

    for (const f of tsFiles) {
      let sf;
      try {
        sf = parseTsFile(f);
      } catch {
        continue;
      }

      const fns = collectFunctionLike(sf, f);
      for (const fn of fns) {
        const { tokenCount, exactHash, structuralHash } = computeFingerprint(fn.bodyText, { minTokens: 40 });
        if (exactHash) {
          if (!exactMap.has(exactHash)) exactMap.set(exactHash, []);
          exactMap.get(exactHash).push({ ...fn, tokenCount });
        }
        if (structuralHash) {
          if (!structMap.has(structuralHash)) structMap.set(structuralHash, []);
          structMap.get(structuralHash).push({ ...fn, exactHash, tokenCount });
        }
      }
    }

    // Kelompokkan exact duplicates (fungsi identik di >= 2 file berbeda)
    for (const [hash, occurrences] of exactMap.entries()) {
      const distinctFiles = new Set(occurrences.map(o => o.filePath));
      if (distinctFiles.size >= 2) {
        currentDuplicateGroups.push({
          hash,
          tokenCount: occurrences[0].tokenCount,
          files: occurrences.map(o => ({
            file: o.filePath,
            line: o.startLine,
            name: o.name
          }))
        });
      }
    }

    // Structural duplicates (warn only, struktur sama tapi nama variabel berbeda)
    for (const [structHash, occurrences] of structMap.entries()) {
      const distinctExact = new Set(occurrences.map(o => o.exactHash));
      const distinctFiles = new Set(occurrences.map(o => o.filePath));
      if (distinctFiles.size >= 2 && distinctExact.size >= 2) {
        structuralWarnings.push({
          type: 'STRUCTURAL_DUPLICATION_WARN',
          structHash,
          tokenCount: occurrences[0].tokenCount,
          files: occurrences.map(o => ({
            file: o.filePath,
            line: o.startLine,
            name: o.name
          }))
        });
      }
    }
  }

  // -------------------------------------------------------------
  // CHECK C: DEAD EXPORTS
  // -------------------------------------------------------------
  const currentDeadExports = [];
  if (!options.only || options.only === 'dead-exports') {
    for (const f of tsFiles) {
      let sf;
      try {
        sf = parseTsFile(f);
      } catch {
        continue;
      }

      const exports = collectExports(sf);
      for (const exp of exports) {
        // DEAD_EXPORT hanya memantau kode eksekusi runtime (function, variable/const, class); interface/type dikecualikan
        if (exp.name === 'default' || exp.isReexport || !['function', 'variable', 'class'].includes(exp.kind)) continue;

        // Cari referensi di file lain (src/** dan tests/**)
        const name = exp.name;
        const wordRe = new RegExp(`\\b${name}\\b`);
        let isReferenced = false;

        // Cek src files
        for (const [otherFile, cached] of fileCache.entries()) {
          if (otherFile === f) continue;
          if (wordRe.test(cached.text)) {
            isReferenced = true;
            break;
          }
        }

        // Cek test files
        if (!isReferenced) {
          for (const [, testText] of testCache.entries()) {
            if (wordRe.test(testText)) {
              isReferenced = true;
              break;
            }
          }
        }

        if (!isReferenced) {
          currentDeadExports.push({
            type: 'DEAD_EXPORT',
            name: exp.name,
            kind: exp.kind,
            file: f,
            line: exp.startLine
          });
        }
      }
    }
  }

  // -------------------------------------------------------------
  // CHECK D: FILE SIZE BUDGET (Default: > 1500 lines)
  // -------------------------------------------------------------
  const currentLargeFiles = [];
  if (!options.only || options.only === 'file-size') {
    for (const [f, cached] of fileCache.entries()) {
      if (cached.lines > options.maxLines) {
        currentLargeFiles.push({
          file: f,
          lines: cached.lines
        });
      }
    }
    currentLargeFiles.sort((a, b) => b.lines - a.lines);
  }

  // -------------------------------------------------------------
  // BASELINE UPDATE LOGIC
  // -------------------------------------------------------------
  if (options.updateBaseline && options.allowUpdate) {
    const commit = getCurrentCommit();
    saveBaseline('forbidden-declarations', {
      version: 1,
      generatedFromCommit: commit,
      violations: currentForbiddenViolations
    }, options.baselineDir);

    saveBaseline('duplication', {
      version: 1,
      generatedFromCommit: commit,
      groups: currentDuplicateGroups
    }, options.baselineDir);

    saveBaseline('dead-exports', {
      version: 1,
      generatedFromCommit: commit,
      deadExports: currentDeadExports
    }, options.baselineDir);

    saveBaseline('file-size', {
      version: 1,
      generatedFromCommit: commit,
      maxLines: options.maxLines,
      files: currentLargeFiles
    }, options.baselineDir);

    if (options.json) {
      console.log(JSON.stringify({ updated: true, commit }, null, 2));
    } else {
      console.log(`[REUSE GATE] Baseline berhasil diperbarui untuk commit: ${commit}`);
      console.log(`  - Forbidden declarations : ${currentForbiddenViolations.length}`);
      console.log(`  - Duplication groups     : ${currentDuplicateGroups.length}`);
      console.log(`  - Dead exports           : ${currentDeadExports.length}`);
      console.log(`  - Files > ${options.maxLines} lines    : ${currentLargeFiles.length}`);
    }
    process.exit(0);
  }

  // -------------------------------------------------------------
  // BASELINE COMPARISON (RATCHET)
  // -------------------------------------------------------------
  const baselineForbidden = loadBaseline('forbidden-declarations', options.baselineDir);
  const baselineDuplication = loadBaseline('duplication', options.baselineDir);
  const baselineDeadExports = loadBaseline('dead-exports', options.baselineDir);
  const baselineFileSize = loadBaseline('file-size', options.baselineDir);

  const newViolations = [];
  let baselineViolationsCount = 0;
  let fixedViolationsCount = 0;

  // A. Compare Forbidden Declarations
  if (!options.only || options.only === 'forbidden') {
    const baselineKeys = new Set(
      (baselineForbidden?.violations || []).map(v => `${v.capabilityId}::${v.name}::${v.file}`)
    );
    const currentKeys = new Set();

    for (const v of currentForbiddenViolations) {
      const key = `${v.capabilityId}::${v.name}::${v.file}`;
      currentKeys.add(key);
      if (baselineKeys.has(key)) {
        baselineViolationsCount++;
      } else {
        newViolations.push({
          type: 'FORBIDDEN_DECLARATION',
          message: `Deklarasi simbol "${v.name}" di "${v.file}:${v.line}" dilarang (kanonis: ${v.canonical})`,
          ...v
        });
      }
    }

    for (const bKey of baselineKeys) {
      if (!currentKeys.has(bKey)) {
        fixedViolationsCount++;
      }
    }
  }

  // B. Compare Duplication
  if (!options.only || options.only === 'duplication') {
    const baselineHashMap = new Map();
    for (const g of (baselineDuplication?.groups || [])) {
      baselineHashMap.set(g.hash, new Set(g.files.map(f => f.file)));
    }

    for (const g of currentDuplicateGroups) {
      const baselineFiles = baselineHashMap.get(g.hash);
      if (!baselineFiles) {
        // Hash baru sepenuhnya
        newViolations.push({
          type: 'DUPLICATE_FUNCTION',
          message: `Fungsi duplikat baru ditemukan (${g.tokenCount} token) di ${g.files.map(f => `${f.file}:${f.line}`).join(' dan ')}`,
          hash: g.hash,
          files: g.files
        });
      } else {
        // Cek apakah ada file baru yang masuk ke grup lama
        const newFilesInGroup = g.files.filter(f => !baselineFiles.has(f.file));
        if (newFilesInGroup.length > 0) {
          newViolations.push({
            type: 'DUPLICATE_FUNCTION_EXPANDED',
            message: `Duplikasi bertambah ke file baru: ${newFilesInGroup.map(f => `${f.file}:${f.line}`).join(', ')}`,
            hash: g.hash,
            files: g.files
          });
        } else {
          baselineViolationsCount++;
        }
      }
    }
  }

  // C. Compare Dead Exports
  if (!options.only || options.only === 'dead-exports') {
    const baselineSet = new Set(
      (baselineDeadExports?.deadExports || []).map(d => `${d.file}::${d.name}`)
    );

    for (const d of currentDeadExports) {
      const key = `${d.file}::${d.name}`;
      if (baselineSet.has(key)) {
        baselineViolationsCount++;
      } else {
        newViolations.push({
          type: 'DEAD_EXPORT',
          message: `Export baru tanpa referensi: "${d.name}" di ${d.file}:${d.line}`,
          ...d
        });
      }
    }
  }

  // D. Compare File Size
  if (!options.only || options.only === 'file-size') {
    const baselineMap = new Map(
      (baselineFileSize?.files || []).map(f => [f.file, f.lines])
    );

    for (const f of currentLargeFiles) {
      const baseLines = baselineMap.get(f.file);
      if (baseLines === undefined) {
        newViolations.push({
          type: 'FILE_TOO_LARGE',
          message: `File baru melebihi batas ${options.maxLines} baris: ${f.file} (${f.lines} baris)`,
          file: f.file,
          lines: f.lines,
          maxLines: options.maxLines
        });
      } else if (f.lines > baseLines) {
        newViolations.push({
          type: 'FILE_SIZE_INCREASED',
          message: `File raksasa bertambah panjang: ${f.file} naik dari ${baseLines} ke ${f.lines} baris (+${f.lines - baseLines})`,
          file: f.file,
          lines: f.lines,
          previousLines: baseLines
        });
      } else {
        baselineViolationsCount++;
      }
    }
  }

  // E. Registry Errors
  for (const err of registryErrors) {
    newViolations.push({
      type: 'REGISTRY_ERROR',
      message: err
    });
  }

  // -------------------------------------------------------------
  // OUTPUT REPORT
  // -------------------------------------------------------------
  const totalViolations = newViolations.length + baselineViolationsCount;
  const isPassing = newViolations.length === 0 || options.warn;

  if (options.json) {
    console.log(JSON.stringify({
      passed: isPassing,
      warnMode: options.warn,
      summary: {
        totalViolations,
        newViolations: newViolations.length,
        baselineViolations: baselineViolationsCount,
        fixedViolations: fixedViolationsCount,
        structuralWarnings: structuralWarnings.length
      },
      newViolations,
      structuralWarnings
    }, null, 2));
  } else {
    console.log(`\n======================================================`);
    console.log(`  REUSE & ANTI-SPAGHETTI GATE (Fase 2)`);
    console.log(`======================================================`);
    console.log(`Mode               : ${options.warn ? 'WARN-ONLY (Peringatan)' : 'FAIL-ON-NEW (Ketat)'}`);
    console.log(`Target Direktori   : ${options.root}`);
    console.log(`Total Pelanggaran  : ${totalViolations} (Baseline: ${baselineViolationsCount}, Baru: ${newViolations.length})`);
    if (fixedViolationsCount > 0) {
      console.log(`Utang Selesai      : ${fixedViolationsCount} temuan baseline berhasil diperbaiki! 🎉`);
    }

    if (newViolations.length > 0) {
      console.log(`\n[PELANGGARAN BARU (${newViolations.length})]:`);
      for (const [idx, v] of newViolations.entries()) {
        console.log(`  ${idx + 1}. [${v.type}] ${v.message}`);
      }
    }

    if (structuralWarnings.length > 0) {
      console.log(`\n[PERINGATAN STRUKTURAL (${structuralWarnings.length}) - Potensi Salinan dengan Variabel Berbeda]:`);
      for (const [idx, w] of structuralWarnings.slice(0, 5).entries()) {
        console.log(`  ${idx + 1}. [${w.type}] ${w.files.map(f => `${f.file}:${f.line} (${f.name})`).join(' vs ')}`);
      }
      if (structuralWarnings.length > 5) {
        console.log(`     ...dan ${structuralWarnings.length - 5} lainnya`);
      }
    }

    console.log(`======================================================\n`);
  }

  if (!isPassing) {
    console.error(`[REUSE GATE FAILED] Terdapat ${newViolations.length} pelanggaran baru yang belum terdaftar di baseline.\n`);
    process.exit(1);
  }

  process.exit(0);
}

runCheck().catch(err => {
  console.error('[REUSE GATE FATAL ERROR]:', err);
  process.exit(1);
});
