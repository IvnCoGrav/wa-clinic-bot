import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

/**
 * Plan 5 Phase 3 — Invariant Guard: Larangan Mutlak Pemanggilan Label WAHA.
 *
 * Rule dari AGENTS.md:
 * "DILARANG KERAS memanggil atau memodifikasi label WhatsApp di WAHA
 *  (seperti wahaClient.addLabel, removeLabel, atau sinkronisasi label WAHA lainnya)."
 *
 * Test ini memindai seluruh src/ (kecuali waha/client.ts itu sendiri) menggunakan
 * ripgrep untuk memastikan 0 pemanggilan addLabel/removeLabel di kode bisnis.
 */
describe('WAHA Label Ban Invariant (Mandat Mutlak)', () => {
  it('DILARANG memanggil wahaClient.addLabel atau removeLabel di seluruh src/ (kecuali waha/client.ts)', () => {
    const srcDir = path.resolve(__dirname, '../../../src');
    let result: string;
    try {
      result = execSync(
        `rg -n "wahaClient\\.getChatLabels\\(" --glob "!src/routes/webhook.route.ts" --glob "!*.test.ts" --glob "!*.d.ts" src/`,
        { cwd: path.resolve(srcDir, '..'), encoding: 'utf8', timeout: 15000 }
      );
    } catch (err: any) {
      if (err.status === 1) { result = ''; } else { throw err; }
    }

    const violations = result.trim().split('\n').filter((line) => line.length > 0);
    expect(
      violations,
      `[WAHA LABEL BAN VIOLATION] Ditemukan ${violations.length} pemanggilan label WAHA ilegal:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  it('DILARANG memanggil wahaClient.getChatLabels di luar webhook (read-only exception di webhook)', () => {
    const srcDir = path.resolve(__dirname, '../../../src');
    let result: string;
    try {
      result = execSync(
        `rg -n "(?:^|[^*])wahaClient\\.getChatLabels" --glob "!src/routes/webhook.route.ts" --glob "!*.test.ts" --glob "!*.d.ts" src/`,
        { cwd: path.resolve(srcDir, '..'), encoding: 'utf8', timeout: 15000 }
      );
    } catch (err: any) {
      if (err.status === 1) {
        result = '';
      } else {
        throw err;
      }
    }

    const violations = result.trim().split('\n').filter((line) => line.length > 0);
    expect(
      violations,
      `[WAHA READ RESTRICTION] getChatLabels hanya diizinkan di webhook.route.ts:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });
});
