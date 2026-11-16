/**
 * src/scripts/lib/parse-args.ts
 * Parser argumen CLI kanonis untuk skrip-skrip administratif dan maintenance di src/scripts.
 * Mendukung format:
 * - `--key=value` (contoh: `--tenant=default-tenant`, `--limit=50`)
 * - `--key value` (contoh: `--start 2026-01-01`, `--count 10`)
 * - `--flag` (boolean flag, contoh: `--commit`, `--dry-run`, `--help`)
 */

export interface ParseArgsOptions {
  /** Nama flag yang selalu bertindak sebagai boolean (tidak menyerap token berikutnya) */
  booleanFlags?: string[];
}

export function parseCliArgs(
  argv: string[] = process.argv.slice(2),
  options: ParseArgsOptions = {}
): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  const booleanSet = new Set(
    options.booleanFlags || ['commit', 'dry-run', 'dryRun', 'execute', 'help', 'force', 'allow-synthetic']
  );

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const body = arg.slice(2);
    const eqIdx = body.indexOf('=');

    if (eqIdx !== -1) {
      const key = body.slice(0, eqIdx);
      const val = body.slice(eqIdx + 1);
      result[key] = val;
    } else {
      const key = body;
      if (booleanSet.has(key)) {
        result[key] = true;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          result[key] = next;
          i++;
        } else {
          result[key] = true;
        }
      }
    }
  }

  return result;
}

export function getArgString(options: Record<string, string | boolean>, key: string, fallback = ''): string {
  const val = options[key];
  return typeof val === 'string' ? val.trim() : fallback;
}

export function getArgNumber(
  options: Record<string, string | boolean>,
  key: string,
  fallback?: number
): number | undefined {
  const val = options[key];
  if (val === undefined || typeof val === 'boolean') return fallback;
  const num = Number(val);
  return isNaN(num) ? fallback : num;
}

export function getArgBoolean(
  options: Record<string, string | boolean>,
  key: string,
  fallback = false
): boolean {
  const val = options[key];
  if (val === undefined) return fallback;
  if (typeof val === 'boolean') return val;
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0') return false;
  return Boolean(val);
}

export { parseCliArgs as parseArgs };
