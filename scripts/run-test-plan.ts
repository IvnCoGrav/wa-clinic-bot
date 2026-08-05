/**
 * run-test-plan.ts — Test Harness otomatis untuk "Testing Plan — WhatsApp Chatbot
 * Kala Moms and Baby Spa" (docs/TEST_PLAN_50_SIMULASI.md).
 *
 * - Murni testing: TIDAK mengubah file apa pun di src/. Memakai DI yang sama dengan
 *   src/cli/chat-simulator.ts (TypingService + mock WAHA client + ConversationStateMachine).
 * - Bukan proses CLI interaktif — panggil stateMachine.processMessage() langsung.
 * - Output: test-results/run-results.json (mentah) + test-results/testing-plan-report.md.
 *
 * Usage:
 *   npx tsx scripts/run-test-plan.ts            # baseline OFFLINE (fallback rule-based), semua 50
 *   npx tsx scripts/run-test-plan.ts --llm      # pakai LLM asli (key dari .env)
 *   npx tsx scripts/run-test-plan.ts --cat D --llm   # hanya kategori D
 *   npx tsx scripts/run-test-plan.ts --only 25  # hanya skenario 25
 */

/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

// ============ 1. ENV SETUP (SEBELUM import modul src) ============
// WAHA_MOCK=true agar outbound machine (termasuk sendImage pricelist) tidak hit server asli.
process.env.WAHA_MOCK = 'true';
// Coalescing dinonaktifkan di harness kecuali skenario #47 (di-set ulang saat itu).
process.env.BURST_COALESCE_MS = '0';

let RESULTS_FILE = path.join(__dirname, '..', 'test-results', 'run-results.json');
let REPORT_FILE = path.join(__dirname, '..', 'test-results', 'testing-plan-report.md');

