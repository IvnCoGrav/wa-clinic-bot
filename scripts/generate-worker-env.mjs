#!/usr/bin/env node
/**
 * generate-worker-env.mjs (F7 / G11a) — turunkan `.env.worker` dari `.env`.
 *
 * Tujuan: container worker hanya menerima secret yang benar-benar dibutuhkannya.
 * Secret inbound webhook (WAHA/Meta/Telegram) TIDAK boleh ikut, karena worker tidak
 * membuka HTTP: kompromi worker tidak boleh memberi kemampuan memalsukan webhook.
 *
 * Pendekatan allow-by-default + deny-list (bukan allow-list penuh) dipilih agar
 * cron yang membutuhkan integrasi (Google, Sheets, LLM, WABA, backup) tidak patah
 * diam-diam saat env baru ditambahkan. Daftar larangan ada di env-contract.json.
 *
 * Penggunaan:
 *   node scripts/generate-worker-env.mjs [--in .env] [--out .env.worker]
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd());

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inPath = path.resolve(ROOT, argValue('--in', '.env'));
const outPath = path.resolve(ROOT, argValue('--out', '.env.worker'));
const contractPath = path.join(ROOT, 'scripts', 'env-contract.json');

if (!fs.existsSync(inPath)) {
  console.error(`[WORKER-ENV] File sumber tidak ditemukan: ${inPath}`);
  process.exit(1);
}

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));
const worker = contract.worker || {};
const denied = new Set(worker.denied || []);
const deniedPrefixes = worker.deniedPrefixes || [];
const required = worker.required || [];

const isDenied = (key) =>
  denied.has(key) || deniedPrefixes.some((prefix) => key.startsWith(prefix));

const kept = [];
const dropped = [];
for (const rawLine of fs.readFileSync(inPath, 'utf-8').split(/\r?\n/)) {
  const line = rawLine;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    kept.push(line);
    continue;
  }
  const eq = trimmed.indexOf('=');
  if (eq <= 0) {
    kept.push(line);
    continue;
  }
  const key = trimmed.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    kept.push(line);
    continue;
  }
  if (isDenied(key)) {
    dropped.push(key);
    continue;
  }
  kept.push(line);
}

const missing = required.filter((key) => !kept.some((l) => l.trim().startsWith(`${key}=`)));
if (missing.length > 0) {
  console.error(`[WORKER-ENV] .env tidak memuat key wajib worker: ${missing.join(', ')}`);
  process.exit(1);
}

const header = [
  '# DIBUAT OTOMATIS oleh scripts/generate-worker-env.mjs (F7/G11a).',
  '# Jangan edit manual; ubah .env lalu jalankan ulang generator.',
  '# Secret inbound webhook sengaja TIDAK disalin ke file ini.',
  '',
].join('\n');

const tmpPath = `${outPath}.tmp-${process.pid}`;
fs.writeFileSync(tmpPath, header + kept.join('\n') + '\n', { mode: 0o600 });
fs.renameSync(tmpPath, outPath);
try {
  fs.chmodSync(outPath, 0o600);
} catch {
  /* Windows: mode POSIX tidak berlaku */
}

console.log(
  `[WORKER-ENV] ${path.relative(ROOT, outPath)} ditulis (${kept.filter((l) => l.includes('=')).length} baris, ${dropped.length} secret inbound dibuang).`
);
if (dropped.length > 0) {
  console.log(`[WORKER-ENV] Tidak disalin: ${dropped.join(', ')}`);
}
