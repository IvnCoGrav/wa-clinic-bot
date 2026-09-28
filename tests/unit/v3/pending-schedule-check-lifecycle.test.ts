/**
 * pending-schedule-check-lifecycle.test.ts — Lifecycle `pendingScheduleCheck`.
 *
 * Bug (CASE-039): customer menanyakan ketersediaan jadwal ("untuk besok bisa")
 * → `pendingScheduleCheck=true`. Lalu customer MEMBATALKAN ("Jangan") dan
 * menunda ("Nanti dli..nunggu haid saya selesai"). Flag TIDAK pernah di-reset,
 * sehingga turn berikutnya yang hanya berkata "Siap" disambar FastResponseGate
 * sebagai acknowledgement → eskalasi palsu ke HUMAN_HANDLING.
 *
 * Perbaikan FONDASIONAL (state lifecycle, bukan daftar frasa batal): flag
 * "menunggu ack" hanya sah selama turn customer masih mengarah ke jadwal
 * (sinyal jadwal / verba komitmen / ack pendek). Turn lain (batal, tunda,
 * pindah topik) membatalkan penantian secara deterministik.
 *
 * Prinsip Adversarial (MANDATORY): parafrase batal/tunda nyata, bukan hanya
 * kata "Jangan".
 */
import { describe, it, expect } from 'vitest';
import { ContextGrounder } from '../../../src/v3/agent/pipeline/context-grounder';
import { FastResponseGate } from '../../../src/v3/agent/pipeline/fast-response-gate';
import { CustomerGoalSession, GoalTracker } from '../../../src/v3/state/goal-tracker';

const TENANT = 'default-tenant';

function pendingSession(): CustomerGoalSession {
  return {
    genderGreeting: 'Bunda',
    location: { rawText: 'Krian', kelurahan: 'Ponokawan', distanceKm: 5 },
    // Sudah komit sebelumnya → Rule 5 commit-latch tidak mengganggu isolasi lifecycle.
    bookingCommitConfirmed: true,
    booking: { isConfirmed: false, pendingScheduleCheck: true, requestedTimeHint: 'besok' },
  };
}

async function latch(session: CustomerGoalSession, text: string, convId: string): Promise<CustomerGoalSession> {
  return ContextGrounder.applySessionLatches(session, text, convId, TENANT);
}

describe('pendingScheduleCheck lifecycle — CASE-039 (batal/tunda membatalkan penantian)', () => {
  it('"Jangan" → flag dibatalkan', async () => {
    const s = await latch(pendingSession(), 'Jangan', 'conv-psc-cancel-1');
    expect(s.booking?.pendingScheduleCheck).toBe(false);
    expect(s.booking?.requestedTimeHint).toBeUndefined();
  });

  it('"Nanti dli..nunggu haid saya selesai 🙏" → flag dibatalkan', async () => {
    const s = await latch(pendingSession(), 'Nanti dli..nunggu haid saya selesai 🙏', 'conv-psc-postpone-1');
    expect(s.booking?.pendingScheduleCheck).toBe(false);
  });

  it('adversarial parafrase batal: "cancel aja bund", "gajadi deh", "urungkan dulu"', async () => {
    for (const [i, text] of ['cancel aja bund', 'gajadi deh', 'urungkan dulu ya'].entries()) {
      const s = await latch(pendingSession(), text, `conv-psc-adv-${i}`);
      expect(s.booking?.pendingScheduleCheck, `text="${text}"`).toBe(false);
    }
  });

  it('pindah topik ("bayar pake apa?") → penantian dibatalkan', async () => {
    const s = await latch(pendingSession(), 'bayar pake apa?', 'conv-psc-topic-1');
    expect(s.booking?.pendingScheduleCheck).toBe(false);
  });

  it('guard: turn jadwal baru ("kalau besok bisa?") → flag TETAP menunggu', async () => {
    const s = await latch(pendingSession(), 'kalau besok bisa?', 'conv-psc-keep-1');
    expect(s.booking?.pendingScheduleCheck).toBe(true);
  });

  it('guard: ack pendek ("oke siap") → flag TETAP menunggu (ditangani gate)', async () => {
    const s = await latch(pendingSession(), 'oke siap', 'conv-psc-ack-1');
    expect(s.booking?.pendingScheduleCheck).toBe(true);
  });

  it('guard: verba komitmen ("ambil besok ya") → flag TETAP menunggu', async () => {
    const s = await latch(pendingSession(), 'ambil besok ya', 'conv-psc-commit-1');
    expect(s.booking?.pendingScheduleCheck).toBe(true);
  });
});

