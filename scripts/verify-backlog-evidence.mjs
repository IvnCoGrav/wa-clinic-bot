/**
 * scripts/verify-backlog-evidence.mjs
 * Gerbang bukti backlog: setiap item FIXED WAJIB punya bukti kode + test,
 * atau tercatat di baseline FIXED historis yang dibekukan.
 *
 * Aturan (lihat docs/audit/2026-11-10/EVIDENCE_LEDGER.md):
 * 1. FIXED  -> id ada di legacy-fixed-baseline.json ATAU di manifest.verified
 *              dengan minimal 1 bukti `file` (ber-`line`) dan 1 bukti `test`.
 * 2. Baseline TIDAK BOLEH tumbuh (maksimum 158 id historis).
 * 3. KNOWN  -> wajib `justification` + `acceptance`.
 * 4. DUPLICATE -> wajib `canonical` + `reason`.
 * 5. Evidence `path` wajib ada dan `contains` wajib cocok (untuk `file`,
 *    bila `line` diisi maka baris itu juga harus memuat `contains`).
 * 6. OPEN/UNVERIFIED tidak boleh punya entri manifest (entri basi).
 *
 * Jalankan: npm run verify:backlog
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
// Override path hanya untuk pengujian gerbang (bukan untuk produksi).
const REGISTER = process.env.BACKLOG_REGISTER || 'docs/plans/REMAINING_BACKLOG_2026-11-09.md';
const MANIFEST = process.env.BACKLOG_MANIFEST || 'docs/audit/2026-11-10/backlog-evidence.json';
const BASELINE = process.env.BACKLOG_BASELINE || 'docs/audit/2026-11-10/legacy-fixed-baseline.json';
const MAX_LEGACY_FIXED = 158;

const VALID_STATUSES = new Set(['FIXED', 'OPEN', 'PARTIAL', 'KNOWN', 'DUPLICATE', 'UNVERIFIED']);
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function resolvePath(file) {
  return path.isAbsolute(file) ? file : path.join(ROOT, file);
}

function readJson(file) {
  const abs = resolvePath(file);
  if (!fs.existsSync(abs)) {
    fail(`File tidak ditemukan: ${file}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    fail(`JSON tidak valid pada ${file}: ${err.message}`);
    return null;
  }
}

function parseRegister(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  let section = 'UNKNOWN';
  for (const line of lines) {
    if (/^## 3\./.test(line)) section = 'Track A';
    else if (/^## 4\./.test(line)) section = 'S4';
    else if (/^## 5\./.test(line)) section = 'Track B';
    else if (/^## 6\./.test(line)) section = 'END';
    if (section === 'END') continue;
    const m = line.match(/^\|\s*\*\*([^*]+)\*\*\s*\|/);
    if (!m) continue;
    const cells = line.split('|').map((s) => s.trim());
    if (cells.length < 8) continue;
    const status = (cells[5] || '').replace(/\*/g, '').trim();
    if (!VALID_STATUSES.has(status)) continue;
    rows.push({ id: m[1].trim(), status, module: cells[2], section });
  }
  return rows;
}

function resolveInsideRepo(relPath) {
  const abs = path.resolve(ROOT, relPath);
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

function checkEvidence(id, entry) {
  if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
    fail(`${id}: verified tanpa evidence`);
    return;
  }
  const hasFile = entry.evidence.some((e) => e.type === 'file');
  const hasTest = entry.evidence.some((e) => e.type === 'test');
  if (!hasFile) fail(`${id}: verified tanpa bukti kode (type=file)`);
  if (!hasTest) fail(`${id}: verified tanpa bukti test (type=test)`);

  for (const ev of entry.evidence) {
    if (!ev || typeof ev.path !== 'string' || !ev.path) {
      fail(`${id}: evidence tanpa path`);
      continue;
    }
    if (typeof ev.contains !== 'string' || !ev.contains) {
      fail(`${id}: evidence ${ev.path} tanpa "contains"`);
      continue;
    }
    const abs = resolveInsideRepo(ev.path);
    if (!abs) {
      fail(`${id}: evidence path keluar repo: ${ev.path}`);
      continue;
    }
    if (!fs.existsSync(abs)) {
      fail(`${id}: evidence path tidak ada: ${ev.path}`);
      continue;
    }
    const content = fs.readFileSync(abs, 'utf8');
    if (!content.includes(ev.contains)) {
      fail(`${id}: "${ev.contains}" tidak ditemukan di ${ev.path}`);
      continue;
    }
    if (ev.type === 'file' && ev.line !== undefined) {
      const lineNo = Number(ev.line);
      if (!Number.isInteger(lineNo) || lineNo < 1) {
        fail(`${id}: line tidak valid di ${ev.path}: ${ev.line}`);
        continue;
      }
      const lineText = content.split(/\r?\n/)[lineNo - 1] || '';
      if (!lineText.includes(ev.contains)) {
        fail(`${id}: baris ${lineNo} ${ev.path} tidak memuat "${ev.contains}"`);
      }
    }
    if (ev.type !== 'file' && ev.type !== 'test') {
      fail(`${id}: tipe evidence tidak dikenal: ${ev.type}`);
    }
  }
}

