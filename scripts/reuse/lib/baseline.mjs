import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR, toAbsolute, exists } from './paths.mjs';

export const BASELINE_DIR = path.resolve(ROOT_DIR, 'scripts/reuse/baselines');

/**
 * Mendapatkan short SHA commit saat ini.
 * @returns {string}
 */
export function getCurrentCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: ROOT_DIR }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Membaca baseline JSON dari direktori baselines.
 * @param {string} name
 * @param {string} [customDir]
 * @returns {any | null}
 */
export function loadBaseline(name, customDir = BASELINE_DIR) {
  const filePath = path.resolve(customDir, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Gagal membaca baseline ${name}.json: ${err.message}`);
  }
}

/**
 * Menyimpan baseline JSON ke direktori baselines.
 * @param {string} name
 * @param {any} data
 * @param {string} [customDir]
 */
export function saveBaseline(name, data, customDir = BASELINE_DIR) {
  if (!fs.existsSync(customDir)) {
    fs.mkdirSync(customDir, { recursive: true });
  }
  const filePath = path.resolve(customDir, `${name}.json`);
  const content = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}
