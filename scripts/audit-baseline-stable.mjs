import fs from 'node:fs';
import path from 'node:path';

const runs = [
  'docs/audit/2026-11-02/baseline-run1.json',
  'docs/audit/2026-11-02/baseline-run2.json',
  'docs/audit/2026-11-02/baseline-run3.json',
];

const parsedRuns = [];
for (const runFile of runs) {
  if (!fs.existsSync(runFile)) {
    console.error(`Missing run file: ${runFile}`);
    process.exit(1);
  }
  parsedRuns.push(JSON.parse(fs.readFileSync(runFile, 'utf8')));
}

function extractFailedTestNames(report) {
  const set = new Set();
  const map = new Map();
  for (const fileResult of report.testResults || []) {
    for (const assert of fileResult.assertionResults || []) {
      if (assert.status === 'failed') {
        const fullTitle = assert.ancestorTitles
          ? [...assert.ancestorTitles, assert.title].join(' > ')
          : assert.title;
        set.add(fullTitle);
        map.set(fullTitle, {
          file: fileResult.name,
          title: assert.title,
          ancestorTitles: assert.ancestorTitles,
          status: 'failed',
          failureMessages: assert.failureMessages,
        });
      }
    }
  }
  return { set, map };
}

const runSets = parsedRuns.map(extractFailedTestNames);

// Intersection: tests failed in all 3 runs
const allFailedNames = new Set();
for (const r of runSets) {
  for (const name of r.set) {
    allFailedNames.add(name);
  }
}

const stableFailedNames = new Set();
const flakyNames = new Set();

for (const name of allFailedNames) {
  const inRun1 = runSets[0].set.has(name);
  const inRun2 = runSets[1].set.has(name);
  const inRun3 = runSets[2].set.has(name);
  if (inRun1 && inRun2 && inRun3) {
    stableFailedNames.add(name);
  } else {
    flakyNames.add({
      name,
      runs: [inRun1 ? 'FAIL' : 'PASS', inRun2 ? 'FAIL' : 'PASS', inRun3 ? 'FAIL' : 'PASS'],
    });
  }
}

console.log('=== BASELINE STABILITY ANALYSIS ===');
console.log(`Run 1 failures: ${runSets[0].set.size}`);
console.log(`Run 2 failures: ${runSets[1].set.size}`);
console.log(`Run 3 failures: ${runSets[2].set.size}`);
console.log(`Stable failures (all 3 runs): ${stableFailedNames.size}`);
console.log(`Flaky failures (inconsistent): ${flakyNames.size}`);

if (flakyNames.size > 0) {
  console.log('\n--- Flaky Tests ---');
  for (const item of flakyNames) {
    console.log(`  [${item.runs.join(', ')}] ${item.name}`);
  }
}

// Construct baseline-stable.json using Run 1 as template, filtering assertionResults
const baseReport = JSON.parse(JSON.stringify(parsedRuns[0]));
// Mark assertions not in stableFailedNames as passed or filter failure
for (const fileResult of baseReport.testResults || []) {
  for (const assert of fileResult.assertionResults || []) {
    const fullTitle = assert.ancestorTitles
      ? [...assert.ancestorTitles, assert.title].join(' > ')
      : assert.title;
    if (assert.status === 'failed' && !stableFailedNames.has(fullTitle)) {
      assert.status = 'passed';
      assert.failureMessages = [];
    }
  }
}

const outFile = 'docs/audit/2026-11-02/baseline-stable.json';
fs.writeFileSync(outFile, JSON.stringify(baseReport, null, 2), 'utf8');
console.log(`\nWritten stable baseline to ${outFile}`);