const registerAbs = resolvePath(REGISTER);
if (!fs.existsSync(registerAbs)) {
  console.error(`FATAL: register tidak ditemukan: ${REGISTER}`);
  process.exit(1);
}
const rows = parseRegister(fs.readFileSync(registerAbs, 'utf8'));
if (rows.length === 0) {
  console.error(`FATAL: register tidak memuat baris status: ${REGISTER}`);
  process.exit(1);
}

const manifest = readJson(MANIFEST);
const baseline = readJson(BASELINE);
if (!manifest || !baseline) {
  errors.forEach((e) => console.error(`ERROR: ${e}`));
  process.exit(1);
}

// --- Baseline: tidak boleh tumbuh ---
if (!Array.isArray(baseline.ids) || baseline.ids.length === 0) {
  fail(`${BASELINE}: "ids" kosong/tidak valid`);
}
const baselineIds = Array.isArray(baseline.ids) ? baseline.ids : [];
if (baseline.count !== baselineIds.length) {
  fail(`${BASELINE}: count (${baseline.count}) != jumlah ids (${baselineIds.length})`);
}
if (baselineIds.length > MAX_LEGACY_FIXED) {
  fail(`${BASELINE}: baseline tumbuh ${baselineIds.length} > ${MAX_LEGACY_FIXED} (dilarang)`);
}
if (new Set(baselineIds).size !== baselineIds.length) {
  fail(`${BASELINE}: ada id duplikat`);
}
if (!Array.isArray(manifest.legacyFixed)) {
  fail(`${MANIFEST}: "legacyFixed" wajib berupa array`);
} else {
  const a = [...manifest.legacyFixed].sort();
  const b = [...baselineIds].sort();
  if (a.length !== b.length || a.some((id, i) => id !== b[i])) {
    fail(`${MANIFEST}: "legacyFixed" tidak identik dengan ${BASELINE}`);
  }
}
const baselineSet = new Set(baselineIds);

// --- Manifest: bentuk dasar ---
const verified = manifest.verified && typeof manifest.verified === 'object' ? manifest.verified : {};
const known = manifest.known && typeof manifest.known === 'object' ? manifest.known : {};
const duplicate = manifest.duplicate && typeof manifest.duplicate === 'object' ? manifest.duplicate : {};

const statusById = new Map(rows.map((r) => [r.id, r.status]));

// --- Bukti per item verified ---
for (const [id, entry] of Object.entries(verified)) {
  if (!statusById.has(id)) {
    fail(`${id}: ada di manifest.verified tetapi tidak ada di register`);
    continue;
  }
  if (statusById.get(id) !== 'FIXED') {
    fail(`${id}: manifest.verified tetapi status register = ${statusById.get(id)}`);
  }
  if (entry.status !== undefined && entry.status !== 'FIXED') {
    fail(`${id}: entry.status bukan FIXED`);
  }
  if (baselineSet.has(id)) {
    warnings.push(`${id}: sudah ada di baseline historis, tidak perlu entry verified`);
  }
  if (!entry.verifiedBy || !entry.verifiedAt) {
    fail(`${id}: verified wajib punya verifiedBy + verifiedAt`);
  }
  checkEvidence(id, entry);
}

// --- Justifikasi KNOWN ---
for (const [id, entry] of Object.entries(known)) {
  if (!statusById.has(id)) {
    fail(`${id}: ada di manifest.known tetapi tidak ada di register`);
    continue;
  }
  if (statusById.get(id) !== 'KNOWN') {
    fail(`${id}: manifest.known tetapi status register = ${statusById.get(id)}`);
  }
  if (!entry.justification || String(entry.justification).trim().length < 10) {
    fail(`${id}: KNOWN wajib punya "justification" yang menjelaskan by-design`);
  }
  if (!entry.acceptance || String(entry.acceptance).trim().length < 10) {
    fail(`${id}: KNOWN wajib punya "acceptance" (kapan harus diselesaikan)`);
  }
}

