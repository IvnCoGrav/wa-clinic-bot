import fs from 'fs';
import path from 'path';

export const BACKUP_STORAGE_DIR = path.join(process.cwd(), 'storage', 'backups');

/**
 * Memastikan direktori storage/backups/ tersedia dan aman
 */
export function ensureBackupDirectory(): string {
  if (!fs.existsSync(BACKUP_STORAGE_DIR)) {
    fs.mkdirSync(BACKUP_STORAGE_DIR, { recursive: true });
  }
  return BACKUP_STORAGE_DIR;
}

/**
 * Generate nama file backup terstandar berbasis timestamp
 */
export function generateBackupFileName(prefix = 'wa_clinic_backup'): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const MM = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());

  return `${prefix}_${yyyy}${MM}${dd}_${hh}${mm}${ss}.sql.gz`;
}

/**
 * Memvalidasi apakah file aman dari path traversal dan berakhiran .sql.gz
 */
export function sanitizeBackupFileName(fileName: string): string {
  const safeName = path.basename(fileName);
  if (!safeName.endsWith('.sql.gz') && !safeName.endsWith('.sql') && !safeName.endsWith('.json.gz')) {
    throw new Error('Ekstensi file backup tidak valid. Harus .sql.gz atau .sql');
  }
  return safeName;
}

/**
 * Memeriksa magic bytes untuk memvalidasi format gzip / sql
 */
export function isValidGzipHeader(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const buffer = Buffer.alloc(2);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 2, 0);
    fs.closeSync(fd);
    // Gzip magic bytes: 0x1F, 0x8B
    return buffer[0] === 0x1f && buffer[1] === 0x8b;
  } catch {
    return false;
  }
}

/**
 * Format bytes ke ukuran yang mudah dibaca (KB / MB)
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
