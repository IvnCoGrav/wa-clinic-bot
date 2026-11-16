#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadRegistry, validateRegistry, generateModuleIndexMarkdown } from './lib/registry.mjs';
import { ROOT_DIR, toAbsolute } from './lib/paths.mjs';

function main() {
  const outputPath = path.resolve(ROOT_DIR, 'docs/MODULE_INDEX.md');

  let registry;
  try {
    registry = loadRegistry();
  } catch (err) {
    console.error(`[ERROR] Gagal memuat registry modul: ${err.message}`);
    process.exit(1);
  }

  const validation = validateRegistry(registry);
  if (!validation.valid) {
    console.error('[ERROR] Validasi module-registry.json gagal:');
    for (const err of validation.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const markdown = generateModuleIndexMarkdown(registry);

  fs.writeFileSync(outputPath, markdown, 'utf8');
  console.log(`[DOCS] Berhasil memperbarui ${path.relative(ROOT_DIR, outputPath)} (${registry.capabilities.length} modul terdaftar)`);
  process.exit(0);
}

main();