// --- DUPLICATE ---
for (const [id, entry] of Object.entries(duplicate)) {
  if (!statusById.has(id)) {
    fail(`${id}: ada di manifest.duplicate tetapi tidak ada di register`);
    continue;
  }
  if (statusById.get(id) !== 'DUPLICATE') {
    fail(`${id}: manifest.duplicate tetapi status register = ${statusById.get(id)}`);
  }
  if (!entry.canonical || String(entry.canonical).trim().length < 3) {
    fail(`${id}: DUPLICATE wajib punya "canonical"`);
  }
  if (!entry.reason || String(entry.reason).trim().length < 10) {
    fail(`${id}: DUPLICATE wajib punya "reason"`);
  }
  if (entry.canonical && !statusById.has(entry.canonical) && !/^Fase\b/.test(entry.canonical)) {
    warnings.push(`${id}: canonical "${entry.canonical}" bukan ID register/rencana Fase`);
  }
}

// --- Setiap FIXED wajib punya bukti ---
for (const row of rows) {
  if (row.status !== 'FIXED') continue;
  if (baselineSet.has(row.id)) continue;
  if (!verified[row.id]) {
    fail(`${row.id}: FIXED tanpa bukti (tidak di baseline, tidak di manifest.verified)`);
  }
}

// --- Baseline wajib berisi item yang benar-benar FIXED di register ---
for (const id of baselineIds) {
  if (!statusById.has(id)) {
    fail(`${id}: ada di baseline tetapi tidak ada di register`);
  } else if (statusById.get(id) !== 'FIXED') {
    fail(`${id}: ada di baseline tetapi status register = ${statusById.get(id)}`);
  }
}

// --- Entri basi pada OPEN/UNVERIFIED ---
for (const row of rows) {
  if (row.status === 'FIXED') continue;
  if (verified[row.id]) fail(`${row.id}: status ${row.status} tetapi masih ada di manifest.verified`);
  if (row.status !== 'KNOWN' && known[row.id]) fail(`${row.id}: status ${row.status} tetapi masih ada di manifest.known`);
  if (row.status !== 'DUPLICATE' && duplicate[row.id]) fail(`${row.id}: status ${row.status} tetapi masih ada di manifest.duplicate`);
}

// --- Setiap KNOWN/DUPLICATE wajib punya entry ---
for (const row of rows) {
  if (row.status === 'KNOWN' && !known[row.id]) {
    fail(`${row.id}: KNOWN tanpa justifikasi di ${MANIFEST}`);
  }
  if (row.status === 'DUPLICATE' && !duplicate[row.id]) {
    fail(`${row.id}: DUPLICATE tanpa canonical/reason di ${MANIFEST}`);
  }
}

// --- Ringkasan ---
const counts = rows.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] || 0) + 1;
  return acc;
}, {});
const fixedCount = counts.FIXED || 0;
const expectedFixed = baselineIds.length + Object.keys(verified).length;
if (fixedCount !== expectedFixed) {
  fail(`jumlah FIXED register (${fixedCount}) != baseline (${baselineIds.length}) + verified (${Object.keys(verified).length})`);
}

console.log('=== Backlog Evidence Gate ===');
console.log(`Register      : ${REGISTER} (${rows.length} item)`);
console.log(`Manifest      : ${MANIFEST}`);
console.log(`Baseline      : ${BASELINE} (${baselineIds.length}/${MAX_LEGACY_FIXED})`);
console.log(
  `Status        : FIXED=${fixedCount} UNVERIFIED=${counts.UNVERIFIED || 0} OPEN=${counts.OPEN || 0} ` +
    `KNOWN=${counts.KNOWN || 0} DUPLICATE=${counts.DUPLICATE || 0} PARTIAL=${counts.PARTIAL || 0}`,
);
console.log(`Verified baru : ${Object.keys(verified).length}`);
if (warnings.length) {
  console.log('\nPERINGATAN:');
  warnings.forEach((w) => console.log(`  - ${w}`));
}

if (errors.length) {
  console.error(`\nGAGAL: ${errors.length} pelanggaran gerbang bukti.`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

console.log('\nPASS: semua FIXED punya bukti; baseline tidak tumbuh; KNOWN/DUPLICATE lengkap.');
