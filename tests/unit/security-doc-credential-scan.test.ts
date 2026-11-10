import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanFile, scanDocumentationCredential } from '../../scripts/scan-secrets';

/**
 * S-001: kredensial inline di dokumentasi wajib terdeteksi scanner.
 * Regresi nyata: `GUIDE_OPERASIONAL.md` memuat password default `admin12345`
 * dan API key contoh dalam format markdown, tetapi lolos `security:scan`.
 */
describe('Secret scanner — kredensial inline dokumentasi (S-001)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-secret-scan-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('mendeteksi format markdown "**Password:** `admin12345`"', () => {
    const found = scanDocumentationCredential('- **Password:** `admin12345`');
    expect(found?.value).toBe('admin12345');
  });

  it('mendeteksi "WAHA API Key: `my_waha_api_key_secret`" (nilai non-placeholder)', () => {
    const found = scanDocumentationCredential('   - **WAHA API Key:** `my_waha_api_key_secret` (isi dari env)');
    expect(found?.value).toBe('my_waha_api_key_secret');
  });

  it('TIDAK menandai baris naratif audit yang memuat kata "token:" di tengah kalimat', () => {
    // Regresi nyata: docs/audit/2026-11-07/modul-03/LAPORAN_MODUL_03_PART_A.md:175
    const line =
      "- Token komitmen memuat kata benda umum: `const BOOKING_COMMIT_SINGLE_TOKENS = ['jadwalkan'];` " +
      '(`date-confirmation.ts:57-59`), lalu dicek per token: `retu****w));` (`:186-189`).';
    expect(scanDocumentationCredential(line)).toBeNull();
  });

  it('TIDAK menandai placeholder env/template', () => {
    expect(scanDocumentationCredential('- **Password:** `<WAHA_DASHBOARD_PASSWORD_DARI_ENV>`')).toBeNull();
    expect(scanDocumentationCredential('- **Secret:** `WAHA_WEBHOOK_SECRET`')).toBeNull();
    expect(scanDocumentationCredential('- **API Key:** `your_api_key_here`')).toBeNull();
    expect(scanDocumentationCredential('- **Token:** `[REDACTED]`')).toBeNull();
  });

  it('scanFile memblokir file markdown berisi kredensial inline', () => {
    const file = path.join(tmpDir, 'guide.md');
    fs.writeFileSync(file, '# Panduan\n- **Password:** `admin12345`\n', 'utf8');
    const findings = scanFile(file);
    expect(findings.some((f) => f.ruleName === 'Kredensial Inline di Dokumentasi')).toBe(true);
  });

  it('scanFile tidak menerapkan aturan dokumentasi ke file non-markdown', () => {
    const file = path.join(tmpDir, 'notes.txt');
    fs.writeFileSync(file, '- **Password:** `admin12345`\n', 'utf8');
    const findings = scanFile(file);
    expect(findings.some((f) => f.ruleName === 'Kredensial Inline di Dokumentasi')).toBe(false);
  });

  it('GUIDE_OPERASIONAL.md sudah bersih dari kredensial inline', () => {
    const fixes = scanFile(path.join(process.cwd(), 'GUIDE_OPERASIONAL.md'));
    expect(fixes.filter((f) => f.ruleName === 'Kredensial Inline di Dokumentasi')).toEqual([]);
  });
});
