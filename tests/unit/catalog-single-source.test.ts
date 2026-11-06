import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Keputusan 2026-11-06: katalog layanan TIDAK boleh punya salinan hardcoded
 * di dashboard. Satu-satunya sumber adalah API/DB (`GET /api/admin/services`).
 * Test ini menjaga agar fallback lama tidak dihidupkan kembali.
 */
function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('Katalog layanan — single source (tanpa fallback hardcoded)', () => {
  it('tidak ada referensi DEFAULT_CLINIC_SERVICES_FALLBACK / clinicServicesFallback.json', () => {
    const root = path.resolve(process.cwd(), 'packages/admin-dashboard/src');
    const hits = walk(root).filter((file) => {
      const content = fs.readFileSync(file, 'utf-8');
      return /DEFAULT_CLINIC_SERVICES_FALLBACK|clinicServicesFallback\.json/.test(content);
    });
    expect(hits).toEqual([]);
  });

  it('file fallback dan generator seed sudah dihapus', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'packages/admin-dashboard/src/data/clinicServicesFallback.json'))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/scripts/generate-catalog-seed.ts'))).toBe(false);
  });
});
