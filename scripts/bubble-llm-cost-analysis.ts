/**
 * bubble-llm-cost-analysis.ts — Analisis biaya LLM per bubble chat (read-only).
 *
 * Pertanyaan yang dijawab: "1 bubble balasan bot = berapa LLM call & berapa rupiah?"
 *
 * Metode:
 *  - Ambil llm_audit_logs (per-call: task_type, tokens, cost_idr, conversation_id, created_at)
 *    dan messages OUTBOUND (bubble bot) N hari terakhir untuk SEMUA customer
 *    (real + sandbox, ditandai masing-masing).
 *  - Call DENGAN conversation_id: di-assign ke bubble OUTBOUND pertama di conversation yang
 *    sama dengan created_at >= call dan selisih <= 120 detik (akurat).
 *  - Call TANPA conversation_id (NLU_ROUTING/NLU_CLASSIFICATION/INTENT_DETECTION yang di-log
 *    lama tanpa atribusi): di-assign secara perkiraan (approximate) ke bubble berikutnya
 *    secara global dalam window 120 detik.
 *  - Agregasi per bubble: jumlah call, breakdown task_type, total token, total Rp.
 *
 * Output: laporan konsol + test-results/bubble-llm-cost-<timestamp>.md
 *
 * Usage:
 *   npx tsx scripts/bubble-llm-cost-analysis.ts            # 7 hari terakhir
 *   npx tsx scripts/bubble-llm-cost-analysis.ts --days=14  # rentang kustom
 */

/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

