import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { scanFile } from '../../scripts/scan-secrets';

describe('Security Secret Scanner - All Files & Generic Keys (Task 0.1)', () => {
  const tmpDir = path.join(process.cwd(), 'tests', 'unit', '__fixtures_secret_scan__');

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should detect generic API keys and 32-character hex secrets (e.g. ADMIN_API_KEY)', () => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const fixturePath = path.join(tmpDir, 'generic-secret.ts');
    
    // Fixture dibentuk dinamis agar file test ini sendiri tidak memicu
    // secret scanner saat `security:scan:staged` dijalankan.
    const keyName = ['ADMIN', 'API', 'KEY'].join('_');
    const fakeValue = '4a7b9c1d'.repeat(4);
    fs.writeFileSync(
      fixturePath,
      `const config = {\n  ${keyName}: "${fakeValue}",\n};\n`,
      'utf-8'
    );

    const findings = scanFile(fixturePath);
    // Saat ini scanner belum punya rule generik untuk ADMIN_API_KEY / hex 32 chars,
    // sehingga findings akan kosong (gagal).
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => /generic|api.?key|secret|token/i.test(f.ruleName))).toBe(true);
  });

  it('should support scanning all tracked files mode (--all)', async () => {
    // Mode --all harus didukung oleh skrip scanner (saat ini hanya --staged atau porcelain)
    // Scanner harus mengekspor fungsi atau konstanta pemindaian seluruh file git
    const scannerModule = await import('../../scripts/scan-secrets');
    expect(typeof (scannerModule as any).scanAllTrackedFiles).toBe('function');
  });
});
