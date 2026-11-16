import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve(process.cwd(), 'scripts/reuse/check-baseline-ratchet.mjs');

function git(cwd: string, args: string[]) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} gagal: ${res.stderr}`);
  return res.stdout;
}

function writeBaselines(root: string, options: { forbidden: number }) {
  const dir = path.join(root, 'scripts/reuse/baselines');
  fs.mkdirSync(dir, { recursive: true });
  const violations = Array.from({ length: options.forbidden }, (_, i) => ({
    capabilityId: 'uji',
    name: `simbol${i}`,
    file: `src/f${i}.ts`
  }));
  fs.writeFileSync(path.join(dir, 'duplication.json'), JSON.stringify({ version: 2, groups: [], structuralGroups: [] }));
  fs.writeFileSync(path.join(dir, 'forbidden-declarations.json'), JSON.stringify({ version: 1, violations }));
  fs.writeFileSync(path.join(dir, 'dead-exports.json'), JSON.stringify({ version: 1, deadExports: [] }));
  fs.writeFileSync(path.join(dir, 'file-size.json'), JSON.stringify({ version: 1, maxLines: 1500, files: [] }));
  fs.writeFileSync(
    path.join(dir, 'architecture.json'),
    JSON.stringify({
      version: 1,
      layerViolations: [],
      adminIntegrations: [],
      cycles: [],
      prismaBudget: { totalCalls: 0, files: {} }
    })
  );
}

/**
 * Uji adversarial gerbang CI: baseline yang diedit manual naik WAJIB ditolak,
 * termasuk saat jumlah total sama (tukar item lama dengan item baru).
 */
describe('check-baseline-ratchet (CI) — anti baseline naik manual', () => {
  function run(root: string, baseRef: string) {
    return spawnSync(process.execPath, [SCRIPT, `--base-ref=${baseRef}`], {
      cwd: root,
      encoding: 'utf8'
    });
  }

  it('menolak kenaikan baseline dan menerima baseline yang sama/turun', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-ratchet-ci-'));
    try {
      git(root, ['init', '-q']);
      git(root, ['config', 'user.email', 'uji@example.test']);
      git(root, ['config', 'user.name', 'Uji']);
      writeBaselines(root, { forbidden: 1 });
      git(root, ['add', '.']);
      git(root, ['commit', '-q', '-m', 'baseline awal']);

      // Sama persis → lolos.
      const same = run(root, 'HEAD');
      expect(same.status).toBe(0);
      expect(same.stdout).toContain('OK');

      // Naik → ditolak.
      writeBaselines(root, { forbidden: 2 });
      const increased = run(root, 'HEAD');
      expect(increased.status).toBe(1);
      expect(increased.stdout).toContain('deklarasi terlarang');

      // Tukar item dengan jumlah sama tetap dianggap naik.
      writeBaselines(root, { forbidden: 1 });
      const dir = path.join(root, 'scripts/reuse/baselines');
      const swapped = JSON.parse(fs.readFileSync(path.join(dir, 'forbidden-declarations.json'), 'utf8'));
      swapped.violations[0].file = 'src/berbeda.ts';
      fs.writeFileSync(path.join(dir, 'forbidden-declarations.json'), JSON.stringify(swapped));
      const swappedRes = run(root, 'HEAD');
      expect(swappedRes.status).toBe(1);
      expect(swappedRes.stdout).toContain('deklarasi terlarang');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
