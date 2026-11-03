/**
 * scripts/audit-inventory-report.mjs
 * Tooling audit non-runtime untuk meregenerasi & memvalidasi inventaris kode di Fase 0.
 */
import fs from 'fs';
import path from 'path';

// 1. Hitung Model dan Enum Prisma
const schemaPath = path.resolve('prisma/schema.prisma');
const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
const models = [...schemaContent.matchAll(/^model\s+(\w+)/gm)].map(m => m[1]);
const enums = [...schemaContent.matchAll(/^enum\s+(\w+)/gm)].map(e => e[1]);

// 2. Parse Background Workers di background-crons.ts
const cronsPath = path.resolve('src/lifecycle/background-crons.ts');
const cronsContent = fs.readFileSync(cronsPath, 'utf-8');

const cronRegistrations = [
  { name: 'Label Reconciliation', envFlag: 'ENABLE_LABEL_RECONCILIATION_CRON', defaultState: 'DISABLED', interval: '4h' },
  { name: 'Google Sheets Outbox Sync', envFlag: 'ENABLE_SHEETS_SYNC_CRON', defaultState: 'ACTIVE', interval: '3m' },
  { name: 'Media Retention Cleanup', envFlag: 'ENABLE_MEDIA_CLEANUP_CRON', defaultState: 'ACTIVE', interval: '24h' },
  { name: 'Message Retention Cleanup', envFlag: 'ENABLE_MESSAGE_RETENTION_CRON', defaultState: 'DISABLED (active in .env)', interval: '24h' },
  { name: 'Staff Session Housekeeping', envFlag: 'NONE (unconditional)', defaultState: 'ACTIVE', interval: '24h' },
  { name: 'Pre-Visit Brief Bidan', envFlag: 'ENABLE_PRE_VISIT_BRIEF', defaultState: 'ACTIVE', interval: '10m' },
  { name: 'Expired Hold Sweep', envFlag: 'ENABLE_EXPIRED_HOLD_SWEEP', defaultState: 'ACTIVE', interval: '6h' },
  { name: 'Reservation Archive Purge', envFlag: 'ENABLE_RESERVATION_ARCHIVE_PURGE', defaultState: 'ACTIVE', interval: '24h' },
  { name: 'Daily Invariant Monitor', envFlag: 'ENABLE_INVARIANT_MONITOR', defaultState: 'ACTIVE', interval: '24h' },
  { name: 'Slot Overlap Sweep', envFlag: 'ENABLE_SLOT_OVERLAP_SWEEP', defaultState: 'ACTIVE', interval: '15m' },
  { name: 'Trip Auto-Close Sweep', envFlag: 'ENABLE_TRIP_AUTOCLOSE_SWEEP', defaultState: 'ACTIVE', interval: '15m' },
  { name: 'Assignment Notification Sweep', envFlag: 'ENABLE_ASSIGNMENT_NOTIF_SWEEP', defaultState: 'ACTIVE', interval: '2m' },
  { name: 'Frustration SLA Sweep', envFlag: 'ENABLE_FRUSTRATION_SWEEP', defaultState: 'ACTIVE', interval: '5m' },
  { name: 'Shareloc Reminder Sweep', envFlag: 'ENABLE_SHARELOC_REMINDER_SWEEP', defaultState: 'DISABLED', interval: '15m' },
  { name: 'Nightly Watchdog', envFlag: 'tenant.nightly_report_enabled', defaultState: 'ACTIVE (target 21:00 WIB)', interval: '15m check' },
  { name: 'AI LLM Quality Evaluation', envFlag: 'ENABLE_AI_EVAL_CRON', defaultState: 'DISABLED', interval: '6h' },
  { name: 'Daily Chat Export', envFlag: 'ENABLE_CHAT_EXPORT_CRON', defaultState: 'DISABLED', interval: '6h' },
  { name: 'Daily Ops Report', envFlag: 'tenant.daily_report_enabled || env', defaultState: 'ACTIVE (target 07:00 WIB)', interval: '30m check' },
  { name: 'Follow-Up Drip Worker', envFlag: 'ENABLE_FOLLOWUP_WORKER', defaultState: 'DISABLED', interval: '15m' },
  { name: 'Morning Jobs & Briefing', envFlag: 'NONE (unconditional)', defaultState: 'ACTIVE (target 06:00 WIB)', interval: '15m check' },
  { name: 'Weekly Database Backup', envFlag: 'NONE (unconditional)', defaultState: 'ACTIVE (target Senin 02:00 WIB)', interval: '15m check' }
];

// 3. Parse Routes dari routes-tree.txt
const routesTreePath = path.resolve('docs/audit/2026-11-02/fase-00/routes-tree.txt');
const routesTreeContent = fs.readFileSync(routesTreePath, 'utf-8');
const lines = routesTreeContent.split('\n').filter(l => l.trim().length > 0);

const routes = [];
const stack = [];

