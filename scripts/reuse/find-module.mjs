#!/usr/bin/env node
import { loadRegistry, searchCapabilities, countUsages } from './lib/registry.mjs';

function main() {
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('--limit='));
  const query = args.join(' ').trim();

  if (!query) {
    console.error('Penggunaan: npm run find:module -- "<kata kunci pencarian>"');
    console.error('Contoh:    npm run find:module -- "masking hp"');
    console.error('           npm run find:module -- "format tanggal wib"');
    process.exit(1);
  }

  let registry;
  try {
    registry = loadRegistry();
  } catch (err) {
    console.error(`[ERROR] Gagal memuat registry modul: ${err.message}`);
    process.exit(1);
  }

  const results = searchCapabilities(registry, query, 5);

  if (results.length === 0) {
    console.log(`\n[FIND-MODULE] Tidak ditemukan modul kanonis untuk kata kunci: "${query}"`);
    console.log(`Petunjuk: Jika kapabilitas ini baru, buat modul fondasional dan daftarkan di scripts/module-registry.json\n`);
    process.exit(1);
  }

  console.log(`\n[FIND-MODULE] Ditemukan ${results.length} modul kanonis yang cocok:\n`);

  for (const { capability, score } of results) {
    const usageCount = countUsages(capability.canonical);
    console.log(`CANONICAL  ${capability.id}  (skor relevansi: ${score})`);
    console.log(`  Judul    ${capability.title}`);
    console.log(`  File     ${capability.canonical}`);
    console.log(`  Exports  ${capability.exports.join(', ')}`);
    console.log(`  Dipakai  ${usageCount} file di src/`);
    console.log(`  Test     ${capability.test || 'Belum ada (Fase lanjutan)'}`);
    if (capability.forbiddenDeclarations && capability.forbiddenDeclarations.length > 0) {
      console.log(`  Banned   ${capability.forbiddenDeclarations.join(', ')} (dilarang dibuat ulang)`);
    }
    console.log('');
  }

  process.exit(0);
}

main();
