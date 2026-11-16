import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AGENTS.md Integrity & Pointer Guard (Fase 6)', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const agentsMdPath = path.join(rootDir, 'AGENTS.md');
  const packageJsonPath = path.join(rootDir, 'package.json');

  it('ensures AGENTS.md exists and is readable', () => {
    expect(fs.existsSync(agentsMdPath)).toBe(true);
  });

  it('verifies all file/directory paths cited in AGENTS.md exist physically', () => {
    const content = fs.readFileSync(agentsMdPath, 'utf8');
    // Cari semua teks di dalam backtick
    const codeSpans = [...content.matchAll(/`([^`]+)`/g)].map(m => m[1].trim());

    // Filter yang tampak seperti path repository
    const pathCandidates = codeSpans.filter(span => {
      // Hanya yang berawalan docs/, src/, tests/, scripts/, packages/
      if (!/^(docs|src|tests|scripts|packages)\//.test(span)) return false;
      // Abaikan wildcard (*), regex, placeholder (<...>), atau trailing dots
      if (span.includes('*') || span.includes('<') || span.includes('...')) return false;
      return true;
    });

    expect(pathCandidates.length).toBeGreaterThan(0);

    const missingPaths: string[] = [];
    for (const relPath of pathCandidates) {
      // Hapus trailing slash jika direktori
      const cleanPath = relPath.replace(/\/$/, '');
      const fullPath = path.join(rootDir, cleanPath);
      const exists = fs.existsSync(fullPath) ||
        fs.existsSync(fullPath + '.ts') ||
        fs.existsSync(fullPath + '.tsx') ||
        fs.existsSync(fullPath + '.js') ||
        fs.existsSync(fullPath + '.mjs') ||
        fs.existsSync(fullPath + '.json');

      if (!exists) {
        missingPaths.push(relPath);
      }
    }

    expect(missingPaths, `Missing paths cited in AGENTS.md: ${missingPaths.join(', ')}`).toEqual([]);
  });

  it('verifies all npm scripts cited in AGENTS.md exist in package.json', () => {
    const agentsContent = fs.readFileSync(agentsMdPath, 'utf8');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const declaredScripts = new Set(Object.keys(pkg.scripts || {}));

    // Tangkap perintah `npm run <script>` di dalam backtick
    const scriptMatches = [...agentsContent.matchAll(/`npm run ([a-zA-Z0-9:_-]+)(?:\s+[^`]*)?`/g)]
      .map(m => m[1]);

    expect(scriptMatches.length).toBeGreaterThan(0);

    const missingScripts: string[] = [];
    for (const scriptName of scriptMatches) {
      if (!declaredScripts.has(scriptName)) {
        missingScripts.push(scriptName);
      }
    }

    expect(missingScripts, `Missing npm scripts cited in AGENTS.md: ${missingScripts.join(', ')}`).toEqual([]);
  });

  it('contains mandatory reuse, architecture, and UI governance clauses', () => {
    const content = fs.readFileSync(agentsMdPath, 'utf8');
    expect(content).toContain('docs/MODULE_INDEX.md');
    expect(content).toContain('npm run find:module');
    expect(content).toContain('npm run check:reuse');
    expect(content).toContain('ui-registry.json');
  });
});
