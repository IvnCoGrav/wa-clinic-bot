#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'landing', 'public');
const outDir = path.join(__dirname, '..', 'dist', 'landing', 'public');

if (!fs.existsSync(srcDir)) {
  console.warn('[copy-landing-assets] src/landing/public tidak ditemukan — lewati.');
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });

for (const file of fs.readdirSync(srcDir)) {
  fs.copyFileSync(path.join(srcDir, file), path.join(outDir, file));
}

console.log(`[copy-landing-assets] Template landing disalin ke ${path.relative(process.cwd(), outDir)}`);

// CFG-02: Pastikan asset konfigurasi runtime juga disalin ke dist/config
const configSrc = path.join(__dirname, '..', 'src', 'config');
const configDist = path.join(__dirname, '..', 'dist', 'config');
if (fs.existsSync(configSrc)) {
  fs.mkdirSync(configDist, { recursive: true });
  for (const filename of ['persona_custom.txt', 'surabaya_sidoarjo_subdistricts.json', 'landmarks.data.json', 'kenari-pricing.snapshot.json']) {
    const fileSrc = path.join(configSrc, filename);
    const fileDist = path.join(configDist, filename);
    if (fs.existsSync(fileSrc)) {
      fs.copyFileSync(fileSrc, fileDist);
      console.log(`[copy-landing-assets] Config asset ${filename} disalin ke ${path.relative(process.cwd(), fileDist)}`);
    }
  }
}
