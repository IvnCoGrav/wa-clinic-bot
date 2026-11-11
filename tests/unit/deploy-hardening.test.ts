import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** S-016: hardening container — non-root, tanpa privilege tambahan, cap drop. */
describe('Deploy hardening container (S-016)', () => {
  const root = process.cwd();
  const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

  it('Dockerfile menjalankan proses sebagai non-root', () => {
    expect(dockerfile).toMatch(/^USER\s+node\s*$/m);
  });

  it('service app & worker memakai no-new-privileges + cap_drop ALL', () => {
    const appBlock = compose.split('\n  app:')[1]?.split('\n  worker:')[0] || '';
    const workerBlock = compose.split('\n  worker:')[1]?.split('\n  redis:')[0] || '';
    for (const block of [appBlock, workerBlock]) {
      expect(block).toContain('no-new-privileges:true');
      expect(block).toMatch(/cap_drop:\s*\n\s*-\s*ALL/);
    }
    expect(compose.match(/no-new-privileges:true/g)?.length || 0).toBeGreaterThanOrEqual(2);
    expect(compose.match(/cap_drop:/g)?.length || 0).toBeGreaterThanOrEqual(2);
  });
});
