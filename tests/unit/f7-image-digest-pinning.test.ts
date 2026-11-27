import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * F7 / M17-08 & M17-02 — supply chain deterministik:
 * - seluruh image runtime dipin ke digest sha256 (tag tetap untuk keterbacaan);
 * - tidak ada tag `latest`;
 * - build context tetap mengecualikan berkas sensitif.
 */

const ROOT = path.resolve(__dirname, '../..');
const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf-8');
const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf-8');

const DIGEST_RE = /@sha256:[a-f0-9]{64}\b/;

describe('F7 — digest pinning image', () => {
  it('seluruh service compose memakai digest sha256', () => {
    const images = [...compose.matchAll(/^\s+image:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    // app & worker memakai `build:` (bukan image), sisanya: redis, postgres, caddy, waha.
    expect(images.length).toBeGreaterThanOrEqual(4);
    for (const image of images) {
      expect(image, `image tidak dipin: ${image}`).toMatch(DIGEST_RE);
    }
  });

  it('WAHA tetap pada tag terkunci (bukan :latest) + digest', () => {
    const wahaLine = compose
      .split(/\r?\n/)
      .find((line) => /^\s+image:/.test(line) && line.includes('devlikeapro/waha'));
    const waha = wahaLine?.trim().replace(/^image:\s*/, '');
    expect(waha).toBeTruthy();
    expect(waha).toContain('noweb-2026.7.2');
    expect(waha).toMatch(DIGEST_RE);
    expect(waha).not.toContain(':latest');
  });

  it('seluruh FROM di Dockerfile dipin ke digest', () => {
    const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThanOrEqual(2);
    for (const image of froms) {
      expect(image, `FROM tidak dipin: ${image}`).toMatch(DIGEST_RE);
    }
  });

  it('tidak ada tag :latest di compose maupun Dockerfile', () => {
    expect(compose).not.toMatch(/:latest\b/);
    expect(dockerfile).not.toMatch(/:latest\b/);
  });

  it('script migrasi memakai alpine ber-digest, bukan tag mengambang', () => {
    for (const file of ['scripts/vps-migrate-export.sh', 'scripts/vps-migrate-import.sh']) {
      const content = fs.readFileSync(path.join(ROOT, file), 'utf-8');
      expect(content).toMatch(/alpine:3@sha256:[a-f0-9]{64}/);
      expect(content).not.toMatch(/\balpine\s+(?:tar|sh)\b/);
    }
  });

  it('prosedur update digest terdokumentasi di deploy_config.txt', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'deploy_config.txt'), 'utf-8');
    expect(doc).toContain('Digest Pinning Image');
    expect(doc).toContain('imagetools inspect');
    expect(doc).toContain('2-step verification');
  });
});
