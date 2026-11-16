/**
 * baseline-ratchet.mjs — Satu sumber kebenaran untuk mendeteksi KENAIKAN baseline.
 *
 * Dipakai oleh:
 *  - `check-reuse.mjs` / `check-architecture.mjs` saat `--update-baseline`
 *    (mencegah ratchet diam-diam menaikkan utang).
 *  - `check-baseline-ratchet.mjs` di CI (mencegah baseline diedit manual naik).
 *
 * Perbandingan berbasis KEY-SET, bukan sekadar jumlah: menukar satu pelanggaran
 * lama dengan pelanggaran baru dengan jumlah sama tetap dianggap kenaikan.
 */

function keySet(items, keyFn) {
  return new Set((items || []).map(keyFn));
}

function newKeys(currentItems, previousItems, keyFn) {
  const previous = keySet(previousItems, keyFn);
  return (currentItems || []).filter((item) => !previous.has(keyFn(item)));
}

/**
 * @returns {Array<{ category: string, detail: string }>} daftar kenaikan (kosong = aman)
 */
export function findReuseBaselineIncreases(previous, current) {
  const increases = [];
  const prevDup = previous.duplication || {};
  const prevForbidden = previous.forbidden || {};
  const prevDead = previous.deadExports || {};
  const prevFileSize = previous.fileSize || {};

  const dupNew = newKeys(current.duplicationGroups, prevDup.groups, (g) => g.hash);
  if (dupNew.length > 0) {
    increases.push({
      category: 'duplikasi fungsi',
      detail: dupNew.map((g) => g.files.map((f) => `${f.file}:${f.line}`).join(' + ')).join('; '),
    });
  }

  // Kategori struktural diperkenalkan pada Sprint 2 (baseline v2). Bila baseline
  // lama belum punya field ini, jangan anggap grup yang ada sebagai "kenaikan"
  // (ini inisialisasi kategori, bukan penambahan utang baru).
  const structuralNew = Array.isArray(prevDup.structuralGroups)
    ? newKeys(current.structuralGroups, prevDup.structuralGroups, (g) => g.hash)
    : [];
  if (structuralNew.length > 0) {
    increases.push({
      category: 'duplikasi struktural',
      detail: structuralNew.map((g) => g.files.map((f) => `${f.file}:${f.line}`).join(' + ')).join('; '),
    });
  }

  const forbiddenNew = newKeys(
    current.forbiddenViolations,
    prevForbidden.violations,
    (v) => `${v.capabilityId}::${v.name}::${v.file}`
  );
  if (forbiddenNew.length > 0) {
    increases.push({
      category: 'deklarasi terlarang',
      detail: forbiddenNew.map((v) => `${v.name} di ${v.file}`).join('; '),
    });
  }

  const deadNew = newKeys(current.deadExports, prevDead.deadExports, (d) => `${d.file}::${d.name}`);
  if (deadNew.length > 0) {
    increases.push({
      category: 'dead export',
      detail: deadNew.map((d) => `${d.name} di ${d.file}`).join('; '),
    });
  }

  const previousFileLines = new Map((prevFileSize.files || []).map((f) => [f.file, f.lines]));
  const fileSizeNew = [];
  for (const file of current.largeFiles || []) {
    const prevLines = previousFileLines.get(file.file);
    if (prevLines === undefined) {
      fileSizeNew.push(`${file.file} (file raksasa baru, ${file.lines} baris)`);
    } else if (file.lines > prevLines) {
      fileSizeNew.push(`${file.file} (${prevLines} → ${file.lines} baris)`);
    }
  }
  if (fileSizeNew.length > 0) {
    increases.push({ category: 'file > batas baris', detail: fileSizeNew.join('; ') });
  }

  return increases;
}

/**
 * @returns {Array<{ category: string, detail: string }>} daftar kenaikan (kosong = aman)
 */
export function findArchitectureBaselineIncreases(previous, current) {
  const increases = [];
  const prev = previous || {};

  const cycleKey = (cycle) => [...cycle].sort().join('::');
  const cyclesNew = newKeys(current.cycles, prev.cycles, cycleKey);
  if (cyclesNew.length > 0) {
    increases.push({
      category: 'siklus import',
      detail: cyclesNew.map((cycle) => `(${cycle.length} file) ${cycle.join(' -> ')}`).join('; '),
    });
  }

  const layerKey = (v) => `${v.rule}::${v.file}::${v.target}`;
  const layersNew = newKeys(current.layerViolations, prev.layerViolations, layerKey);
  if (layersNew.length > 0) {
    increases.push({
      category: 'pelanggaran layer',
      detail: layersNew.map((v) => `${v.rule} ${v.file} -> ${v.target}`).join('; '),
    });
  }

  const adminKey = (e) => (typeof e === 'string' ? e : `${e.file}::${e.target}`);
  const adminNew = newKeys(current.adminIntegrations, prev.adminIntegrations, adminKey);
  if (adminNew.length > 0) {
    increases.push({
      category: 'impor integrasi langsung di admin route',
      detail: adminNew.map(adminKey).join('; '),
    });
  }

  const prevPrisma = prev.prismaBudget || { totalCalls: 0, files: {} };
  const currentPrisma = current.prismaBudget || { totalCalls: 0, files: {} };
  const prismaDetail = [];
  if (currentPrisma.totalCalls > (prevPrisma.totalCalls || 0)) {
    prismaDetail.push(`total ${prevPrisma.totalCalls || 0} → ${currentPrisma.totalCalls}`);
  }
  for (const [file, count] of Object.entries(currentPrisma.files || {})) {
    const prevCount = prevPrisma.files?.[file] || 0;
    if (count > prevCount) {
      prismaDetail.push(`${file} (${prevCount} → ${count})`);
    }
  }
  if (prismaDetail.length > 0) {
    increases.push({ category: 'panggilan Prisma di route', detail: prismaDetail.join('; ') });
  }

  return increases;
}

export function formatIncreases(increases) {
  return increases.map((inc) => `  - ${inc.category}: ${inc.detail}`).join('\n');
}