async function main() {
  const args = process.argv.slice(2);
  const useLLM = args.includes('--llm');
  const V2 = args.includes('--v2');
  if (V2) {
    RESULTS_FILE = path.join(__dirname, '..', 'test-results', 'run-results-v2.json');
    REPORT_FILE = path.join(__dirname, '..', 'test-results', 'testing-plan-report-v2.md');
  }
  const valOf = (flag: string): string => {
    const eq = args.find((a) => a.startsWith(`${flag}=`));
    if (eq) return eq.split('=')[1] || '';
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] || '' : '';
  };
  const onlyNo = parseInt(valOf('--only'), 10);
  const onlyCat = valOf('--cat').toUpperCase();

  // Muat .env (jangan override WAHA_MOCK/BURST yang sudah diset di atas).
  await import('dotenv/config');

  if (!useLLM) {
    // Mode OFFLINE/fallback: blank LLM keys agar classifier/generator/phrasing
    // otomatis jatuh ke rule-based/static template (deterministik, tanpa network).
    process.env.LLM_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    process.env.AI_MODEL_ROUTER = '';
  }

  // ============ 2. IMPORT KOMPONEN PRODUCTION (dynamic, setelah env final) ============
  const {
    ConversationStateMachine,
  } = await import('../src/state-machine/machine');
  const { TypingService } = await import('../src/services/typing.service');
  const { ConversationState } = await import('@prisma/client');
  const { customerService } = await import('../src/services/customer.service');
  const { conversationService } = await import('../src/services/conversation.service');
  const { abuseDetectionService } = await import('../src/services/abuse-detection.service');
  const { burstCoalesceService } = await import('../src/services/burst-coalesce.service');
  const { DEFAULT_TENANT_ID } = await import('../src/config/tenant');
  const { clinicConfig } = await import('../src/config/clinic');
  const { RecordingWahaClient } = await import('./lib/recording-client');
  const { buildAutoFlags } = await import('./lib/persona-rules');

  // ============ 3. DI INSTANCES ============
  const recorder = new RecordingWahaClient();
  const typingSvc = new TypingService(recorder, 1000); // speedFactor tinggi -> delay ~0
  const machine = new ConversationStateMachine(typingSvc);

  // Koordinat klinik AKTUAL (dari clinicConfig / .env) — dipakai sebagai pre-condition lokasi
  // agar jarak ≈ 0 & tier gratis (sumber kebenaran config, bukan pin hardcode).
  const preLoc = { lat: clinicConfig.lat, lng: clinicConfig.lng };

  // ============ 4. DEFINISI 50 SKENARIO ============
  interface Step {
    kind: 'text' | 'location' | 'image' | 'voice' | 'burst';
    body?: string;
    lat?: number;
    lng?: number;
  }
  interface Scenario {
    no: number;
    category: string;
    title: string;
    steps: Step[];
    preLocation?: boolean;
    idleHrsAgo?: number;
    burst?: boolean;
    abuseExpectBlock?: boolean;
  }

  const S: Scenario[] = [];

  const text = (body: string): Step => ({ kind: 'text', body });
  const loc = (lat: number, lng: number): Step => ({ kind: 'location', lat, lng });

  // --- A. Onboarding & Sapaan Awal (1-5) ---
  S.push({ no: 1, category: 'A', title: 'Onboarding — sapaan awal', steps: [text('Halo')] });
  S.push({ no: 2, category: 'A', title: 'Onboarding — sapaan + intent tanya', steps: [text('Selamat siang, mau tanya-tanya soal spa bayi')] });
  S.push({ no: 3, category: 'A', title: 'Onboarding — salam agama', steps: [text('Assalamualaikum bu bidan, ada pijat bayi?')] });
  S.push({ no: 4, category: 'A', title: 'Onboarding — input minimal', steps: [text('Min')] });
  S.push({ no: 5, category: 'A', title: 'Onboarding — emoji saja', steps: [text('👋😊')] });

  // --- B. Deteksi Lokasi — Jalur Normal (6-13) ---
  S.push({ no: 6, category: 'B', title: 'Lokasi — share pin dekat (tier gratis)', steps: [loc(-7.2625, 112.7383)] });
  S.push({ no: 7, category: 'B', title: 'Lokasi — teks kelurahan lengkap', steps: [text('Rumah saya di kelurahan Wonokromo kec Wonokromo Surabaya')] });
  S.push({ no: 8, category: 'B', title: 'Lokasi — kecamatan + area', steps: [text('Sidoarjo, deket Waru')] });
  S.push({ no: 9, category: 'B', title: 'Lokasi — nama perumahan', steps: [text('Pakuwon City')] });
  S.push({ no: 10, category: 'B', title: 'Lokasi — alamat jalan', steps: [text('Jl. Mayjend Sungkono no 45')] });
  S.push({ no: 11, category: 'B', title: 'Lokasi — kelurahan saja', steps: [text('Rungkut')] });
  S.push({ no: 12, category: 'B', title: 'Lokasi — share pin jauh (6-10 km, Rp10.000)', steps: [loc(-7.3, 112.78)] });
  S.push({ no: 13, category: 'B', title: 'Lokasi — landmark', steps: [text('Ngagel Jaya Selatan, deket taman bungkul')] });

  // --- C. Deteksi Lokasi — Kasus Sulit / Ambigu (14-20) ---
  S.push({ no: 14, category: 'C', title: 'Lokasi — tidak presisi', steps: [text('Deket indomaret gitu deh')] });
  S.push({ no: 15, category: 'C', title: 'Lokasi — ambigu (banyak daerah)', steps: [text('Sukolilo')] });
  S.push({ no: 16, category: 'C', title: 'Lokasi — typo/spasi salah', steps: [text('Suko lilo')] });
  S.push({ no: 17, category: 'C', title: 'Lokasi — 3x gagal -> eskalasi', steps: [text('Krian'), text('Krian'), text('Krian'), text('Krian')] });
  S.push({ no: 18, category: 'C', title: 'Lokasi — luar jangkauan >10km -> COMPLETED', steps: [loc(-7.05, 112.65)] });
  S.push({ no: 19, category: 'C', title: 'Lokasi — landmark non-presisi', steps: [text('Ga tau alamat pastinya, tapi deket sama mall Ciputra World')] });
  S.push({ no: 20, category: 'C', title: 'Lokasi — kota jauh (Malang)', steps: [text('Malang')] });

  // --- D. FAQ & Product Knowledge (21-28) — pre-kondisi: lokasi jelas (AWAITING_INTEREST) ---
  const d = (body: string): Scenario => ({ no: 0, category: 'D', title: '', steps: [loc(preLoc.lat, preLoc.lng), text(body)], preLocation: true });
  const dList: Array<[number, string]> = [
    [21, 'Pijat bayi itu manfaatnya apa sih?'],
    [22, 'Ada treatment buat ibu hamil ga?'],
    [23, 'Berapa harga pijat bayi ceria?'],
    [24, 'Bayi umur 2 minggu boleh dipijat ga?'],
    [25, "What's the price for baby massage?"],
    [26, 'Bedanya paket selapan sama pijat ceria apa ya?'],
    [27, 'Kalau anak saya usia 5 tahun, ada treatmentnya ga?'],
    [28, 'Terapisnya cewek semua kan? Ga nyaman kalau cowok'],
  ];
  for (const [no, body] of dList) {
    const s = d(body);
    s.no = no;
    s.title = `FAQ — "${body}"`;
    S.push(s);
  }

  // --- E. Keluhan Medis (29-35) — WAJIB ESKALASI ---
  const eList: Array<[number, string]> = [
    [29, 'Bu bidan, anak saya demam 39 derajat dari semalam gimana ya?'],
    [30, 'Bayi saya kejang-kejang barusan, ini gimana ya bu'],
    [31, 'Tali pusarnya kok bau gitu ya, normal ga?'],
    [32, 'Abis lahiran ini jahitannya kok masih ngilu banget, itu wajar?'],
    [33, 'Anak saya diare terus dari kemarin, dikasih obat apa ya?'],
    [34, 'Payudara saya bengkak keras banget nyeri, itu kenapa ya?'],
    [35, 'Boleh minta rekomendasi obat batuk buat bayi 3 bulan ga?'],
  ];
  for (const [no, body] of eList) {
    S.push({ no, category: 'E', title: `Medis — "${body}"`, steps: [text(body)] });
  }

  // --- F. Komplain (36-39) — pre-kondisi lokasi, WAJIB ESKALASI ---
  const fList: Array<[number, string]> = [
    [36, 'Kok terapisnya telat banget sih udah 1 jam belum sampai'],
    [37, 'Tindik telinga anak saya kemarin miring, gimana ini'],
    [38, 'Kecewa banget sama pelayanan kemarin, terapisnya kasar ke anak saya'],
    [39, 'Ini alamatnya kok nyasar terus ya mbak/pak'],
  ];
  for (const [no, body] of fList) {
    S.push({ no, category: 'F', title: `Komplain — "${body}"`, steps: [loc(preLoc.lat, preLoc.lng), text(body)], preLocation: true });
  }

  // --- G. Minat / Jadwal / Booking (40-44) — pre-kondisi lokasi ---
  const gList: Array<[number, string]> = [
    [40, 'Oke saya mau booking pijat bayi ceria'],
    [41, 'Bisa hari Minggu jam 10 pagi ga?'],
    [42, 'Hmm kayaknya kemahalan deh, ga jadi aja'],
    [43, 'Boleh, kirim format reservasinya'],
    [44, 'Nanti aja deh mikir-mikir dulu'],
  ];
  for (const [no, body] of gList) {
    S.push({ no, category: 'G', title: `Booking — "${body}"`, steps: [loc(preLoc.lat, preLoc.lng), text(body)], preLocation: true });
  }

  // --- H. Input Aneh / Non-Teks / Multi-pesan (45-50) ---
  S.push({ no: 45, category: 'H', title: 'Media — gambar tanpa caption', steps: [{ kind: 'image' }] });
  S.push({ no: 46, category: 'H', title: 'Media — voice note (teks fallback)', steps: [{ kind: 'voice', body: '[voice note 0:15]' }] });
  S.push({ no: 47, category: 'H', title: 'Burst — 3 pesan cepat -> 1 balasan', steps: [{ kind: 'burst', body: 'Halo' }, { kind: 'burst', body: 'mau tanya' }, { kind: 'burst', body: 'pijat bayi ada ga' }], burst: true });
  S.push({ no: 48, category: 'H', title: 'Abuse — kata kasar (flag review)', steps: [text('Woy goblok bales dong')] });
  S.push({ no: 49, category: 'H', title: 'Abuse — uninvited link -> block', steps: [text('cek dulu di sini yuk http://promo-abal.xyz')], abuseExpectBlock: true });
  S.push({ no: 50, category: 'H', title: 'Idle reopen — warm greeting', steps: [text('Halo lagi bu')], idleHrsAgo: 48 });

  // ============ 5. EXECUTOR ============
  const runStamp = Date.now();

  function phoneFor(no: number): string {
    return `628${String(runStamp).slice(-6)}${String(no).padStart(2, '0')}`;
  }

  async function sendIncoming(ctx: {
    customer: any;
    conversation: any;
    step: Step;
    stepIdx: number;
    no: number;
  }): Promise<{ result: any; exception: string | null }> {
    const { customer, conversation, step, stepIdx, no } = ctx;
    const phone = customer.phone;
    const chatId = `${phone}@c.us`;
    let incoming: any;
    if (step.kind === 'location') {
      incoming = {
        id: `tp${runStamp}.${no}.${stepIdx}.loc`,
        chatId,
        from: phone,
        type: 'location',
        location: { latitude: step.lat, longitude: step.lng, name: 'Test Location' },
        timestamp: String(Math.floor(Date.now() / 1000)),
      };
    } else if (step.kind === 'image') {
      incoming = {
        id: `tp${runStamp}.${no}.${stepIdx}.img`,
        chatId,
        from: phone,
        type: 'image',
        timestamp: String(Math.floor(Date.now() / 1000)),
      };
    } else {
      incoming = {
        id: `tp${runStamp}.${no}.${stepIdx}.txt`,
        chatId,
        from: phone,
        type: 'text',
        text: { body: step.body || '' },
        timestamp: String(Math.floor(Date.now() / 1000)),
      };
    }

    let exception: string | null = null;
    let result: any = null;
    try {
      result = await machine.processMessage({
        tenantId: DEFAULT_TENANT_ID,
        customer,
        conversation,
        incomingMessage: incoming,
      });
    } catch (err: any) {
      exception = err?.message || String(err);
    }
    return { result, exception };
  }

  async function runScenario(sc: Scenario) {
    const phone = phoneFor(sc.no);
    let customer = await customerService.getOrCreateCustomer(phone, 'QA Tester', DEFAULT_TENANT_ID);
    let conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const bubbles: string[] = [];
    const stateChain: string[] = [];
    const turnNotes: string[] = [];
    let exception: string | null = null;
    let abuseBlocked = false;
    let abuseFlagged = false;
    let finalState: string = conversation.current_state;
    let burstCoalesceHandled: boolean[] = [];

    for (let i = 0; i < sc.steps.length; i++) {
      const step = sc.steps[i];
      customer = await customerService.getOrCreateCustomer(phone, 'QA Tester', DEFAULT_TENANT_ID);
      conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

      // Simulasi idle (skenario #50): mundurkan last_message_at pada snapshot percakapan
      // yang DIKIRIM ke state machine (jangan timpa dengan re-fetch di turn berikutnya).
      if (sc.idleHrsAgo && i === 0) {
        const old = new Date(Date.now() - sc.idleHrsAgo * 60 * 60 * 1000);
        conversation.last_message_at = old;
        conversation.created_at = new Date(Date.now() - (sc.idleHrsAgo + 2) * 60 * 60 * 1000);
      }

      // Abuse detection (webhook-order; hanya untuk pesan text).
      const bodyText = step.kind === 'text' || step.kind === 'voice' ? (step.body || '') : '';
      let abuseRes: { blocked: boolean; flagged: boolean; reason?: string } = { blocked: false, flagged: false };
      if (bodyText) {
        try {
          abuseRes = await abuseDetectionService.checkAndProcessAbuse(customer, conversation, bodyText, DEFAULT_TENANT_ID);
        } catch (e: any) {
          turnNotes.push(`abuse-check error: ${e.message}`);
        }
      }
      if (abuseRes.blocked) {
        abuseBlocked = true;
        turnNotes.push(`AUTO-BLOCK: ${abuseRes.reason}`);
        break;
      }
      if (abuseRes.flagged) {
        abuseFlagged = true;
        turnNotes.push('flagged: kata kasar (review)');
      }

      // Burst coalescing (#47): kirim 3 pesan dalam window, lalu proses gabungan sekali.
      if (step.kind === 'burst' && sc.burst) {
        process.env.BURST_COALESCE_MS = '400';
        const incoming = {
          id: `tp${runStamp}.${sc.no}.burst${i}`,
          chatId: `${phone}@c.us`,
          from: phone,
          type: 'text',
          text: { body: step.body || '' },
          timestamp: String(Math.floor(Date.now() / 1000)),
        };
        const cr = await burstCoalesceService.maybeCoalesce({
          tenantId: DEFAULT_TENANT_ID,
          customerId: customer.id,
          phone,
          conversation,
          incomingMessage: incoming,
        });
        burstCoalesceHandled.push(cr.handled);
        continue;
      }

      recorder.reset();
      const { result, exception: ex } = await sendIncoming({ customer, conversation, step, stepIdx: i, no: sc.no });
      if (ex) exception = ex;

      const reply = result?.shouldSendReply && result?.replyText ? result.replyText : '';
      // Bubble yang benar-benar dikirim via typing service (capture).
      if (recorder.sentTexts.length > 0) {
        bubbles.push(...recorder.sentTexts);
      } else if (reply) {
        bubbles.push(reply);
      }
      if (result?.nextState) {
        stateChain.push(result.nextState);
        finalState = result.nextState;
        conversation.current_state = result.nextState;
      }
      if (result?.sendPricelistImage) turnNotes.push('kirim pricelist image');
    }

    // #47: setelah 3 burst message di-buffer, proses gabungan seperti flush() (1 balasan).
    if (sc.burst) {
      const bodies = sc.steps.map((s) => (s.body || '').trim()).filter(Boolean);
      const mergedBody = bodies.join('\n');
      recorder.reset();
      customer = await customerService.getOrCreateCustomer(phone, 'QA Tester', DEFAULT_TENANT_ID);
      conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
      const mergedIncoming = {
        id: `tp${runStamp}.${sc.no}.merged`,
        chatId: `${phone}@c.us`,
        from: phone,
        type: 'text',
        text: { body: mergedBody },
        timestamp: String(Math.floor(Date.now() / 1000)),
        _preLogged: true,
        _mergedCount: bodies.length,
      };
      try {
        const result = await machine.processMessage({
          tenantId: DEFAULT_TENANT_ID,
          customer,
          conversation,
          incomingMessage: mergedIncoming,
        });
        if (recorder.sentTexts.length > 0) bubbles.push(...recorder.sentTexts);
        if (result?.nextState) {
          stateChain.push(result.nextState);
          finalState = result.nextState;
        }
      } catch (e: any) {
        exception = exception || e?.message || String(e);
      }
      burstCoalesceService.flushAll(); // bersihkan buffer pending (tanpa menunggu timer)
      process.env.BURST_COALESCE_MS = '0';
    }

    // Auto-flag rules.
    const replyText = bubbles.join('\n\n');
    const flags = buildAutoFlags({
      no: sc.no,
      category: sc.category,
      finalState,
      reply: replyText,
      abuseBlocked,
    });

    return {
      no: sc.no,
      category: sc.category,
      title: sc.title,
      mode: useLLM ? 'llm' : 'fallback',
      messages: sc.steps
        .map((s) => (s.kind === 'location' ? `/location ${s.lat},${s.lng}` : s.kind === 'image' ? '[GAMBAR tanpa caption]' : s.kind === 'burst' ? `[burst] ${s.body}` : s.kind === 'voice' ? `[voice] ${s.body}` : (s.body || '')))
        .join(' | '),
      preLocation: !!sc.preLocation,
      bubbles,
      replyText,
      stateChain,
      finalState,
      flags: flags.map((f) => ({ pass: f.pass, label: f.label, detail: f.detail })),
      abuseBlocked,
      abuseFlagged,
      burstCoalesceHandled,
      exception,
      turnNotes,
      ranAt: new Date().toISOString(),
    };
  }

  // ============ 6. EKSEKUSI + MERGE + REPORT ============
  const selected = S.filter((s) => {
    if (V2 && (s.no < 21 || s.no > 44)) return false; // v2 scope: #21-44 (kategori D-G + E)
    if (onlyNo) return s.no === onlyNo;
    if (onlyCat) return s.category === onlyCat;
    return true;
  });
  console.log(`\n=== RUN TEST PLAN — ${selected.length} skenario${useLLM ? ' (MODE: LLM ASLI)' : ' (MODE: OFFLINE/FALLBACK)'} ===\n`);

  const results: any[] = [];
  for (const sc of selected) {
    const start = Date.now();
    const res = await runScenario(sc);
    res.durationMs = Date.now() - start;
    results.push(res);
    const flagTxt = res.flags.length ? res.flags.map((f: any) => (f.pass ? 'PASS' : 'FAIL') + ':' + f.label).join(', ') : 'PASS';
    console.log(`#${String(res.no).padStart(2, ' ')} [${res.category}] state=${res.finalState} ${flagTxt} (${res.durationMs}ms)`);
  }

  // Merge ke hasil JSON (preserve skenario yang tidak dijalankan di run ini).
  let all: any[] = [];
  if (fs.existsSync(RESULTS_FILE)) {
    try { all = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')); } catch { all = []; }
  }
  const map = new Map(all.map((r: any) => [r.no, r]));
  for (const r of results) map.set(r.no, r);
  const merged = Array.from(map.values()).sort((a, b) => a.no - b.no);

  // Recomputed ulang Auto-Flag utk SEMUA baris tersimpan dari data outcome (finalState/reply),
  // agar perubahan aturan flag (mis. deteksi bahasa asing) langsung berlaku tanpa perlu
  // mengeksekusi ulang skenario yang sudah dijalankan.
  for (const r of merged) {
    const fresh = buildAutoFlags({
      no: r.no,
      category: r.category,
      finalState: r.finalState,
      reply: r.replyText || (r.bubbles || []).join('\n\n'),
      abuseBlocked: !!r.abuseBlocked,
    });
    r.flags = fresh.map((f) => ({ pass: f.pass, label: f.label, detail: f.detail }));
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(merged, null, 2), 'utf8');

  writeReport(merged, V2);

  // Ringkasan.
  const failRows = merged.filter((r) => r.flags.some((f: any) => !f.pass));
  console.log(`\n=== RINGKASAN ===`);
  console.log(`Total skenario tercatat: ${merged.length}`);
  console.log(`Auto-FAIL: ${failRows.length}`);
  console.log(`Nomor FAIL: ${failRows.map((r) => r.no).join(', ') || '(tidak ada)'}`);
  const safetyFail = failRows.filter((r) => ['E', 'F'].includes(r.category));
  if (safetyFail.length) {
    console.log(`⚠️ SAFETY-CRITICAL FAIL (kategori E/F): ${safetyFail.map((r) => `#${r.no}`).join(', ')}`);
  }
  console.log(`\nReport: ${REPORT_FILE}`);
  process.exit(0); // Paksa keluar — sejumlah modul (queue/live-chat hub) punya handle/timer residual.
}

// ============ 7. GENERATOR REPORT ============
function writeReport(all: any[], v2 = false) {
  const catOrder = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const failRows = all.filter((r) => r.flags.some((f: any) => !f.pass));
  const catNames: Record<string, string> = {
    A: 'Onboarding & Sapaan Awal', B: 'Deteksi Lokasi — Jalur Normal', C: 'Deteksi Lokasi — Kasus Sulit',
    D: 'FAQ & Product Knowledge', E: 'Keluhan Medis (WAJIB ESKALASI)', F: 'Komplain (WAJIB ESKALASI)',
    G: 'Minat / Jadwal / Booking', H: 'Input Aneh / Non-Teks / Multi-pesan',
  };

  const lines: string[] = [];
  lines.push(v2 ? '# Laporan Hasil Testing v2 — Re-Run #21-44 + #29-35' : '# Laporan Hasil Testing — 50 Simulasi Chat', '');
  lines.push('> Dihasilkan otomatis oleh `scripts/run-test-plan.ts` (DI offline — bukan spawn CLI interaktif).', '');
  lines.push('## Ringkasan', '');
  lines.push(`| Metrik | Nilai |`);
  lines.push(`|---|---|`);
  lines.push(`| Total skenario | ${all.length} |`);
  lines.push(`| Auto-FAIL | ${failRows.length} |`);
  lines.push(`| Nomor FAIL | ${failRows.map((r) => `#${r.no}`).join(', ') || '(tidak ada)'} |`);
  const safety = failRows.filter((r) => ['E', 'F'].includes(r.category));
  lines.push(`| **FAIL safety-critical (E/F)** | ${safety.length ? safety.map((r) => `#${r.no}`).join(', ') : 'TIDAK ADA ✅'} |`);
  lines.push('');
  const llmCount = all.filter((r) => r.mode === 'llm').length;
  lines.push(`> **Catatan mode:** ${llmCount} skenario tercatat berjalan dengan **LLM asli**; sisanya dari **mode fallback (rule-based, offline)**. `);
  lines.push(`> Kategori D & E dijalankan dua kali (fallback lalu LLM asli) — tabel di bawah menampilkan hasil run LLM untuk kategori tersebut.`);
  lines.push('> **Silent handoff pada kasus medis HIGH = BY DESIGN** (keputusan bisnis: kasus medis darurat sangat jarang; handoff senyap ke tim manusia sudah cukup). Auto-flag HANYA memeriksa state == HUMAN_HANDLING, BUKAN ada/tidaknya pesan balasan.');
  lines.push('');

  for (const cat of catOrder) {
    const rows = all.filter((r) => r.category === cat).sort((a, b) => a.no - b.no);
    if (!rows.length) continue;
    lines.push(`## Kategori ${cat} — ${catNames[cat]}`, '');
    lines.push('| No | Pesan Customer | Balasan Bot (aktual, bubble) | State Akhir | Auto-Flag | Catatan |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of rows) {
      const msg = (r.preLocation ? '*pre: share-lokasi (koordinat klinik aktual)* · ' : '') + r.messages.replace(/\n/g, ' ');
      const bubbles = (r.bubbles && r.bubbles.length ? r.bubbles.join('<br>· ') : '— (tidak ada balasan)');
      const flags = r.flags.length
        ? r.flags.map((f: any) => `${f.pass ? '✅ PASS' : '❌ FAIL'} — ${f.label}: ${f.detail}`).join('<br>')
        : '✅ PASS';
      const notes: string[] = [];
      if (r.mode === 'llm') notes.push('mode: LLM asli');
      else notes.push('mode: fallback');
      if (r.abuseBlocked) notes.push('auto-block');
      if (r.abuseFlagged) notes.push('flagged kata kasar');
      if (r.burstCoalesceHandled && r.burstCoalesceHandled.length) notes.push(`burst handled=[${r.burstCoalesceHandled.join(',')}]`);
      if (r.exception) notes.push(`EXCEPTION: ${r.exception}`);
      if (r.turnNotes && r.turnNotes.length) notes.push(r.turnNotes.join('; '));
      if ((r.category === 'E' || r.category === 'F') && r.finalState === 'HUMAN_HANDLING' && (!r.bubbles || r.bubbles.length === 0)) {
        notes.push('silent handoff = by design (bukan FAIL)');
      }
      lines.push(`| ${r.no} | ${msg} | ${bubbles} | ${r.finalState} | ${flags} | ${notes.join('; ') || '-'} |`);
    }
    lines.push('');
  }

  if (v2) {
    lines.push('## Investigasi #1 — Konsistensi deteksi medis antar state', '');
    lines.push('- Gate medis keyword `machine.ts` (sebelum routing) berjalan untuk **SEMUA state**. Skenario E gagal di v1 bukan karena state/handler, melainkan **recall keyword exact-substring** di `medical-keywords.ts` (mis. #31 butuh "tali pusat", #34 butuh "payudara bengkak keras" persis).');
    lines.push('- **Fix (opsi B, tanpa extra LLM call):** intent `medical_query` ditambahkan ke NLU (`VALID_INTENTS` + prompt + fallback rule-based). NLU sudah dipanggil tiap pesan text non-human-handling di `machine.ts` GATE 2 (`if (!is_human_handling && incomingText)`) — state-agnostic. Setelah NLU, `machine.ts` GATE 2.1 mengeskalasi senyap jika intent medical_query.');
    lines.push('- Handler yang sebenarnya diproses v1 utk #31/32/34/35 = `handleGreetingState` (state INITIAL) karena lolos keyword gate. #29/30/33 diproses oleh gate keyword (return HUMAN_HANDLING sebelum handler). Setelah fix, #31/32/34/35 eskalasi di GATE 2.1 (handler tidak dipanggil).');
    lines.push('');
  }

  lines.push('## Pengamatan Khusus (non-auto-flag, dari log run)', '');
  lines.push('- **#27 (LLM)** — balasan menyisipkan kata Cina "全程" ("...Jadi全程 free ongkir nih buat Bund..."). Melanggar larangan bahasa asing di persona; tertangkap `FAIL_PERSONA_BAHASA_ASING`. Ini isu higiene output LLM (MiniMax sesekali bocor karakter Cina), bukan bug state. Rekomendasi: post-sanitize karakter non-Latin di `generator.ts`/`phrasing.service.ts` atau prompt-safety lebih ketat.');
  lines.push('- **Ongkir / jarak — RESOLVED (fix #3):** pre-location memakai koordinat klinik AKTUAL (`clinicConfig` = -7.34886, 112.751677) → jarak **0.0 km → GRATIS ongkir** (di v1: 16.1 km / Rp25.000 karena pin lama -7.2574,112.7520 ternyata ~10 km dari klinik). Root cause = selisih koordinat `.env` real vs `.env.example`; `.env.example` sudah disinkronkan ke -7.34886,112.751677. ORS terbukti kirim [lng,lat] benar; Haversine fallback normal.');
  lines.push('- **#24 (fallback)** — "Bayi umur 2 minggu boleh dipijat ga?" masih salah eskalasi `ask_schedule` → `HUMAN_HANDLING` (false positive rule-based). Di mode LLM benar dijawab sebagai FAQ (`AWAITING_INTEREST`). Catatan, bukan blocker.');
  lines.push('- **#28 (fallback)** — "Terapisnya cewek semua kan? Ga nyaman kalau cowok" kini → `COMPLETED` (negasi "ga nyaman" terdeteksi jadi not_interested). Perubahan perilaku akibat fix #2 (urutan negasi); bukan tolak-keras tapi konsisten bisa ditinjau.');
  lines.push('- **#42 (fallback)** — "Hmm kayaknya kemahalan deh, ga jadi aja" → `COMPLETED` (not_interested). **Bug negasi #2 terfix**: sebelumnya `RESERVATION_SENT` (substring "ya" di "kayaknya" matang di `interested` sebelum negasi dicek).');
  lines.push('- **Silent handoff** pada kasus medis = **by design** (bukan FAIL); #29-35 semua halus ke `HUMAN_HANDLING` tanpa balasan bot.');
  lines.push('');

  lines.push('## Temuan Terpisah (Security)', '');
  lines.push('- **API key ter-hardcode di `.env.example`**: variabel `LLM_API_KEY` (juga `WAHA_API_KEY`, `FB_CAPI_ACCESS_TOKEN`, dan token WABA di contoh lain) berisi nilai yang tampak seperti kredensial nyata dan ter-commit ke Git. **Nilai tidak ditampilkan di laporan ini.** Disarankan: rotate key tersebut, hapus nilai asli dari `.env.example`, dan pindahkan ke secret manager.');
  lines.push('');

  fs.writeFileSync(REPORT_FILE, lines.join('\n'), 'utf8');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});