async function main() {
  await import('dotenv/config');

  const arg = process.argv.find((a) => a.startsWith('--days='));
  const days = arg ? parseInt(arg.split('=')[1], 10) || 7 : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const MATCH_WINDOW_MS = 120000; // 2 menit
  const runStamp = Date.now();

  const { prisma } = await import('../src/db/client');
  const { DEFAULT_TENANT_ID } = await import('../src/config/tenant');

  console.log(`[BUBBLE COST] Periode: ${days} hari terakhir (sejak ${since.toISOString()})`);

  const conversations = await prisma.conversation.findMany({
    where: {
      tenant_id: DEFAULT_TENANT_ID,
      updated_at: { gte: since },
    },
    select: { id: true, customer: { select: { phone: true, is_sandbox_test: true } } },
  });
  const realConvs = conversations.filter((c) => !c.customer?.is_sandbox_test);
  console.log(`[BUBBLE COST] Conversations: ${conversations.length} (real: ${realConvs.length}, sandbox: ${conversations.length - realConvs.length})`);

  const convIds = conversations.map((c) => c.id);
  if (convIds.length === 0) {
    console.log('Tidak ada conversation dalam rentang ini. Selesai.');
    return;
  }

  const [messages, logs] = await Promise.all([
    prisma.message.findMany({
      where: {
        tenant_id: DEFAULT_TENANT_ID,
        conversation_id: { in: convIds },
        direction: 'OUTBOUND',
        created_at: { gte: since },
      },
      select: {
        id: true,
        conversation_id: true,
        content: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
    }),
    prisma.llmAuditLog.findMany({
      where: {
        tenant_id: DEFAULT_TENANT_ID,
        created_at: { gte: since },
      },
      select: {
        id: true,
        conversation_id: true,
        task_type: true,
        model_name: true,
        provider: true,
        prompt_tokens: true,
        completion_tokens: true,
        cached_prompt_tokens: true,
        cost_idr: true,
        error_code: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
    }),
  ]);
  console.log(`[BUBBLE COST] Bubbles OUTBOUND: ${messages.length} | LLM calls: ${logs.length}`);

  const phoneByConv = new Map(conversations.map((c) => [c.id, c.customer?.phone || '?']));
  const sandboxByConv = new Map(conversations.map((c) => [c.id, !!c.customer?.is_sandbox_test]));

  const bubblesByConv = new Map<string, typeof messages>();
  for (const m of messages) {
    const arr = bubblesByConv.get(m.conversation_id!) || [];
    arr.push(m);
    bubblesByConv.set(m.conversation_id!, arr);
  }

  const logsByConv = new Map<string, typeof logs>();
  const logsNoConv: typeof logs = [];
  for (const l of logs) {
    if (l.conversation_id && bubblesByConv.has(l.conversation_id)) {
      const arr = logsByConv.get(l.conversation_id) || [];
      arr.push(l);
      logsByConv.set(l.conversation_id, arr);
    } else if (!l.conversation_id) {
      logsNoConv.push(l);
    }
  }

  interface BubbleStat {
    messageId: string;
    convId: string;
    phone: string;
    sandbox: boolean;
    contentExcerpt: string;
    time: Date;
    calls: typeof logs;
    callCount: number;
    costIdr: number;
    promptTokens: number;
    completionTokens: number;
    taskTypes: string[];
    attributedApprox: boolean;
  }

  const bubbleStats: BubbleStat[] = [];
  let unmatchedCalls = 0;

  // 1) Atribusi PER-CONVERSATION (call punya conversation_id): akurat.
  for (const [convId, bubbles] of bubblesByConv) {
    const calls = logsByConv.get(convId) || [];
    let callIdx = 0;
    for (const b of bubbles) {
      const bTime = new Date(b.created_at).getTime();
      const assigned: typeof logs = [];
      while (callIdx < calls.length) {
        const c = calls[callIdx];
        const delta = new Date(c.created_at).getTime() - bTime;
        if (delta > MATCH_WINDOW_MS) break; // call terlalu jauh SETELAH bubble ini → milik bubble berikutnya
        if (delta >= -MATCH_WINDOW_MS) {
          assigned.push(c);
          callIdx++;
        } else {
          callIdx++; // orphan lama (call tanpa bubble, mis. tidak menghasilkan balasan) → skip
        }
      }
      bubbleStats.push(makeStat(b, convId, assigned, false));
    }
    unmatchedCalls += calls.length - callIdx;
  }

  // 2) Atribusi GLOBAL APPROXIMATE (call tanpa conversation_id, mis. log lama
  //    NLU_ROUTING/NLU_CLASSIFICATION/INTENT_DETECTION): assign ke bubble berikutnya
  //    secara global dalam window 120 detik.
  if (logsNoConv.length > 0) {
    const allBubbles = [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    let bIdx = 0;
    let approxAssigned = 0;
    for (const c of logsNoConv) {
      const cTime = new Date(c.created_at).getTime();
      while (bIdx < allBubbles.length && new Date(allBubbles[bIdx].created_at).getTime() - cTime < 0) bIdx++;
      let matched = false;
      for (let j = bIdx; j < allBubbles.length; j++) {
        const b = allBubbles[j];
        const delta = new Date(b.created_at).getTime() - cTime;
        if (delta > MATCH_WINDOW_MS) break;
        const stat = bubbleStats.find((s) => s.messageId === b.id);
        if (stat) {
          stat.calls.push(c);
          stat.callCount++;
          stat.costIdr += c.cost_idr || 0;
          stat.promptTokens += c.prompt_tokens || 0;
          stat.completionTokens += c.completion_tokens || 0;
          if (!stat.taskTypes.includes(c.task_type)) stat.taskTypes.push(c.task_type);
          stat.attributedApprox = true;
          matched = true;
          approxAssigned++;
          break;
        }
      }
      if (!matched) unmatchedCalls++;
    }
    console.log(`[BUBBLE COST] Call tanpa conversation_id di-attach approximate: ${approxAssigned}/${logsNoConv.length}`);
  }

  function makeStat(b: (typeof messages)[number], convId: string, assigned: typeof logs, approx: boolean): BubbleStat {
    const cost = assigned.reduce((s, c) => s + (c.cost_idr || 0), 0);
    const promptT = assigned.reduce((s, c) => s + (c.prompt_tokens || 0), 0);
    const compT = assigned.reduce((s, c) => s + (c.completion_tokens || 0), 0);
    return {
      messageId: b.id,
      convId,
      phone: phoneByConv.get(convId) || '?',
      sandbox: sandboxByConv.get(convId) ?? true,
      contentExcerpt: (b.content || '').replace(/\s+/g, ' ').slice(0, 120),
      time: new Date(b.created_at),
      calls: assigned,
      callCount: assigned.length,
      costIdr: cost,
      promptTokens: promptT,
      completionTokens: compT,
      taskTypes: Array.from(new Set(assigned.map((c) => c.task_type))),
      attributedApprox: approx,
    };
  }

  const totalBubbles = bubbleStats.length;
  const totalCalls = bubbleStats.reduce((s, b) => s + b.callCount, 0);
  const totalCost = bubbleStats.reduce((s, b) => s + b.costIdr, 0);
  const totalPrompt = bubbleStats.reduce((s, b) => s + b.promptTokens, 0);
  const totalComp = bubbleStats.reduce((s, b) => s + b.completionTokens, 0);
  const avgCalls = totalBubbles ? totalCalls / totalBubbles : 0;
  const avgCost = totalBubbles ? totalCost / totalBubbles : 0;
  const approxCount = bubbleStats.reduce((s, b) => s + b.calls.filter((c) => !c.conversation_id).length, 0);

  const realBubbles = bubbleStats.filter((b) => !b.sandbox);
  const realCalls = realBubbles.reduce((s, b) => s + b.callCount, 0);
  const realCost = realBubbles.reduce((s, b) => s + b.costIdr, 0);
  const avgRealCalls = realBubbles.length ? realCalls / realBubbles.length : 0;
  const avgRealCost = realBubbles.length ? realCost / realBubbles.length : 0;

  const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;
  const fmt = (n: number) => n.toLocaleString('id-ID');

  const lines: string[] = [];
  const push = (s = '') => lines.push(s);

  push(`# Laporan Biaya LLM per Bubble Chat`);
  push();
  push(`- **Periode**: ${days} hari terakhir (sejak ${since.toISOString()})`);
  push(`- **Dibuat**: ${new Date(runStamp).toISOString()}`);
  push(`- **Cakupan**: SEMUA customer (real + sandbox/test), tenant \`${DEFAULT_TENANT_ID}\``);
  push(`- **Window matching**: LLM call di-assign ke bubble pertama dalam 120 detik setelah call.`);
  push(`- **Catatan**: ${fmt(approxCount)} call (${logsNoConv.length} tanpa conversation_id, umumnya log NLU_ROUTING/NLU_CLASSIFICATION/INTENT_DETECTION sebelum fix audit) di-attach dengan perkiraan global.`);
  push();
  push(`## Ringkasan`);
  push();
  push(`| Metrik | Nilai |`);
  push(`|---|---|`);
  push(`| Bubble balasan bot | ${fmt(totalBubbles)} |`);
  push(`| Total LLM call | ${fmt(totalCalls)} |`);
  push(`| Rata-rata LLM call / bubble | ${avgCalls.toFixed(2)} |`);
  push(`| Total biaya (cost_idr) | ${fmtRp(totalCost)} |`);
  push(`| Rata-rata biaya / bubble | ${fmtRp(avgCost)} |`);
  push(`| Total token prompt | ${fmt(totalPrompt)} |`);
  push(`| Total token completion | ${fmt(totalComp)} |`);
  push(`| LLM call tanpa bubble (tak ter-attach) | ${fmt(unmatchedCalls)} |`);
  push();
  push(`### Khusus customer REAL (non-sandbox)`);
  push();
  push(`| Metrik | Nilai |`);
  push(`|---|---|`);
  push(`| Bubble balasan bot | ${fmt(realBubbles.length)} |`);
  push(`| Total LLM call | ${fmt(realCalls)} |`);
  push(`| Rata-rata LLM call / bubble | ${avgRealCalls.toFixed(2)} |`);
  push(`| Total biaya (cost_idr) | ${fmtRp(realCost)} |`);
  push(`| Rata-rata biaya / bubble | ${fmtRp(avgRealCost)} |`);
  push();

  const dist: Record<number, number> = {};
  for (const b of bubbleStats) {
    dist[b.callCount] = (dist[b.callCount] || 0) + 1;
  }
  push(`## Distribusi jumlah LLM call per bubble`);
  push();
  push(`| Jumlah call | Jumlah bubble | Persentase |`);
  push(`|---|---|---|`);
  for (let i = 0; i <= Math.max(...Object.keys(dist).map(Number)); i++) {
    if (dist[i]) {
      push(`| ${i} | ${fmt(dist[i])} | ${((dist[i] / totalBubbles) * 100).toFixed(1)}% |`);
    }
  }
  push();

  const byTask: Record<string, { calls: number; cost: number; prompt: number; comp: number }> = {};
  for (const b of bubbleStats) {
    for (const c of b.calls) {
      const t = c.task_type || 'UNKNOWN';
      byTask[t] = byTask[t] || { calls: 0, cost: 0, prompt: 0, comp: 0 };
      byTask[t].calls++;
      byTask[t].cost += c.cost_idr || 0;
      byTask[t].prompt += c.prompt_tokens || 0;
      byTask[t].comp += c.completion_tokens || 0;
    }
  }
  push(`## Breakdown per task_type LLM`);
  push();
  push(`| Task type | Call | Cost | Prompt tok | Completion tok |`);
  push(`|---|---|---|---|---|`);
  for (const [t, v] of Object.entries(byTask).sort((a, b) => b[1].cost - a[1].cost)) {
    push(`| ${t} | ${fmt(v.calls)} | ${fmtRp(v.cost)} | ${fmt(v.prompt)} | ${fmt(v.comp)} |`);
  }
  push();

  const sorted = [...bubbleStats].sort((a, b) => b.costIdr - a.costIdr);
  push(`## 10 Bubble termahal`);
  push();
  push(`| # | Phone | Tipe | Waktu | Call | Cost | Task | Isi (cuplikan) |`);
  push(`|---|---|---|---|---|---|---|---|`);
  sorted.slice(0, 10).forEach((b, i) => {
    push(`| ${i + 1} | +${b.phone} | ${b.sandbox ? 'sandbox' : 'REAL'} | ${b.time.toISOString()} | ${b.callCount} | ${fmtRp(b.costIdr)} | ${b.taskTypes.join(',')} | ${b.contentExcerpt.replace(/\|/g, '\\|')} |`);
  });
  push();

  const cheapest = [...bubbleStats].sort((a, b) => a.costIdr - b.costIdr);
  push(`## 5 Bubble termurah`);
  push();
  push(`| # | Phone | Tipe | Waktu | Call | Cost | Task | Isi (cuplikan) |`);
  push(`|---|---|---|---|---|---|---|---|`);
  cheapest.slice(0, 5).forEach((b, i) => {
    push(`| ${i + 1} | +${b.phone} | ${b.sandbox ? 'sandbox' : 'REAL'} | ${b.time.toISOString()} | ${b.callCount} | ${fmtRp(b.costIdr)} | ${b.taskTypes.join(',')} | ${b.contentExcerpt.replace(/\|/g, '\\|')} |`);
  });

  const mdPath = path.join(process.cwd(), 'test-results', `bubble-llm-cost-${runStamp}.md`);
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, lines.join('\n') + '\n', 'utf-8');

  console.log('\n================ RINGKASAN ================');
  console.log(`Bubble: ${fmt(totalBubbles)} | LLM call: ${fmt(totalCalls)} | Rata-rata: ${avgCalls.toFixed(2)} call/bubble`);
  console.log(`Total biaya: ${fmtRp(totalCost)} | Rata-rata: ${fmtRp(avgCost)}/bubble`);
  console.log(`REAL only: ${fmt(realBubbles.length)} bubble | ${fmt(realCalls)} call | ${fmtRp(realCost)} | rata-rata ${avgRealCalls.toFixed(2)} call/${fmtRp(avgRealCost)}/bubble`);
  console.log(`Tak ter-attach: ${fmt(unmatchedCalls)} call | Laporan: ${mdPath}`);
  console.log('\n-- 10 bubble termahal --');
  sorted.slice(0, 10).forEach((b, i) => {
    console.log(`${i + 1}. [${b.sandbox ? 'sandbox' : 'REAL'}] +${b.phone} | ${b.callCount} call | ${fmtRp(b.costIdr)} | [${b.taskTypes.join(',')}] ${b.contentExcerpt}`);
  });
  console.log('\n-- Breakdown task_type --');
  for (const [t, v] of Object.entries(byTask).sort((a, b) => b[1].cost - a[1].cost)) {
    console.log(`  ${t.padEnd(14)} ${String(v.calls).padStart(5)} call | ${fmtRp(v.cost).padStart(12)}`);
  }
}

main().catch((err) => {
  console.error('[BUBBLE COST] Gagal menjalankan analisis:', err?.message || err);
  process.exit(1);
});
