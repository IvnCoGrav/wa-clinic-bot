#!/usr/bin/env node
/**
 * check-env-contract.mjs (F7 / G11a) — gerbang deterministik pemisahan env.
 *
 * Memeriksa:
 *  1. `.env.worker` memuat seluruh key wajib worker.
 *  2. `.env.worker` TIDAK memuat secret inbound webhook (deny-list kontrak).
 *  3. `docker-compose.yml`: service `worker` memakai `.env.worker`, bukan `.env`;
 *     service `app` tetap memakai `.env`.
 *
 * Penggunaan: node scripts/check-env-contract.mjs [--compose docker-compose.yml]
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd());

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'env-contract.json'), 'utf-8'));
const worker = contract.worker || {};
const required = worker.required || [];
const denied = new Set(worker.denied || []);
const deniedPrefixes = worker.deniedPrefixes || [];

const envPath = path.resolve(ROOT, argValue('--env', worker.envFile || '.env.worker'));
const composePath = path.resolve(ROOT, argValue('--compose', 'docker-compose.yml'));

const errors = [];
const warnings = [];

// --- 1-2. Kontrak file env worker ---
if (!fs.existsSync(envPath)) {
  errors.push(
    `${path.relative(ROOT, envPath)} belum ada. Jalankan: node scripts/generate-worker-env.mjs`
  );
} else {
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  const keys = new Set();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    keys.add(trimmed.slice(0, eq).trim());
  }

  for (const key of required) {
    if (!keys.has(key)) errors.push(`.env.worker tidak memuat key wajib: ${key}`);
  }
  for (const key of keys) {
    if (denied.has(key) || deniedPrefixes.some((p) => key.startsWith(p))) {
      errors.push(`.env.worker memuat secret yang DILARANG untuk worker: ${key}`);
    }
  }
}

// --- 3. Wiring compose ---
if (!fs.existsSync(composePath)) {
  errors.push(`File compose tidak ditemukan: ${path.relative(ROOT, composePath)}`);
} else {
  const compose = fs.readFileSync(composePath, 'utf-8').split(/\r?\n/);

  /** Ambil blok service level-2 (`  nama:`) sampai service berikutnya. */
  function serviceBlock(name) {
    const start = compose.findIndex((l) => new RegExp(`^\\s{2}${name}:\\s*$`).test(l));
    if (start < 0) return null;
    const out = [];
    for (let i = start + 1; i < compose.length; i++) {
      const line = compose[i];
      if (/^\s{2}[A-Za-z0-9_.-]+:\s*$/.test(line)) break;
      if (/^\S/.test(line) && line.trim()) break;
      out.push(line);
    }
    return out.join('\n');
  }

  const appBlock = serviceBlock('app');
  const workerBlock = serviceBlock('worker');

  if (!appBlock) errors.push('Service `app` tidak ditemukan di docker-compose.yml');
  if (!workerBlock) errors.push('Service `worker` tidak ditemukan di docker-compose.yml');

  if (appBlock && !/^\s*-\s*\.env\s*$/m.test(appBlock)) {
    errors.push('Service `app` harus memakai env_file `.env`');
  }
  if (workerBlock) {
    if (!/^\s*-\s*\.env\.worker\s*$/m.test(workerBlock)) {
      errors.push('Service `worker` harus memakai env_file `.env.worker` (G11a)');
    }
    if (/^\s*-\s*\.env\s*$/m.test(workerBlock)) {
      errors.push('Service `worker` TIDAK boleh memakai `.env` penuh (G11a)');
    }
    for (const line of workerBlock.split('\n')) {
      const m = line.match(/^\s*-\s*([A-Z][A-Z0-9_]*)=/);
      if (!m) continue;
      if (denied.has(m[1])) {
        warnings.push(`Worker masih menyetel secret inbound ` + m[1] + ` secara eksplisit di compose`);
      }
    }
  }
}

for (const warning of warnings) console.warn(`[ENV-CONTRACT] WARN: ${warning}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`[ENV-CONTRACT] FAIL: ${error}`);
  console.error(`[ENV-CONTRACT] ${errors.length} pelanggaran kontrak env.`);
  process.exit(1);
}

console.log('[ENV-CONTRACT] PASS: .env.worker bersih + wiring compose sesuai kontrak.');