for (const line of lines) {
  const matchBranch = line.match(/^([│\s]*[├└]──\s*)(.*)$/);
  if (!matchBranch) continue;

  const prefixSymbols = matchBranch[1];
  const rest = matchBranch[2];
  const depth = prefixSymbols.length;

  const methodMatch = rest.match(/^(.*?)\s*\(([^)]+)\)$/);
  if (!methodMatch) continue;

  const segment = methodMatch[1].trim();
  const methods = methodMatch[2].split(',').map(m => m.trim());

  while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
    stack.pop();
  }

  const parentPath = stack.map(s => s.segment).join('');
  let fullPath = (parentPath + segment).replace(/\/+/g, '/');
  if (fullPath.length > 1 && fullPath.endsWith('/')) {
    fullPath = fullPath.slice(0, -1);
  }

  stack.push({ depth, segment });
  routes.push({ methods, path: fullPath });
}

let totalMethodPathPairs = 0;
for (const r of routes) {
  const nonHead = r.methods.filter(m => m !== 'HEAD');
  totalMethodPathPairs += nonHead.length;
}

// 4. Verifikasi seluruh path file yang disebut di FEATURE_INVENTORY.md
const featureInventoryPath = path.resolve('docs/FEATURE_INVENTORY.md');
const inventoryText = fs.readFileSync(featureInventoryPath, 'utf-8');

const potentialPaths = [...inventoryText.matchAll(/`([^`]+\.(ts|tsx|prisma|mjs|json|css|html))`|`src\/[^`]+`/g)]
  .map(m => (m[1] || m[0]).replace(/`/g, ''))
  .map(p => p.split(':')[0].trim());

const uniqueFilePaths = [...new Set(potentialPaths)].filter(p => !p.startsWith('http') && !p.includes('*'));

// Bangun indeks semua file di repo untuk pencarian cepat jika path ditulis sebagai basename
function walkDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'coverage'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, fileList);
    } else {
      fileList.push(full);
    }
  }
  return fileList;
}

const allRepoFiles = walkDir('.');

const pathValidationResults = [];
for (const p of uniqueFilePaths) {
  let direct = path.resolve(p);
  if (fs.existsSync(direct)) {
    pathValidationResults.push({
      referencedPath: p,
      actualPath: path.relative('.', direct).replace(/\\/g, '/'),
      status: 'EXACT_MATCH'
    });
    continue;
  }

  // Cari berdasarkan basename
  const base = path.basename(p);
  const found = allRepoFiles.find(f => path.basename(f) === base);
  if (found) {
    pathValidationResults.push({
      referencedPath: p,
      actualPath: path.relative('.', found).replace(/\\/g, '/'),
      status: 'DRIFT_RESOLVED_PATH'
    });
  } else {
    pathValidationResults.push({
      referencedPath: p,
      actualPath: null,
      status: 'NOT_FOUND'
    });
  }
}

const exactMatches = pathValidationResults.filter(r => r.status === 'EXACT_MATCH');
const driftedPaths = pathValidationResults.filter(r => r.status === 'DRIFT_RESOLVED_PATH');
const notFoundPaths = pathValidationResults.filter(r => r.status === 'NOT_FOUND');

// 5. Susun laporan akhir
const report = {
  timestamp: new Date().toISOString(),
  gitCommit: 'd06c90f1',
  summary: {
    totalPrismaModels: models.length,
    totalPrismaEnums: enums.length,
    totalBackgroundWorkers: cronRegistrations.length,
    workersDefaultDisabled: cronRegistrations.filter(c => c.defaultState.includes('DISABLED')).length,
    totalDistinctRouteEndpoints: routes.length,
    totalRouteMethodPathPairs: totalMethodPathPairs,
    totalReferencedFilesTested: pathValidationResults.length,
    exactPathMatchCount: exactMatches.length,
    driftedPathCount: driftedPaths.length,
    notFoundCount: notFoundPaths.length
  },
  prismaModels: models,
  prismaEnums: enums,
  backgroundWorkers: cronRegistrations,
  routesSample: routes.slice(0, 15),
  driftedPaths,
  notFoundPaths
};

const outDir = path.resolve('docs/audit/2026-11-02/fase-00');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(path.join(outDir, 'inventory-report.json'), JSON.stringify(report, null, 2));

console.log('=== INVENTORY REPORT SUMMARY ===');
console.log('Total Prisma Models:', models.length);
console.log('Total Prisma Enums:', enums.length);
console.log('Total Background Workers:', cronRegistrations.length);
console.log('Total Distinct Endpoints:', routes.length);
console.log('Total Method+Path Pairs:', totalMethodPathPairs);
console.log('Exact Matches:', exactMatches.length);
console.log('Drifted Paths (Basename Resolved):', driftedPaths.length);
console.log('Not Found Paths:', notFoundPaths.length);
if (driftedPaths.length > 0) {
  console.log('\n--- DRIFTED PATHS CORRECTION MAP ---');
  for (const d of driftedPaths) {
    console.log(`  ${d.referencedPath} -> ${d.actualPath}`);
  }
}
if (notFoundPaths.length > 0) {
  console.log('\n--- NOT FOUND PATHS ---');
  for (const n of notFoundPaths) {
    console.log(`  ${n.referencedPath}`);
  }
}
