import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { loadExceptions, matchException } from '../../scripts/reuse/lib/exceptions.mjs';

describe('Exception Registry & Waiver Governance (Fase 7 - P3)', () => {
  it('correctly loads and categorizes active vs expired exceptions', () => {
    const tempFile = path.join(os.tmpdir(), `exceptions-test-${Date.now()}.json`);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    fs.writeFileSync(tempFile, JSON.stringify({
      version: 1,
      exceptions: [
        {
          rule: 'FORBIDDEN_DECLARATION',
          name: 'activeSymbol',
          reason: 'Test active waiver',
          owner: 'team-a',
          expiresAt: tomorrow
        },
        {
          rule: 'DUPLICATE_FUNCTION',
          fingerprint: 'sha256:abc',
          reason: 'Test expired waiver',
          owner: 'team-b',
          expiresAt: yesterday
        }
      ]
    }));

    const result = loadExceptions(tempFile);
    expect(result.errors).toEqual([]);
    expect(result.active.length).toBe(1);
    expect(result.active[0].name).toBe('activeSymbol');
    expect(result.expired.length).toBe(1);
    expect(result.expired[0].fingerprint).toBe('sha256:abc');

    fs.unlinkSync(tempFile);
  });

  it('matches violations accurately by fingerprint, file, or symbol name', () => {
    const activeExceptions = [
      {
        rule: 'DUPLICATE_FUNCTION',
        fingerprint: 'sha256:hash123',
        reason: 'Paralel adapter',
        expiresAt: '2099-01-01'
      },
      {
        rule: 'FORBIDDEN_DECLARATION',
        file: 'src/services/temp.ts',
        name: 'bannedHelper',
        reason: 'Temporary migration',
        expiresAt: '2099-01-01'
      }
    ];

    // Kasus 1: Cocok fingerprint hash
    const match1 = matchException({
      type: 'DUPLICATE_FUNCTION',
      hash: 'sha256:hash123',
      files: [{ file: 'src/a.ts', line: 1 }]
    }, activeExceptions);
    expect(match1).not.toBeNull();
    expect(match1?.reason).toBe('Paralel adapter');

    // Kasus 2: Hash beda -> tidak cocok
    const match2 = matchException({
      type: 'DUPLICATE_FUNCTION',
      hash: 'sha256:different',
      files: [{ file: 'src/a.ts', line: 1 }]
    }, activeExceptions);
    expect(match2).toBeNull();

    // Kasus 3: Cocok file & nama simbol
    const match3 = matchException({
      type: 'FORBIDDEN_DECLARATION',
      file: 'src/services/temp.ts',
      name: 'bannedHelper'
    }, activeExceptions);
    expect(match3).not.toBeNull();
    expect(match3?.name).toBe('bannedHelper');

    // Kasus 4: Rule beda -> tidak cocok
    const match4 = matchException({
      type: 'DEAD_EXPORT',
      file: 'src/services/temp.ts',
      name: 'bannedHelper'
    }, activeExceptions);
    expect(match4).toBeNull();
  });

  it('adversarial integration: active waiver passes gate, expired waiver fails gate', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-exc-'));
    const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-base-'));
    const exceptionsFile = path.join(fixtureDir, 'exceptions.json');

    // 1. Buat fixture file yang memiliki deklarasi terlarang
    fs.writeFileSync(path.join(fixtureDir, 'service.ts'), `
export function isClinicLocationQuestion(text: string): boolean {
  return text.includes('lokasi');
}
`);

    // Baseline kosong (agar pelanggaran dihitung sebagai baru)
    fs.writeFileSync(path.join(baselineDir, 'forbidden-declarations.json'), JSON.stringify({
      version: 1,
      violations: []
    }));
    fs.writeFileSync(path.join(baselineDir, 'duplication.json'), JSON.stringify({ version: 1, groups: [] }));
    fs.writeFileSync(path.join(baselineDir, 'file-size.json'), JSON.stringify({ version: 1, files: [] }));
    fs.writeFileSync(path.join(baselineDir, 'dead-exports.json'), JSON.stringify({ version: 1, deadExports: [] }));

    const checkReuseScript = path.resolve(__dirname, '../../scripts/reuse/check-reuse.mjs');

    // Test A: Tanpa exception -> HARUS GAGAL (exit 1)
    let failedWithoutException = false;
    try {
      execSync(`node "${checkReuseScript}" --root="${fixtureDir}" --baseline-dir="${baselineDir}" --exceptions-file="${exceptionsFile}" --only=forbidden`, {
        stdio: 'pipe'
      });
    } catch (err: any) {
      failedWithoutException = true;
      expect(err.status).toBe(1);
    }
    expect(failedWithoutException).toBe(true);

    // Test B: Dengan exception AKTIF -> HARUS LULUS (exit 0)
    fs.writeFileSync(exceptionsFile, JSON.stringify({
      version: 1,
      exceptions: [
        {
          rule: 'FORBIDDEN_DECLARATION',
          name: 'isClinicLocationQuestion',
          reason: 'Izin migrasi sementara',
          owner: 'backend',
          expiresAt: '2099-12-31'
        }
      ]
    }));

    const passOutput = execSync(`node "${checkReuseScript}" --root="${fixtureDir}" --baseline-dir="${baselineDir}" --exceptions-file="${exceptionsFile}" --only=forbidden --json`, {
      encoding: 'utf8'
    });
    const passJson = JSON.parse(passOutput);
    expect(passJson.passed).toBe(true);
    expect(passJson.summary.newViolations).toBe(0);
    expect(passJson.summary.exemptedViolations).toBe(1);

    // Test C: Dengan exception KEDALUWARSA -> HARUS GAGAL (exit 1)
    fs.writeFileSync(exceptionsFile, JSON.stringify({
      version: 1,
      exceptions: [
        {
          rule: 'FORBIDDEN_DECLARATION',
          name: 'isClinicLocationQuestion',
          reason: 'Izin migrasi sementara',
          owner: 'backend',
          expiresAt: '2020-01-01' // Sudah kedaluwarsa!
        }
      ]
    }));

    let failedWithExpired = false;
    try {
      execSync(`node "${checkReuseScript}" --root="${fixtureDir}" --baseline-dir="${baselineDir}" --exceptions-file="${exceptionsFile}" --only=forbidden`, {
        stdio: 'pipe'
      });
    } catch (err: any) {
      failedWithExpired = true;
      expect(err.status).toBe(1);
      const out = err.stdout?.toString() || err.stderr?.toString();
      expect(out).toContain('EXPIRED_EXCEPTION');
    }
    expect(failedWithExpired).toBe(true);

    // Cleanup
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(baselineDir, { recursive: true, force: true });
  });
});
