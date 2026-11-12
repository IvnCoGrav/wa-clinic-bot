import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cfg-017 — rekonsiliasi klaim dokumen & audit Fase 10.
 *
 * Temuan lama: `FEATURE_INVENTORY` dan laporan Fase 10 menyebut RBAC
 * "data-driven" dan status "PASS (LULUS 100%)" padahal:
 * - ada daftar prefix sensitif HARDCODE di `admin.route.ts` (hibrida), dan
 * - dashboard masih memuat data bisnis hardcode (Cfg-015, area pengguna).
 * Test ini mengunci agar klaim tidak kembali melebar tanpa bukti.
 */
describe('Cfg-017 artefak & klaim audit Fase 10', () => {
  const root = process.cwd();
  const artifactPath = path.join(root, 'docs/audit/2026-11-02/fase-10.json');
  const reportPath = path.join(root, 'docs/audit/2026-11-02/fase-10/LAPORAN_FASE_10.md');
  const inventoryPath = path.join(root, 'docs/FEATURE_INVENTORY.md');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const report = fs.readFileSync(reportPath, 'utf8');
  const inventory = fs.readFileSync(inventoryPath, 'utf8');
  const files: string[] = (artifact.testResults ?? []).map((r: any) => String(r.name));

  it('artefak Fase 10 berasal dari repo ini dengan jumlah yang dilaporkan', () => {
    expect(files).toHaveLength(10);
    expect(artifact.numTotalTests).toBe(74);
    expect(artifact.numFailedTests).toBe(0);
    const normalizedRoot = root.replace(/\\/g, '/').toLowerCase();
    for (const name of files) {
      const normalized = name.replace(/\\/g, '/').toLowerCase();
      expect(normalized.startsWith(normalizedRoot), `path luar repo: ${name}`).toBe(true);
      expect(normalized).toContain('/tests/');
    }
    expect(report).toContain('10 file suites, 74 tests passed');
  });

  it('laporan memuat catatan rekonsiliasi, bukan klaim 100% tanpa syarat', () => {
    expect(report).toContain('Catatan Rekonsiliasi Klaim (Cfg-017)');
    expect(report).toContain('Hibrida');
    expect(report).toContain('Cfg-011');
    expect(report).toContain('Cfg-015');
    expect(report).not.toContain('PASS (LULUS 100%)');
  });

  it('FEATURE_INVENTORY tidak lagi mengklaim RBAC sepenuhnya data-driven', () => {
    expect(inventory).toContain('superAdminOnlyPrefixes');
    expect(inventory.toLowerCase()).toContain('hibrida');
    expect(inventory).not.toContain('penegakan izin akses endpoint data-driven via tabel `role_api_scopes`');
  });

  it('endpoint setelan tenant (Cfg-011) tercatat di inventaris API', () => {
    expect(inventory).toContain('/api/admin/tenant-settings');
  });
});
