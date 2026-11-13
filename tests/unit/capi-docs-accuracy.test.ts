import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * M-10 — dokumentasi CAPI/landing harus akurat & tidak menyimpan data
 * infrastruktur live. Dikunci agar tidak kembali drift.
 */
const root = process.cwd();
const capi = fs.readFileSync(path.join(root, 'docs/META_CAPI_SETUP.md'), 'utf8');
const landing = fs.readFileSync(path.join(root, 'docs/INTEGRASI_LANDING_EXTERNAL.md'), 'utf8');

describe('M-10 akurasi dokumentasi CAPI & landing', () => {
  it('panduan CAPI memakai placeholder, bukan IP/port/pixel live', () => {
    expect(capi).not.toContain('43.157.197.148');
    expect(capi).not.toMatch(/ssh -p 1403/);
    expect(capi).not.toContain('1382300863013984');
    expect(capi).toContain('<SERVER_HOST>');
    expect(capi).toContain('<APP_DIR>');
    expect(capi).toMatch(/jangan disalin ke dokumen/i);
  });

  it('panduan landing menyatakan tracker TIDAK read-only dan pixel di klien', () => {
    expect(landing).toContain('bukan read-only');
    expect(landing).toContain('PageView');
    expect(landing).toContain('?pixel=');
    expect(landing).toContain('?tenant=');
    expect(landing).not.toContain('Seluruh logika atribusi & pixel tetap ditangani server-side');
  });

  it('dokumen tidak menyembunyikan sisa temuan hardcoded pixel', () => {
    expect(capi).toContain('M-02');
    expect(landing).toContain('M-02');
  });
});
