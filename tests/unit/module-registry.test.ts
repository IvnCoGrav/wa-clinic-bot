import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import {
  loadRegistry,
  validateRegistry,
  searchCapabilities,
  generateModuleIndexMarkdown
} from '../../scripts/reuse/lib/registry.mjs';

describe('Module Registry & Discovery Gate (Fase 1)', () => {
  const registry = loadRegistry();

  it('1. Semua canonical + exports valid sesuai implementasi fisik kode', () => {
    const result = validateRegistry(registry);
    if (!result.valid) {
      console.error('Validation errors:', result.errors);
    }
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);

    for (const cap of registry.capabilities) {
      expect(fs.existsSync(cap.canonical)).toBe(true);
      expect(cap.exports.length).toBeGreaterThan(0);
    }
  });

  it('2. Semua test yang dideklarasikan ada di disk', () => {
    for (const cap of registry.capabilities) {
      if (cap.test) {
        expect(fs.existsSync(cap.test)).toBe(true);
      }
    }
  });

  it('3. Tidak ada id atau canonical duplikat', () => {
    const ids = registry.capabilities.map((c: any) => c.id);
    const canonicals = registry.capabilities.map((c: any) => c.canonical);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(canonicals).size).toBe(canonicals.length);
  });

  it('4. find:module "masking hp" mengembalikan pii.mask_phone dan exit 0', () => {
    const matches = searchCapabilities(registry, 'masking hp');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].capability.id).toBe('pii.mask_phone');

    // Uji CLI langsung
    const output = execSync('node scripts/reuse/find-module.mjs "masking hp"', {
      encoding: 'utf8'
    });
    expect(output).toContain('CANONICAL  pii.mask_phone');
    expect(output).toContain('src/utils/pii-masker.ts');
  });

  it('5. find:module "tidak-ada-kapabilitas-xyz" exit 1', () => {
    const matches = searchCapabilities(registry, 'tidak-ada-kapabilitas-xyz');
    expect(matches).toHaveLength(0);

    // Uji CLI langsung menghasilkan error code 1
    let threw = false;
    try {
      execSync('node scripts/reuse/find-module.mjs "tidak-ada-kapabilitas-xyz"', {
        encoding: 'utf8',
        stdio: 'pipe'
      });
    } catch (err: any) {
      threw = true;
      expect(err.status).toBe(1);
      expect(err.stdout).toContain('Tidak ditemukan modul kanonis');
    }
    expect(threw).toBe(true);
  });

  it('6. Generate markdown dua kali menghasilkan output identik (deterministik / zero-drift)', () => {
    const md1 = generateModuleIndexMarkdown(registry);
    const md2 = generateModuleIndexMarkdown(registry);

    expect(md1).toBe(md2);
    expect(md1.length).toBeGreaterThan(100);

    // Pastikan file docs/MODULE_INDEX.md yang ada di disk identik dengan hasil generate
    const diskPath = path.resolve(process.cwd(), 'docs/MODULE_INDEX.md');
    expect(fs.existsSync(diskPath)).toBe(true);
    const diskContent = fs.readFileSync(diskPath, 'utf8');
    // Normalisasi CRLF ke LF untuk perbandingan lintas OS
    expect(diskContent.replace(/\r\n/g, '\n')).toBe(md1.replace(/\r\n/g, '\n'));
  });
});
