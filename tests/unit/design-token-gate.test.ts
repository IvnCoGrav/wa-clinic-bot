import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Regresi gerbang `check:tokens` (design tokens).
 *
 * Latar belakang: aturan hex sebelumnya menghitung SEMUA `#abc`/`#aabbcc`,
 * termasuk nomor issue di dalam kalimat seperti `KNOWN #358 A-004`. Akibatnya
 * CI merah padahal tidak ada warna hardcode yang ditambahkan. Perbaikan:
 * sebuah token hanya dianggap warna bila mengakhiri nilai (diikuti kutip,
 * kurung, `]`, `;`, `,`, `}`, atau akhir baris).
 */
const DASHBOARD = path.resolve(__dirname, '../../packages/admin-dashboard');
const SCRIPT = path.join(DASHBOARD, 'scripts', 'check-design-tokens.mjs');

function runGate(files: Record<string, string>): { status: number | null; out: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-token-gate-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  const result = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, DESIGN_TOKEN_PKG: root },
    encoding: 'utf8',
  });
  fs.rmSync(root, { recursive: true, force: true });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('Design token gate — warna vs referensi issue', () => {
  it('referensi issue di dalam kalimat bukan warna (KNOWN #358 A-004)', () => {
    const result = runGate({
      'src/config/notes.ts': "export const note = 'Hanya Super Admin (KNOWN #358 A-004).';",
    });
    expect(result.status).toBe(0);
  });

  it('hex warna nyata tetap ditolak', () => {
    const result = runGate({
      'src/components/Card.tsx': 'export const Card = () => <div className="bg-[#ffffff]" />;',
    });
    expect(result.status).toBe(1);
    expect(result.out).toContain('GAGAL');
  });

  it('hex dua digit per baris dihitung terpisah, bukan satu', () => {
    const result = runGate({
      'src/utils/palette.ts': "export const tone = ['#008069', '#0284c7'];",
    });
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/2 hex/);
  });

  it('hex di dalam komentar tetap diabaikan', () => {
    const result = runGate({
      'src/config/theme.ts': '// warna lama #ff0000 dihapus\n/* #00ff00 juga */\nexport const ok = 1;',
    });
    expect(result.status).toBe(0);
  });

  it('transition-all tetap ditolak meski tanpa hex', () => {
    const result = runGate({
      'src/components/Badge.tsx': 'export const B = () => <span className="transition-all" />;',
    });
    expect(result.status).toBe(1);
    expect(result.out).toContain('transition-all');
  });
});
