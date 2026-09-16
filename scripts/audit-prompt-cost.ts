/**
 * audit-prompt-cost.ts — Audit biaya & komposisi prompt LLM (read-only).
 *
 * Menjawab: "Berapa besar prompt per balasan, dan berapa yang statis vs dinamis?"
 *
 * Metode:
 *  - Baca logs/llm-YYYY-MM-DD.jsonl N hari terakhir (offline, tanpa DB).
 *  - Per flowType: hitung jumlah call, rata-rata panjang systemPrompt, token, biaya, latensi.
 *  - Pisahkan systemPrompt menjadi HEAD statis (sebelum marker [STATUS DATA CUSTOMER)
 *    dan TAIL dinamis (sejak marker itu). Laporkan rasio.
 *  - Verifikasi apakah head statis identik antar-turn (bukti kelayakan prompt caching).
 *
 * Output: laporan konsol + test-results/prompt-cost-<timestamp>.md
 *
 * Usage:
 *   npx tsx scripts/audit-prompt-cost.ts            # 7 hari terakhir
 *   npx tsx scripts/audit-prompt-cost.ts --days=14  # rentang kustom
 */

/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

interface LlmLogRecord {
  timestamp?: string;
  flowType?: string;
  modelUsed?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costIdr?: number;
  durationMs?: number;
  status?: string;
  promptPayload?: { systemPrompt?: string };
}

/** Panjang prefix byte-identik terpanjang di antara seluruh prompt sebuah flow. */
function longestCommonPrefix(strings: string[]): number {
  if (strings.length === 0) return 0;
  if (strings.length === 1) return strings[0].length;
  let hi = strings[0].length;
  for (let i = 1; i < strings.length; i++) hi = Math.min(hi, strings[i].length);
  let lo = 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const ref = strings[0].slice(0, mid);
    if (strings.every((s) => s.slice(0, mid) === ref)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function listLogFiles(days: number): string[] {
  const dir = path.resolve(process.cwd(), 'logs');
  if (!fs.existsSync(dir)) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return fs
    .readdirSync(dir)
    .filter((f) => /^llm-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .filter((f) => {
      const m = f.match(/llm-(\d{4})-(\d{2})-(\d{2})\.jsonl/);
      if (!m) return false;
      const ts = new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:59Z`).getTime();
      return ts >= cutoff;
    })
    .map((f) => path.join(dir, f));
}

function readRecords(files: string[]): LlmLogRecord[] {
  const out: LlmLogRecord[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // baris rusak / terpotong — lewati
      }
    }
  }
  return out;
}

interface FlowStat {
  flowType: string;
  calls: number;
  avgPromptChars: number;
  /** Panjang prefix byte-identik antar-turn — inilah yang layak di-cache provider. */
  cacheablePrefixChars: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  totalCostIdr: number;
  avgDurationMs: number;
  statuses: Record<string, number>;
}

function analyze(records: LlmLogRecord[]): FlowStat[] {
  const byFlow = new Map<string, LlmLogRecord[]>();
  for (const r of records) {
    const key = r.flowType || 'UNKNOWN';
    if (!byFlow.has(key)) byFlow.set(key, []);
    byFlow.get(key)!.push(r);
  }

  const stats: FlowStat[] = [];
  for (const [flowType, recs] of byFlow.entries()) {
    const prompts = recs
      .map((r) => r.promptPayload?.systemPrompt)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
    const promptLengths = prompts.map((s) => s.length);

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const durationVals = recs.map((r) => Number(r.durationMs) || 0).filter((n) => n > 0);
    const statuses: Record<string, number> = {};
    for (const r of recs) {
      const s = r.status || 'UNKNOWN';
      statuses[s] = (statuses[s] || 0) + 1;
    }

    stats.push({
      flowType,
      calls: recs.length,
      avgPromptChars: Math.round(avg(promptLengths)),
      cacheablePrefixChars: prompts.length > 1 ? longestCommonPrefix(prompts) : 0,
      avgPromptTokens: Math.round(avg(recs.map((r) => Number(r.promptTokens) || 0))),
      avgCompletionTokens: Math.round(avg(recs.map((r) => Number(r.completionTokens) || 0))),
      totalCostIdr: recs.reduce((a, r) => a + (Number(r.costIdr) || 0), 0),
      avgDurationMs: Math.round(avg(durationVals)),
      statuses,
    });
  }

  return stats.sort((a, b) => b.calls - a.calls);
}

async function main() {
  await import('dotenv/config');

  const arg = process.argv.find((a) => a.startsWith('--days='));
  const days = arg ? parseInt(arg.split('=')[1], 10) || 7 : 7;

  console.log(`[PROMPT COST] Periode: ${days} hari terakhir`);

  const files = listLogFiles(days);
  if (files.length === 0) {
    console.log('Tidak ada file logs/llm-*.jsonl dalam rentang ini. Selesai.');
    return;
  }
  console.log(`[PROMPT COST] File: ${files.map((f) => path.basename(f)).join(', ')}`);

  const records = readRecords(files);
  console.log(`[PROMPT COST] Total record LLM: ${records.length}`);

  const stats = analyze(records);
  if (stats.length === 0) {
    console.log('Tidak ada record dengan flowType. Selesai.');
    return;
  }

  // Laporan konsol
  console.log('\n=== RINGKASAN PER FLOW ===');
  for (const s of stats) {
    console.log(
      `\n[${s.flowType}] calls=${s.calls} cost=Rp ${s.totalCostIdr.toFixed(2)} avgLatency=${s.avgDurationMs}ms`
    );
    console.log(
      `  prompt: avg ${s.avgPromptChars} char | prefix byte-stabil ${s.cacheablePrefixChars} char (kandidat prompt caching)`
    );
    console.log(`  tokens: prompt ${s.avgPromptTokens} / completion ${s.avgCompletionTokens}`);
    console.log(`  status: ${JSON.stringify(s.statuses)}`);
  }

  // Laporan markdown
  const outDir = path.resolve(process.cwd(), 'test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `prompt-cost-${Date.now()}.md`);
  const lines: string[] = [
    `# Audit Prompt Cost — ${days} hari terakhir`,
    '',
    `Dibuat: ${new Date().toISOString()}`,
    `Total record: ${records.length}`,
    '',
    '| Flow | Calls | Avg Prompt Char | Prefix Byte-Stabil | Prompt Tokens | Completion Tokens | Total Rp | Avg Latency |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const s of stats) {
    lines.push(
      `| ${s.flowType} | ${s.calls} | ${s.avgPromptChars} | ${s.cacheablePrefixChars} | ${s.avgPromptTokens} | ${s.avgCompletionTokens} | ${s.totalCostIdr.toFixed(2)} | ${s.avgDurationMs}ms |`
    );
  }
  fs.writeFileSync(outFile, lines.join('\n'), 'utf-8');
  console.log(`\n[PROMPT COST] Laporan disimpan: ${outFile}`);
}

main().catch((err) => {
  console.error('[PROMPT COST] Gagal:', err?.message || err);
  process.exit(1);
});
