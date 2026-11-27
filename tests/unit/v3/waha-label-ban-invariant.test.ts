import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Plan 5 Phase 3 — Invariant Guard: Larangan Mutlak Pemanggilan Label WAHA.
 *
 * Rule dari AGENTS.md:
 * "DILARANG KERAS memanggil atau memodifikasi label WhatsApp di WAHA
 *  (seperti wahaClient.addLabel, removeLabel, atau sinkronisasi label WAHA lainnya)."
 *
 * Pemindaian memakai `node:fs` (bukan `rg`) supaya gerbang ini juga berjalan di
 * runner CI yang tidak menyediakan ripgrep. Ketiga invarian di bawah dulu gagal
 * di CI justru karena `rg` tidak terpasang, bukan karena ada pelanggaran kode.
 */
const REPO_ROOT = path.resolve(__dirname, '../../..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Kembalikan baris yang cocok, dalam format `src/berkas.ts:12: <baris>`.
 * `exclude` menerima path relatif terhadap repo (mis. `src/routes/webhook.route.ts`).
 */
function scanDir(root: string, pattern: RegExp, exclude: (relPath: string) => boolean): string[] {
  const hits: string[] = [];
  for (const file of listSourceFiles(root)) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    if (exclude(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) hits.push(`${rel}:${index + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

const scanSrc = (pattern: RegExp, exclude: (relPath: string) => boolean) => scanDir(SRC_DIR, pattern, exclude);

describe('WAHA Label Ban Invariant (Mandat Mutlak)', () => {
  it('DILARANG memanggil wahaClient.addLabel atau removeLabel di seluruh src/ (kecuali waha/client.ts)', () => {
    const violations = scanSrc(
      /wahaClient\??\.(?:addLabel|removeLabel)\(/,
      (rel) => rel === 'src/integrations/waha/client.ts'
    );

    expect(
      violations,
      `[WAHA LABEL BAN VIOLATION] Ditemukan ${violations.length} pemanggilan label WAHA ilegal:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  it('DILARANG memanggil .addLabel/.removeLabel/.batchUpdateLabels dalam bentuk apapun di src/ (termasuk chain multiline)', () => {
    // Pola dot-call ini menutup celah call yang dipecah ke baris berikutnya
    // (`wahaClient\n.removeLabel(...)`) dan mencakup batchUpdateLabels.
    const violations = scanSrc(
      /\.(addLabel|removeLabel|batchUpdateLabels)\(/,
      (rel) => rel === 'src/integrations/waha/client.ts' || rel === 'src/cli/mock-waha-client.ts'
    );

    expect(
      violations,
      `[WAHA LABEL BAN VIOLATION] Ditemukan ${violations.length} pemanggilan mutasi label (bentuk apapun):\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  it('DILARANG memanggil wahaClient.getChatLabels di luar webhook (read-only exception di webhook)', () => {
    const violations = scanSrc(
      /(?:^|[^*])wahaClient\.getChatLabels/,
      (rel) => rel === 'src/routes/webhook.route.ts'
    );

    expect(
      violations,
      `[WAHA READ RESTRICTION] getChatLabels hanya diizinkan di webhook.route.ts:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  it('sanity: pemindai benar-benar mendeteksi pelanggaran dan menghormati pengecualian', () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'waha-ban-'));
    try {
      fs.mkdirSync(path.join(tmp, 'sub'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'sub', 'bad.ts'),
        [
          'export function a() {',
          "  return wahaClient.addLabel('x', 'y');",
          '}',
          'export function b() {',
          '  return wahaClient',
          "    .removeLabel('x', 'y');",
          '}',
        ].join('\n'),
        'utf8'
      );
      fs.writeFileSync(path.join(tmp, 'sub', 'ignored.test.ts'), "wahaClient.addLabel('x','y');", 'utf8');

      const firstPattern = scanDir(tmp, /wahaClient\??\.(?:addLabel|removeLabel)\(/, () => false);
      const multilinePattern = scanDir(tmp, /\.(addLabel|removeLabel|batchUpdateLabels)\(/, (rel) =>
        rel.endsWith('ignored.test.ts')
      );

      expect(firstPattern).toHaveLength(1);
      expect(multilinePattern).toHaveLength(2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
