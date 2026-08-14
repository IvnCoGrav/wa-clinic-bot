/**
 * test-50-same-opener.ts — 50 sesi percakapan TERPISAH (fresh customer + fresh
 * conversation + fresh state machine per sesi) yang masing-masing dibuka dengan
 * SATU pesan pembuka yang SAMA. Dipakai untuk mengevaluasi variasi/konsistensi
 * balasan yang benar-benar DITERIMA customer dalam mode LLM asli (produksi).
 *
 * - Pura-pura testing: tidak mengubah file apa pun di src/. Memakai DI yang sama
 *   dengan scripts/run-test-plan.ts (RecordingWahaClient + TypingService + machine).
 * - Setiap sesi: phone unik -> customer baru (is_sandbox_test=true, wajib per skill
 *   qa-test-labeling) -> conversation INITIAL baru -> kirim 1 pesan -> capture semua
 *   bubble yang DITERIMA customer.
 * - Output: test-results/50-same-opener-<timestamp>.json (mentah) + .md (laporan).
 *
 * Usage:
 *   npx tsx scripts/test-50-same-opener.ts               # 50 sesi, LLM asli (.env)
 *   npx tsx scripts/test-50-same-opener.ts --max=10       # hanya 10 sesi (smoke)
 *   npx tsx scripts/test-50-same-opener.ts --offline      # fallback rule-based (no network)
 */

/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

// ============ 1. ENV SETUP (SEBELUM import modul src) ============
process.env.WAHA_MOCK = 'true';
process.env.BURST_COALESCE_MS = '0';

const OPENER = 'Selamat sore. Saya ingin tanya untuk pijat bayi min. di usia brp ya?';

const LOC_QUESTION_RE = /(alamat|lokasi|rumah|area|rw\b|kelurahan|kecamatan|ongkir|jarak|pin)/i;