describe('152a — penundaan yang menyebut nama hari TIDAK me-latch ulang', () => {
  it('"belum dulu ya karena jumat kami sudah pergi" → flag dibatalkan', async () => {
    const s = await latch(pendingSession(), 'Baik kak belum dulu ya karena jumat kami sudah pergi', 'conv-152a-1');
    expect(s.booking?.pendingScheduleCheck).toBe(false);
  });

  it('penundaan deklaratif lain yang menyebut hari → dibatalkan', async () => {
    for (const [i, text] of [
      'nanti aja ya kak, minggu ini kami keluar kota',
      'belum bisa kak, sabtu kami ada acara',
      'tunda dulu ya bun, senin baru pulang',
    ].entries()) {
      const s = await latch(pendingSession(), text, `conv-152a-dec-${i}`);
      expect(s.booking?.pendingScheduleCheck, `text="${text}"`).toBe(false);
    }
  });

  it('anti-regresi: pertanyaan jadwal ber-nama hari TETAP menunggu', async () => {
    for (const [i, text] of ['kalau jumat bisa?', 'besok bisa ga ya?', 'sabtu ready?', 'hari biasa sore jam 5 bisa min?'].entries()) {
      const s = await latch(pendingSession(), text, `conv-152a-q-${i}`);
      expect(s.booking?.pendingScheduleCheck, `text="${text}"`).toBe(true);
    }
  });

  it('anti-regresi: verba komitmen + hari tetap menunggu', async () => {
    const s = await latch(pendingSession(), 'ambil besok ya', 'conv-152a-commit');
    expect(s.booking?.pendingScheduleCheck).toBe(true);
  });

  it('replay residual: [penundaan+nama hari] lalu "Ok makasih" → gate TIDAK menembak', async () => {
    let session = pendingSession();
    session = await latch(session, 'Baik kak belum dulu ya karena jumat kami sudah pergi', 'conv-152a-e2e');
    const gate = await FastResponseGate.check({
      tenantId: TENANT,
      conversationId: 'conv-152a-e2e',
      phone: '628111222333',
      incomingText: 'Ok makasih',
      cleanIncomingText: 'Ok makasih',
      skipDbLogging: true,
      isFollowUp: true,
      session,
      currentSystemPrompt: '',
      fewShotExemplars: [],
    });
    expect(gate.handled).toBe(false);
  });
});

describe('CASE-039 replay end-to-end — "Siap" TIDAK memicu eskalasi setelah batal', () => {
  it('setelah batal, "Siap" tidak ditangkap FastResponseGate', async () => {
    let session = pendingSession();
    // Turn 5-6: customer membatalkan & menunda.
    session = await latch(session, 'Jangan', 'conv-psc-e2e');
    session = await latch(session, 'Nanti dli..nunggu haid saya selesai', 'conv-psc-e2e');
    // Turn 7: hanya "Siap".
    const gate = await FastResponseGate.check({
      tenantId: TENANT,
      conversationId: 'conv-psc-e2e',
      phone: '628111222333',
      incomingText: 'Siap',
      cleanIncomingText: 'Siap',
      skipDbLogging: true,
      isFollowUp: true,
      session,
      currentSystemPrompt: '',
      fewShotExemplars: [],
    });
    expect(gate.handled).toBe(false);
  });

  it('replay lintas-turn via GoalTracker store (jalur produksi persisten)', async () => {
    const convId = 'conv-psc-persist-1';
    // Turn 3: customer menyebut paket (lokasi belum) → sesi persisten dibuat.
    await GoalTracker.updateGoalSession(convId, {
      genderGreeting: 'Bunda',
      bookingCommitConfirmed: true,
      booking: { isConfirmed: false, pendingScheduleCheck: true, requestedTimeHint: 'besok' },
    } as any, TENANT);
    let session = await GoalTracker.getGoalSession(convId, TENANT);
    expect(session.booking?.pendingScheduleCheck).toBe(true);

    // Turn 5-6: batal & tunda → lifecycle harus membersihkan di store.
    session = await ContextGrounder.applySessionLatches(session, 'Jangan', convId, TENANT);
    session = await ContextGrounder.applySessionLatches(session, 'Nanti dli..nunggu haid saya selesai', convId, TENANT);
    const reloaded = await GoalTracker.getGoalSession(convId, TENANT);
    expect(reloaded.booking?.pendingScheduleCheck).toBe(false);

    // Turn 7: "Siap" → gate TIDAK memicu eskalasi.
    const gate = await FastResponseGate.check({
      tenantId: TENANT,
      conversationId: convId,
      phone: '628111222333',
      incomingText: 'Siap',
      cleanIncomingText: 'Siap',
      skipDbLogging: true,
      isFollowUp: true,
      session: reloaded,
      currentSystemPrompt: '',
      fewShotExemplars: [],
    });
    expect(gate.handled).toBe(false);
  });

  it('kontrol positif: TANPA batal, "Siap" tetap ditangani gate (perilaku lama utuh)', async () => {
    const gate = await FastResponseGate.check({
      tenantId: TENANT,
      conversationId: 'conv-psc-control',
      phone: '628111222333',
      incomingText: 'Siap',
      cleanIncomingText: 'Siap',
      skipDbLogging: true,
      isFollowUp: true,
      session: pendingSession(),
      currentSystemPrompt: '',
      fewShotExemplars: [],
    });
    expect(gate.handled).toBe(true);
  });
});

