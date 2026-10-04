import fs from 'fs';
import path from 'path';

/**
 * Guardrail Radar (Fase 5 plan) — merangkum kejadian "perbaikan paksa" guardrail
 * dari log JSON (pino) agar anomali terlihat sebelum customer mengeluh.
 *
 * Pemakaian:
 *   node dist/cli/guardrail-radar.js                 → log app terbaru di ./logs
 *   node dist/cli/guardrail-radar.js path/ke/log     → file tertentu
 *   cat app.log | node dist/cli/guardrail-radar.js - → dari stdin
 *
 * Logika murni `summarizeGuardrailEvents` dipisah agar unit-testable.
 */

const GUARDRAIL_EVENT_RE = /(AMNESIA|REPROMPT|RECOVERY|CONTRACT|HOLISTIC_REVIEW|SOLICITATION|UNRESOLVED)/;

export interface GuardrailRadarResult {
  counts: Record<string, number>;
  samples: Record<string, string[]>;
  total: number;
}

/** Ekstrak nama event dari satu baris log (JSON pino, fallback regex). */
function extractEvent(line: string): string | null {
  const trimmed = (line || '').trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj.event === 'string') return obj.event;
  } catch {
    // fallback: log non-JSON
  }
  const m = /"event"\s*:\s*"([A-Z0-9_]+)"/.exec(trimmed);
  return m ? m[1] : null;
}

/** Ringkas event guardrail dari kumpulan baris log (murni, deterministik). */
export function summarizeGuardrailEvents(lines: string[], maxSamplesPerEvent = 3): GuardrailRadarResult {
  const counts: Record<string, number> = {};
  const samples: Record<string, string[]> = {};
  let total = 0;
  for (const raw of lines || []) {
    const ev = extractEvent(raw);
    if (!ev || !GUARDRAIL_EVENT_RE.test(ev)) continue;
    counts[ev] = (counts[ev] || 0) + 1;
    total++;
    const arr = samples[ev] || (samples[ev] = []);
    if (arr.length < maxSamplesPerEvent) arr.push(raw.trim().slice(0, 240));
  }
  return { counts, samples, total };
}

function readNewestAppLog(dir: string): string {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => /^app-.*\.log$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (files.length === 0) return '';
    return fs.readFileSync(path.join(dir, files[0].f), 'utf8');
  } catch {
    return '';
  }
}

function main(): void {
  const arg = process.argv[2];
  let content = '';
  if (!arg) {
    content = readNewestAppLog(path.join(process.cwd(), 'logs'));
    if (!content) {
      console.error('[RADAR] Tidak ada log di ./logs. Berikan path file log sebagai argumen.');
      process.exit(1);
    }
  } else if (arg === '-') {
    content = fs.readFileSync(0, 'utf8');
  } else {
    content = fs.readFileSync(arg, 'utf8');
  }

  const lines = content.split(/\r?\n/);
  const { counts, samples, total } = summarizeGuardrailEvents(lines);
  console.log(`\n=== GUARDRAIL RADAR (total ${total} kejadian) ===`);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    console.log('(bersih — tidak ada perbaikan-paksa guardrail pada log ini)');
  }
  for (const [ev, n] of entries) {
    console.log(`\n• ${ev}: ${n}`);
    for (const s of samples[ev] || []) console.log(`    ${s}`);
  }
  console.log('');
}

if (require.main === module) {
  main();
}
