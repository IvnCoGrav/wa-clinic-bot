import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// scripts/reuse/lib -> root repo (3 tingkat ke atas)
export const ROOT_DIR = path.resolve(__dirname, '../../..');

/**
 * Mengubah path absolut menjadi path relatif terhadap ROOT_DIR (format slash /).
 * @param {string} absPath
 * @returns {string}
 */
export function toRelative(absPath) {
  return path.relative(ROOT_DIR, absPath).replace(/\\/g, '/');
}

/**
 * Mengubah path relatif menjadi path absolut.
 * @param {string} relPath
 * @returns {string}
 */
export function toAbsolute(relPath) {
  return path.resolve(ROOT_DIR, relPath);
}

/**
 * Memeriksa apakah path ada di disk.
 * @param {string} relOrAbsPath
 * @returns {boolean}
 */
export function exists(relOrAbsPath) {
  const p = path.isAbsolute(relOrAbsPath) ? relOrAbsPath : toAbsolute(relOrAbsPath);
  return fs.existsSync(p);
}

/**
 * Melakukan scan rekursif file dalam direktori.
 * @param {string} dirRelOrAbs
 * @param {{ extensions?: string[], exclude?: string[] }} [options]
 * @returns {string[]} path relatif terhadap ROOT_DIR
 */
export function listFiles(dirRelOrAbs, { extensions = ['.ts', '.tsx', '.mjs', '.js'], exclude = [] } = {}) {
  const startDir = path.isAbsolute(dirRelOrAbs) ? dirRelOrAbs : toAbsolute(dirRelOrAbs);
  if (!fs.existsSync(startDir)) return [];

  const results = [];
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = toRelative(full);

      // Cek pengecualian direktori atau nama
      if (exclude.some(ex => rel === ex || rel.startsWith(ex + '/') || entry.name === ex)) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (!extensions.length || extensions.some(ext => entry.name.endsWith(ext))) {
          results.push(rel);
        }
      }
    }
  }

  walk(startDir);
  return results.sort();
}