async function main() {
  const args = process.argv.slice(2);
  const useLLM = !args.includes('--offline');
  const maxVal = (() => {
    const eq = args.find((a) => a.startsWith('--max='));
    if (eq) return parseInt(eq.split('=')[1], 10);
    const idx = args.indexOf('--max');
    return idx >= 0 ? parseInt(args[idx + 1], 10) : 50;
  })();
  const TOTAL = Math.min(Math.max(maxVal || 50, 1), 50);
  const runStamp = Date.now();

  // Muat .env (jangan override WAHA_MOCK/BURST_COALESCE_MS yang sudah diset).
  await import('dotenv/config');

  if (!useLLM) {
    // Mode fallback deterministik (tanpa network).
    process.env.LLM_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    process.env.AI_MODEL_ROUTER = '';
  }

  const {
    ConversationStateMachine,
  } = await import('../src/state-machine/machine');
  const { TypingService } = await import('../src/services/typing.service');
  const { customerService } = await import('../src/services/customer.service');
  const { conversationService } = await import('../src/services/conversation.service');
  const { DEFAULT_TENANT_ID } = await import('../src/config/tenant');
  const { RecordingWahaClient } = await import('./lib/recording-client');
  const { prisma } = await import('../src/db/client');

  const recorder = new RecordingWahaClient();
  const typingSvc = new TypingService(recorder, 1000);
  const machine = new ConversationStateMachine(typingSvc);

  const phoneFor = (i: number): string =>
    `628${String(runStamp).slice(-6)}${String(i).padStart(3, '0')}`;

  const markSandboxTest = async (customer: any): Promise<void> => {
    try {
      if (!customer.is_sandbox_test) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { is_sandbox_test: true },
        });
      }
    } catch {
      // best-effort — jangan menggagalkan bila DB offline
    }
  };

  const results: any[] = [];

  console.log(`\n=== 50 SESI BARU — PESAN PEMBUKA SAMA (${useLLM ? 'MODE: LLM ASLI' : 'MODE: OFFLINE/FALLBACK'}) ===`);
  console.log(`Pesan pembuka: "${OPENER}"\n`);

  for (let i = 1; i <= TOTAL; i++) {
    const start = Date.now();
    const phone = phoneFor(i);
    const chatId = `${phone}@c.us`;
    let customer: any;
    let conversation: any;
    let exception: string | null = null;
    let result: any = null;

    try {
      customer = await customerService.getOrCreateCustomer(phone, 'QA Tester', DEFAULT_TENANT_ID);
      await markSandboxTest(customer);
      conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

      recorder.reset();
      const incoming = {
        id: `op${runStamp}.${i}.txt`,
        chatId,
        from: phone,
        type: 'text',
        text: { body: OPENER },
        timestamp: String(Math.floor(Date.now() / 1000)),
      };
      result = await machine.processMessage({
        tenantId: DEFAULT_TENANT_ID,
        customer,
        conversation,
        incomingMessage: incoming,
      });
    } catch (err: any) {
      exception = err?.message || String(err);
    }

    const bubbles = recorder.sentTexts.length > 0
      ? [...recorder.sentTexts]
      : result?.shouldSendReply && result.replyText
        ? [result.replyText]
        : [];
    const finalState = result?.nextState ?? conversation?.current_state ?? 'UNKNOWN';
    const isHuman = !!result?.isHumanHandling;
    const hasPricelistImage = recorder.sentMessages.some((m: any) => m.text.includes('[IMAGE]'));

    const entry = {
      no: i,
      phone,
      mode: useLLM ? 'llm' : 'fallback',
      opener: OPENER,
      bubbles,
      bubbleCount: bubbles.length,
      replyText: bubbles.join('\n\n'),
      finalState,
      isHumanHandling: isHuman,
      hasPricelistImage,
      asksLocation: bubbles.some((b: string) => LOC_QUESTION_RE.test(b)),
      exception,
      durationMs: Date.now() - start,
      ranAt: new Date().toISOString(),
    };
    results.push(entry);

    console.log(`${'─'.repeat(58)}`);
    console.log(`TEST #${String(i).padStart(2, ' ')}  phone=${phone}  state→${finalState}  (${entry.durationMs}ms)${isHuman ? '  [HUMAN-HANDLING]' : ''}${exception ? '  [ERROR]' : ''}`);
    if (exception) console.log(`  ❌ ERROR: ${exception}`);
    if (bubbles.length === 0) {
      console.log('  (tidak ada balasan yang terkirim ke customer)');
    } else {
      bubbles.forEach((b: string, bi: number) => {
        const label = entry.bubbleCount === 1 ? '  ► Balasan' : `  ► Bubble ${bi + 1}/${entry.bubbleCount}`;
        console.log(`${label}:`);
        console.log(b.split('\n').map((l: string) => `    ${l}`).join('\n'));
      });
    }
    if (hasPricelistImage) console.log('  [Pricelist image dikirim]');
  }

  // ============ RINGKASAN AGREGAT ============
  const errCount = results.filter((r) => r.exception).length;
  const silentCount = results.filter((r) => r.bubbleCount === 0 && !r.exception).length;
  const humanCount = results.filter((r) => r.isHumanHandling).length;
  const locQCount = results.filter((r) => r.asksLocation).length;
  const imgCount = results.filter((r) => r.hasPricelistImage).length;
  const avgBubbles = results.length ? (results.reduce((a, r) => a + r.bubbleCount, 0) / results.length).toFixed(1) : '0';
  const avgLen = results.length
    ? Math.round(results.reduce((a, r) => a + r.replyText.length, 0) / results.length)
    : 0;
  const distinctFirst = new Set(results.map((r) => (r.bubbles[0] || '').slice(0, 60)).filter(Boolean)).size;
  const durTotal = results.reduce((a, r) => a + r.durationMs, 0);

  console.log(`\n${'═'.repeat(58)}`);
  console.log('=== RINGKASAN 50 SESI ===');
  console.log(`Total sesi dijalankan     : ${results.length}`);
  console.log(`Error/exception           : ${errCount}`);
  console.log(`Silent (0 balasan)        : ${silentCount}`);
  console.log(`Tereskalasi ke human      : ${humanCount}`);
  console.log(`Berisi pertanyaan lokasi  : ${locQCount} (${Math.round((locQCount / results.length) * 100)}%)`);
  console.log(`Kirim pricelist image     : ${imgCount}`);
  console.log(`Rata-rata bubble/sesi     : ${avgBubbles}`);
  console.log(`Rata-rata panjang balasan : ${avgLen} karakter`);
  console.log(`Variasi balasan pertama   : ~${distinctFirst} pola unik (dari ${results.length} sesi)`);
  console.log(`Total waktu eksekusi      : ${(durTotal / 1000).toFixed(1)} detik`);
  console.log('');

  // N-gram / frasa yang terulang (indikasi template kaku) — 5 frasa 30-char teratas.
  const freq = new Map<string, number>();
  for (const r of results) {
    for (const b of r.bubbles) {
      const words = b.replace(/\s+/g, ' ').trim();
      for (let k = 30; k <= Math.min(words.length, 60); k += 5) {
        const frag = words.slice(0, k);
        if (!/\s/.test(frag) && frag.length < 40) continue;
        freq.set(frag, (freq.get(frag) || 0) + 1);
      }
    }
  }
  const topFrags = Array.from(freq.entries()).filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (topFrags.length) {
    console.log('Frasa pembuka yang paling sering terulang persis (indikasi template kaku):');
    for (const [frag, c] of topFrags) console.log(`  [${c}x] "${frag}..."`);
    console.log('');
  }

  // ============ TULIS REPORT ============
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const jsonFile = path.join(__dirname, '..', 'test-results', `50-same-opener-${stamp}.json`);
  const mdFile = path.join(__dirname, '..', 'test-results', `50-same-opener-${stamp}.md`);
  fs.writeFileSync(jsonFile, JSON.stringify(results, null, 2), 'utf8');

  const md: string[] = [];
  md.push('# Laporan — 50 Sesi Baru, Pesan Pembuka Sama', '');
  md.push(`> Dihasilkan otomatis oleh \`scripts/test-50-same-opener.ts\` (mode: **${useLLM ? 'LLM asli' : 'fallback rule-based'}**).`, '');
  md.push(`> Pesan pembuka: \`${OPENER}\``, '');
  md.push('', '## Ringkasan', '', '| Metrik | Nilai |', '|---|---|');
  md.push(`| Total sesi | ${results.length} |`);
  md.push(`| Error/exception | ${errCount} |`);
  md.push(`| Silent (0 balasan) | ${silentCount} |`);
  md.push(`| Tereskalasi ke human | ${humanCount} |`);
  md.push(`| Berisi pertanyaan lokasi | ${locQCount} |`);
  md.push(`| Kirim pricelist image | ${imgCount} |`);
  md.push(`| Rata-rata bubble/sesi | ${avgBubbles} |`);
  md.push(`| Rata-rata panjang balasan | ${avgLen} karakter |`);
  md.push(`| Variasi balasan pertama | ~${distinctFirst} pola unik |`);
  md.push('');
  if (topFrags.length) {
    md.push('## Frasa yang terulang persis (indikasi template)', '');
    for (const [frag, c] of topFrags) md.push(`- **[${c}x]** \`${frag}...\``);
    md.push('');
  }
  md.push('## Transkrip per sesi (balasan yang diterima customer)', '');
  for (const r of results) {
    md.push(`### TEST #${r.no} — ${r.phone} (state→${r.finalState}, ${r.durationMs}ms)`, '');
    md.push(`- **Pesan customer:** ${r.opener}`);
    md.push(`- **Mode:** ${r.mode}${r.isHumanHandling ? ' · **HUMAN-HANDLING**' : ''}${r.hasPricelistImage ? ' · pricelist image' : ''}`);
    if (r.exception) md.push(`- ❌ **Error:** ${r.exception}`);
    md.push('');
    if (r.bubbles.length) {
      r.bubbles.forEach((b: string, bi: number) => {
        if (r.bubbleCount === 1) md.push(`**Balasan:**`);
        else md.push(`**Bubble ${bi + 1}/${r.bubbleCount}:**`);
        md.push('', '> ' + b.split('\n').join('\n> '), '');
      });
    } else {
      md.push('_Tidak ada balasan yang terkirim ke customer._', '');
    }
    md.push('---', '');
  }

  fs.writeFileSync(mdFile, md.join('\n'), 'utf8');
  console.log(`Report: ${mdFile}`);
  console.log(`JSON  : ${jsonFile}`);

  process.exit(0); // Paksa keluar — modul (queue/live-chat hub) punya timer residual.
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});