describe('CASE-043 — replay ekor transkrip nyata (penundaan tidak eskalasi; re-engage slot sah)', () => {
  // Urutan turn diambil apa adanya dari run-results-suite-v2.json (CASE-043, 22 turn).
  const CASE_043_TAIL = [
    'Baik kak belum dulu ya karena jumat kami sudah pergi',
    'Barangkali ada yg cancel di pagi hari mau ya',
    'Siapp',
    'Mau ambil yg sebelum jam 10an atau sore diatas jam 2 yaa mba',
    'Iyaa kak gpp',
    'Terimakasih',
  ];

  it('penundaan awal (turn 0-2) TIDAK memicu handoff; ack setelah re-engage slot (turn 5) SAH memicu closing', async () => {
    let session = pendingSession();
    let firstFireTurn = -1;
    for (const [i, msg] of CASE_043_TAIL.entries()) {
      const gate = await FastResponseGate.check({
        tenantId: TENANT,
        conversationId: `conv-psc-043-${i}`,
        phone: '628111222333',
        incomingText: msg,
        cleanIncomingText: msg,
        skipDbLogging: true,
        isFollowUp: true,
        session,
        currentSystemPrompt: '',
        fewShotExemplars: [],
      });
      if (gate.handled && firstFireTurn < 0) firstFireTurn = i;
      session = await latch(session, msg, `conv-psc-043-${i}`);
    }

    // Kontrak (keputusan produk): kalimat penundaan deklaratif ("belum dulu ya
    // karena jumat kami sudah pergi") MEMBATALKAN penantian → turn 0-2 TIDAK
    // boleh mengeskalasi (inti anti-eskalasi-palsu CASE-039/043).
    // Turn 3 ("Mau ambil yg sebelum jam 10an atau sore diatas jam 2...") adalah
    // RE-ENGAGE slot alternatif yang SAH me-latch ulang pendingScheduleCheck
    // (konsisten dengan test 'waitlist-reopen' di bawah). Karena itu ack penutup
    // "Terimakasih" (turn 5) SAH memicu tepat 1x closing + handoff.
    // Assert `firstFireTurn === 5` sekaligus membuktikan turn 0-4 TIDAK menembak.
    expect(firstFireTurn, 'tidak boleh ada handoff sebelum re-engage slot').toBe(CASE_043_TAIL.length - 1);
  });

  it('waitlist-reopen: preferensi slot baru SETELAH penundaan boleh menyalakan ulang', async () => {
    let session = await latch(pendingSession(), 'Barangkali ada yg cancel di pagi hari mau ya', 'conv-psc-043c0');
    expect(session.booking?.pendingScheduleCheck).toBe(false);
    // Customer membuka kembali minat dengan menyebut slot alternatif (nama hari/jam).
    session = await latch(session, 'Mau ambil yg sebelum jam 10an atau sore diatas jam 2 yaa mba', 'conv-psc-043c1');
    expect(session.booking?.pendingScheduleCheck).toBe(true);
  });
});
