#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, toAbsolute, toRelative, exists, listFiles } from './lib/paths.mjs';
import { listTsFiles, parseTsFile } from './lib/ast.mjs';
import { buildImportGraph, findCircularDependencyCycles } from './lib/import-graph.mjs';
import { BASELINE_DIR, getCurrentCommit, loadBaseline, saveBaseline } from './lib/baseline.mjs';

function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = {
    warn: false,
    json: false,
    only: null, // layers | cycles | prisma-budget | admin-integrations
    root: 'src',
    baselineDir: BASELINE_DIR,
    updateBaseline: false,
    allowUpdate: false
  };

  for (const arg of args) {
    if (arg === '--warn') options.warn = true;
    else if (arg === '--json') options.json = true;
    else if (arg.startsWith('--only=')) options.only = arg.split('=')[1];
    else if (arg.startsWith('--root=')) options.root = arg.split('=')[1];
    else if (arg.startsWith('--baseline-dir=')) options.baselineDir = arg.split('=')[1];
    else if (arg === '--update-baseline') options.updateBaseline = true;
    else if (arg === '--allow-update') options.allowUpdate = true;
  }

  return options;
}

function countPrismaInFile(filePath) {
  try {
    const text = fs.readFileSync(toAbsolute(filePath), 'utf8');
    const matches = text.match(/prisma\.[a-zA-Z0-9_$]+\.[a-zA-Z0-9_$]+/g);
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

async function runCheck() {
  const options = parseCliArgs();

  if (options.updateBaseline && !options.allowUpdate) {
    console.error('[ARCHITECTURE GATE ERROR] Flag --update-baseline membutuhkan --allow-update secara eksplisit.');
    process.exit(1);
  }

  const targetRoot = options.root;
  const isCustomRoot = targetRoot !== 'src';

  const tsFiles = listTsFiles(targetRoot, {
    exclude: isCustomRoot ? [] : ['src/scripts', 'src/cli']
  });

  const { graph, fileImports } = buildImportGraph(tsFiles);

  // -------------------------------------------------------------
  // 1. LAYER BOUNDARIES
  // -------------------------------------------------------------
  const currentLayerViolations = [];
  if (!options.only || options.only === 'layers') {
    for (const [file, imps] of fileImports.entries()) {
      // Rule 1: LAYER_UTILS
      // src/utils/** dilarang import services, routes, db, integrations
      if (file.startsWith('src/utils/') || file.includes('/utils/')) {
        for (const imp of imps) {
          if (!imp.resolved) continue;
          if (
            imp.resolved.startsWith('src/services/') ||
            imp.resolved.startsWith('src/routes/') ||
            imp.resolved.startsWith('src/db/') ||
            imp.resolved.startsWith('src/integrations/')
          ) {
            currentLayerViolations.push({
              rule: 'LAYER_UTILS',
              file,
              target: imp.resolved,
              line: imp.line
            });
          }
        }
      }

      // Rule 2: LAYER_DOMAIN
      // src/domain/** dilarang import services, routes, db, integrations
      if (file.startsWith('src/domain/') || file.includes('/domain/')) {
        for (const imp of imps) {
          if (!imp.resolved) continue;
          if (
            imp.resolved.startsWith('src/services/') ||
            imp.resolved.startsWith('src/routes/') ||
            imp.resolved.startsWith('src/db/') ||
            imp.resolved.startsWith('src/integrations/')
          ) {
            currentLayerViolations.push({
              rule: 'LAYER_DOMAIN',
              file,
              target: imp.resolved,
              line: imp.line
            });
          }
        }
      }

      // Rule 3: LAYER_SERVICES
      // src/services/** dilarang import routes
      if (file.startsWith('src/services/') || file.includes('/services/')) {
        for (const imp of imps) {
          if (!imp.resolved) continue;
          if (imp.resolved.startsWith('src/routes/') || imp.resolved.includes('/routes/')) {
            currentLayerViolations.push({
              rule: 'LAYER_SERVICES',
              file,
              target: imp.resolved,
              line: imp.line
            });
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 2. ADMIN NO NEW INTEGRATION
  // -------------------------------------------------------------
  const currentAdminIntegrations = [];
  if (!options.only || options.only === 'admin-integrations') {
    const adminFilesWithIntegration = new Set();
    for (const [file, imps] of fileImports.entries()) {
      if (file.startsWith('src/routes/admin/') || file.includes('/routes/admin/')) {
        for (const imp of imps) {
          if (imp.resolved && (imp.resolved.startsWith('src/integrations/') || imp.resolved.includes('/integrations/'))) {
            adminFilesWithIntegration.add(file);
          }
        }
      }
    }
    for (const af of adminFilesWithIntegration) {
      currentAdminIntegrations.push(af);
    }
    currentAdminIntegrations.sort();
  }

  // -------------------------------------------------------------
  // 3. CIRCULAR DEPENDENCY CYCLES (Tarjan SCC)
  // -------------------------------------------------------------
  const currentCycles = [];
  if (!options.only || options.only === 'cycles') {
    const rawCycles = findCircularDependencyCycles(graph);
    for (const c of rawCycles) {
      currentCycles.push(c);
    }
    currentCycles.sort((a, b) => a[0].localeCompare(b[0]));
  }

  // -------------------------------------------------------------
  // 4. PRISMA BUDGET IN ROUTES
  // -------------------------------------------------------------
  const currentPrismaBudget = {
    totalCalls: 0,
    files: {}
  };
  if (!options.only || options.only === 'prisma-budget') {
    const routeFiles = tsFiles.filter(f => f.startsWith('src/routes/') || f.includes('/routes/'));
    for (const rf of routeFiles) {
      const count = countPrismaInFile(rf);
      if (count > 0) {
        currentPrismaBudget.totalCalls += count;
        currentPrismaBudget.files[rf] = count;
      }
    }
  }

  // -------------------------------------------------------------
  // UPDATE BASELINE
  // -------------------------------------------------------------
  if (options.updateBaseline && options.allowUpdate) {
    const commit = getCurrentCommit();
    const baselineData = {
      version: 1,
      generatedFromCommit: commit,
      layerViolations: currentLayerViolations,
      adminIntegrations: currentAdminIntegrations,
      cycles: currentCycles,
      prismaBudget: currentPrismaBudget
    };

    saveBaseline('architecture', baselineData, options.baselineDir);

    if (options.json) {
      console.log(JSON.stringify({ updated: true, commit, baseline: baselineData }, null, 2));
    } else {
      console.log(`[ARCHITECTURE GATE] Baseline arsitektur berhasil diperbarui untuk commit: ${commit}`);
      console.log(`  - Layer violations      : ${currentLayerViolations.length}`);
      console.log(`  - Admin integration files: ${currentAdminIntegrations.length}`);
      console.log(`  - Circular import cycles: ${currentCycles.length}`);
      console.log(`  - Prisma in routes total : ${currentPrismaBudget.totalCalls} (${Object.keys(currentPrismaBudget.files).length} files)`);
    }
    process.exit(0);
  }

  // -------------------------------------------------------------
  // COMPARISON (RATCHET)
  // -------------------------------------------------------------
  const baseline = loadBaseline('architecture', options.baselineDir);
  const newViolations = [];
  let baselineViolationsCount = 0;

  // A. Compare Layers
  if (!options.only || options.only === 'layers') {
    const baseSet = new Set(
      (baseline?.layerViolations || []).map(v => `${v.rule}::${v.file}::${v.target}`)
    );

    for (const v of currentLayerViolations) {
      const key = `${v.rule}::${v.file}::${v.target}`;
      if (baseSet.has(key)) {
        baselineViolationsCount++;
      } else {
        newViolations.push({
          type: v.rule,
          message: `Pelanggaran batas arsitektur [${v.rule}]: "${v.file}:${v.line}" tidak boleh mengimpor "${v.target}"`,
          ...v
        });
      }
    }
  }

  // B. Compare Admin Integrations
  if (!options.only || options.only === 'admin-integrations') {
    const baseAdminSet = new Set(baseline?.adminIntegrations || []);
    for (const af of currentAdminIntegrations) {
      if (baseAdminSet.has(af)) {
        baselineViolationsCount++;
      } else {
        newViolations.push({
          type: 'ADMIN_NO_NEW_INTEGRATION',
          message: `File route admin baru "${af}" tidak boleh mengimpor langsung dari integrations/** (gunakan service/gateway)`,
          file: af
        });
      }
    }
  }

  // C. Compare Cycles
  if (!options.only || options.only === 'cycles') {
    // Normalisasi cycle keys: siklus direpresentasikan string urutan file
    const baseCycles = new Set(
      (baseline?.cycles || []).map(c => [...c].sort().join('::'))
    );

    for (const cycle of currentCycles) {
      const cycleKey = [...cycle].sort().join('::');
      if (baseCycles.has(cycleKey)) {
        baselineViolationsCount++;
      } else {
        newViolations.push({
          type: 'NO_NEW_CYCLE',
          message: `Siklus import baru terdeteksi (${cycle.length} file): ${cycle.join(' -> ')}`,
          cycle
        });
      }
    }
  }

  // D. Compare Prisma Budget
  if (!options.only || options.only === 'prisma-budget') {
    const basePrisma = baseline?.prismaBudget || { totalCalls: 0, files: {} };

    for (const [file, count] of Object.entries(currentPrismaBudget.files)) {
      const baseCount = basePrisma.files[file] || 0;
      if (count > baseCount) {
        newViolations.push({
          type: 'PRISMA_BUDGET_EXCEEDED',
          message: `Panggilan Prisma di route "${file}" meningkat: ${count} > baseline ${baseCount} (+${count - baseCount})`,
          file,
          calls: count,
          baselineCalls: baseCount
        });
      } else {
        baselineViolationsCount++;
      }
    }

    if (currentPrismaBudget.totalCalls > basePrisma.totalCalls) {
      newViolations.push({
        type: 'PRISMA_TOTAL_BUDGET_EXCEEDED',
        message: `Total panggilan Prisma di routes (${currentPrismaBudget.totalCalls}) melebihi pagu baseline (${basePrisma.totalCalls})`,
        total: currentPrismaBudget.totalCalls,
        baselineTotal: basePrisma.totalCalls
      });
    }
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
        baselineViolations: baselineViolationsCount
      },
      newViolations,
      currentCyclesCount: currentCycles.length,
      currentPrismaTotal: currentPrismaBudget.totalCalls
    }, null, 2));
  } else {
    console.log(`\n======================================================`);
    console.log(`  ARCHITECTURE & STRUCTURAL INTEGRITY GATE (Fase 3)`);
    console.log(`======================================================`);
    console.log(`Mode               : ${options.warn ? 'WARN-ONLY (Peringatan)' : 'FAIL-ON-NEW (Ketat)'}`);
    console.log(`Target Direktori   : ${options.root}`);
    console.log(`Total Pelanggaran  : ${totalViolations} (Baseline: ${baselineViolationsCount}, Baru: ${newViolations.length})`);
    console.log(`Siklus Terdeteksi  : ${currentCycles.length} siklus circular import`);
    console.log(`Panggilan Prisma   : ${currentPrismaBudget.totalCalls} panggilan di ${Object.keys(currentPrismaBudget.files).length} file routes`);

    if (newViolations.length > 0) {
      console.log(`\n[PELANGGARAN ARSITEKTUR BARU (${newViolations.length})]:`);
      for (const [idx, v] of newViolations.entries()) {
        console.log(`  ${idx + 1}. [${v.type}] ${v.message}`);
      }
    }

    console.log(`======================================================\n`);
  }

  if (!isPassing) {
    console.error(`[ARCHITECTURE GATE FAILED] Terdapat ${newViolations.length} pelanggaran arsitektur baru yang belum ada di baseline.\n`);
    process.exit(1);
  }

  process.exit(0);
}

runCheck().catch(err => {
  console.error('[ARCHITECTURE GATE FATAL ERROR]:', err);
  process.exit(1);
});
