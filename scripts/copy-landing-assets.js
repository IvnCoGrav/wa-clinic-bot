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
