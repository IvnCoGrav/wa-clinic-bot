import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { scanFile } from '../../scripts/scan-secrets';

describe('Security Audit — scan-secrets.ts', () => {
  const tmpDir = path.join(__dirname, '../../temp_security_test');

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should detect and block live Kenari API keys (kn-...)', () => {
    const testFile = path.join(tmpDir, 'test_kenari_leak.ts');
    const dummyKenari = 'kn-' + 'fakekey1234567890abcdef12345';
    fs.writeFileSync(testFile, `const key = "${dummyKenari}";`, 'utf-8');

    const findings = scanFile(testFile);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].ruleName).toContain('Kenari');
  });

  it('should detect and block live SumoPod / OpenAI keys (sk-...)', () => {
    const testFile = path.join(tmpDir, 'test_sumopod_leak.ts');
    const dummySumoPod = 'sk-' + 'fakekey1234567890abcdef12345LiveKey';
    fs.writeFileSync(testFile, `const key = "${dummySumoPod}";`, 'utf-8');

    const findings = scanFile(testFile);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].ruleName).toContain('SumoPod');
  });

  it('should allow valid placeholder strings without false positives', () => {
    const testFile = path.join(tmpDir, 'test_placeholder.ts');
    fs.writeFileSync(
      testFile,
      'const k1 = "kn-your-api-key-here";\nconst k2 = "sk-your-sumopod-key-here";\nconst k3 = "AIzaSyValidTestKey";',
      'utf-8'
    );

    const findings = scanFile(testFile);
    expect(findings.length).toBe(0);
  });

  it('should strictly flag any committed .env file', () => {
    const findings = scanFile('.env');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].ruleName).toContain('.env');
  });

  it('tidak menandai frasa konfirmasi CLI sebagai kredensial (konstanta simbolik)', () => {
    const testFile = path.join(tmpDir, 'test_confirm_phrase.ts');
    // Kasus nyata src/scripts/reconcile-payment-proof-rows.ts:41 yang membuat
    // gerbang security:scan CI merah sejak 2026-11-19.
    fs.writeFileSync(
      testFile,
      "const CONFIRM_TOKEN = 'RECONCILE_PAYMENT_PROOFS_CONFIRMED';",
      'utf-8'
    );

    expect(scanFile(testFile)).toHaveLength(0);
  });

  it('tetap menandai kunci riil meski nama variabelnya berakhiran TOKEN/SECRET', () => {
    const testFile = path.join(tmpDir, 'test_real_looking_secret.ts');
    // Fixture dirakit dinamis agar file test ini sendiri tidak memicu scanner.
    const apiKeyName = ['ADMIN', 'API', 'KEY'].join('_');
    const mixedValue = ['aB3d', 'E5fG', '7hJ9', 'kL1m'].join('');
    const tokenName = ['SESSION', 'TOKEN'].join('_');
    const tokenValue = ['tk', 'live', '9f8e7d6c5b4a'].join('_');
    fs.writeFileSync(
      testFile,
      `const ${apiKeyName} = "${mixedValue}";\nconst ${tokenName} = "${tokenValue}";`,
      'utf-8'
    );

    const findings = scanFile(testFile);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.ruleName.includes('Generic API Key'))).toBe(true);
    // Nilai tidak boleh bocor utuh di laporan.
    expect(findings.every((f) => !f.snippet.includes(mixedValue))).toBe(true);
  });

  it('tidak melonggar sampai kata tunggal ALL_CAPS (mis. PASSWORD123456)', () => {
    const testFile = path.join(tmpDir, 'test_single_word_secret.ts');
    const passName = ['DB', 'PASSWORD'].join('_');
    const passValue = ['PASSWORD', '123456'].join('');
    fs.writeFileSync(testFile, `const ${passName} = "${passValue}";`, 'utf-8');

    const findings = scanFile(testFile);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleName).toContain('Generic API Key');
  });
});
