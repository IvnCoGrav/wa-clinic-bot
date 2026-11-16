/**
 * src/utils/regex-escape.ts
 * Escape karakter regex khusus agar aman digunakan di dalam RegExp dinamis.
 * Modul kanonis zero-dependency untuk deduplikasi regex escape.
 */
export function escapeRegex(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
