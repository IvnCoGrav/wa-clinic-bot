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
});
