/**
 * scripts/audit-baseline-diff.mjs
 * Membandingkan hasil test Vitest JSON (before vs after / baseline vs phase).
 * Kriteria PASS: gagal(after) ⊆ gagal(baseline) — tidak ada nama test baru yang gagal.
 */
import fs from 'fs';
import path from 'path';

function extractFailedTests(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`File tidak ditemukan: ${jsonPath}`);
  }
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(raw);
  
  const failed = [];
  const testResults = data.testResults || [];
  for (const suite of testResults) {
    const filePath = path.relative('.', suite.name).replace(/\\/g, '/');
    for (const assertion of suite.assertionResults || []) {
      if (assertion.status === 'failed') {
        failed.push({
          file: filePath,
          fullName: assertion.fullName || `${filePath} > ${assertion.title}`,
          title: assertion.title,
          error: (assertion.failureMessages || []).join('\n')
        });
      }
    }
  }
  return {
    numTotalTests: data.numTotalTests || 0,
    numPassedTests: data.numPassedTests || 0,
    numFailedTests: data.numFailedTests || 0,
    failed
  };
}

const [,, baselineFile, currentFile] = process.argv;

if (!baselineFile || !currentFile) {
  console.log('Usage: node scripts/audit-baseline-diff.mjs <baseline.json> <current.json>');
  process.exit(1);
}

const baseline = extractFailedTests(baselineFile);
const current = extractFailedTests(currentFile);

const baselineNames = new Set(baseline.failed.map(f => f.fullName));
const currentNames = new Set(current.failed.map(f => f.fullName));

const newFailures = current.failed.filter(f => !baselineNames.has(f.fullName));
const fixedFailures = baseline.failed.filter(f => !currentNames.has(f.fullName));

console.log('=== TEST SUITE REGRESSION GATE REPORT ===');
console.log(`Baseline file : ${baselineFile} (Total: ${baseline.numTotalTests}, Pass: ${baseline.numPassedTests}, Fail: ${baseline.failed.length})`);
console.log(`Current file  : ${currentFile} (Total: ${current.numTotalTests}, Pass: ${current.numPassedTests}, Fail: ${current.failed.length})`);
console.log(`New failures  : ${newFailures.length}`);
console.log(`Fixed failures: ${fixedFailures.length}`);

if (newFailures.length > 0) {
  console.error('\n❌ [REGRESSION DETECTED] Ada kegagalan test baru:');
  for (const f of newFailures) {
    console.error(`  - ${f.fullName}`);
  }
  process.exit(1);
} else {
  console.log('\n✅ [GATE PASS] Tidak ada regresi baru (gagal(current) ⊆ gagal(baseline))');
  process.exit(0);
}
