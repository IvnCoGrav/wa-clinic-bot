import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Ar-003 — gerbang regresi: DILARANG menambah filter DB hardcode
 * `tenant_id: DEFAULT_TENANT_ID` di jalur produksi. Nilai default parameter
 * (`tenantId = DEFAULT_TENANT_ID`) tetap diizinkan untuk kompatibilitas
 * single-tenant/CLI, tetapi filter query wajib memakai tenant eksplisit.
 *
 * Allowlist di bawah adalah fallback yang memang bukan jalur produksi
 * multi-tenant (data default/seed), bukan kebocoran tenant.
 */
const ROOT = process.cwd();
const ALLOWED = new Set([
  'src/routes/admin/labels.subroute.ts', // label default in-memory saat DB offline
  'src/services/landing-content.service.ts', // konten landing default-tenant (fallback)
  'src/services/staff-retention.service.ts', // template policy; tenant ditimpa saat dipakai
]);

function collectHardcodedFilters(dir: string): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (full.endsWith('.ts')) {
        const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
        lines.forEach((line, idx) => {
          if (/tenant_?[iI]d\s*:\s*DEFAULT_TENANT_ID/.test(line)) {
            hits.push(`${path.relative(ROOT, full).replace(/\\/g, '/')}:${idx + 1}`);
          }
        });
      }
    }
  };
  walk(dir);
  return hits;
}

describe('Ar-003 guard: tidak ada filter tenant hardcode baru', () => {
  it('filter tenant hardcode hanya ada di allowlist fallback', () => {
    const hits = [...collectHardcodedFilters(path.join(ROOT, 'src/services')), ...collectHardcodedFilters(path.join(ROOT, 'src/routes'))];
    const offenders = hits.filter((hit) => !ALLOWED.has(hit.split(':')[0]));
    expect(offenders).toEqual([]);
  });

  it('jumlah filter hardcode tidak bertambah tanpa sengaja', () => {
    const hits = [...collectHardcodedFilters(path.join(ROOT, 'src/services')), ...collectHardcodedFilters(path.join(ROOT, 'src/routes'))];
    // Dua file allowlist di services + satu route = maksimal 3 baris.
    expect(hits.length).toBeLessThanOrEqual(3);
  });
});
