#!/usr/bin/env node
/**
 * check-baseline-ratchet.mjs — Gerbang integritas baseline di CI.
 *
 * Membandingkan baseline yang di-commit SEKARANG dengan baseline pada base ref
 * (branch tujuan PR / commit sebelumnya). Tugasnya menangkap baseline yang
 * dinaikkan manual (edit JSON langsung) — sesuatu yang tidak terlihat oleh
 * `check:reuse` biasa karena gate hanya membandingkan kode dengan baseline.
 *
 * Pemakaian:
 *   node scripts/reuse/check-baseline-ratchet.mjs [--base-ref=origin/master] [--json]
 *
 * Base ref dapat diberikan via env BASELINE_BASE_REF.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  findReuseBaselineIncreases,
  findArchitectureBaselineIncreases,
  formatIncreases
} from './lib/baseline-ratchet.mjs';

const BASELINE_FILES = [
  'duplication',
  'forbidden-declarations',
  'dead-exports',
  'file-size',
  'architecture'
];

function parseArgs() {
  const options = { baseRef: process.env.BASELINE_BASE_REF || null, json: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--base-ref=')) options.baseRef = arg.slice('--base-ref='.length);
    else if (arg === '--json') options.json = true;
  }
  return options;
}

function git(root, args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function resolveBaseRef(root, requested) {
  if (requested) {
    try {
      git(root, ['rev-parse', '--verify', requested]);
      return requested;
    } catch {
      throw new Error(`Base ref tidak ditemukan: ${requested}`);
    }
  }
  for (const candidate of ['origin/master', 'origin/main', 'HEAD~1']) {
    try {
      git(root, ['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {}
  }
  throw new Error('Tidak dapat menemukan base ref (origin/master / origin/main / HEAD~1).');
}

function readCurrentBaseline(root, name) {
  const file = path.join(root, 'scripts/reuse/baselines', `${name}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Baseline sekarang bukan JSON valid (${name}): ${err.message}`);
  }
}

function readPreviousBaseline(root, baseRef, name) {
  try {
    const raw = git(root, ['show', `${baseRef}:scripts/reuse/baselines/${name}.json`]);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function main() {
  const options = parseArgs();
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const baseRef = resolveBaseRef(root, options.baseRef);

  const current = {};
  const previous = {};
  for (const name of BASELINE_FILES) {
    current[name] = readCurrentBaseline(root, name);
    previous[name] = readPreviousBaseline(root, baseRef, name);
  }

  const increases = [];
  if (previous.duplication && current.duplication) {
    increases.push(
      ...findReuseBaselineIncreases(
        {
          duplication: previous.duplication,
          forbidden: previous['forbidden-declarations'],
          deadExports: previous['dead-exports'],
          fileSize: previous['file-size']
        },
        {
          duplicationGroups: current.duplication.groups || [],
          structuralGroups: current.duplication.structuralGroups || [],
          forbiddenViolations: current['forbidden-declarations']?.violations || [],
          deadExports: current['dead-exports']?.deadExports || [],
          largeFiles: current['file-size']?.files || []
        }
      )
    );
  }
  if (previous.architecture && current.architecture) {
    increases.push(...findArchitectureBaselineIncreases(previous.architecture, current.architecture));
  }

  if (options.json) {
    console.log(JSON.stringify({ passed: increases.length === 0, baseRef, increases }, null, 2));
  } else {
    console.log('======================================================');
    console.log('  BASELINE RATCHET INTEGRITY (CI)');
    console.log('======================================================');
    console.log(`Base ref : ${baseRef}`);
    console.log(`Hasil    : ${increases.length === 0 ? 'OK (tidak ada kenaikan)' : `${increases.length} KENAIKAN`}`);
    if (increases.length > 0) {
      console.log('');
      console.log(formatIncreases(increases));
      console.log('');
      console.log('Baseline hanya boleh turun. Kenaikan wajib lewat persetujuan + known issues.');
    }
  }

  process.exit(increases.length === 0 ? 0 : 1);
}

main();
