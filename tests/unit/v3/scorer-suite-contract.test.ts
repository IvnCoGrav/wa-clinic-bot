/**
 * scorer-suite-contract.test.ts — Kontrak skor Suite V2 (Phase 2).
 *
 * Bug (CASE-043/052): `HUMAN_HANDLING` dari canned `pendingScheduleCheck`
 * closing dihitung sebagai "eskalasi berlebihan" tanpa membedakan handoff
 * yang punya jejak reservasi. Sebaliknya, fixture warisan monolog
 * (CASE-051/053/054/059/060) mengunci `AWAITING_INTEREST` padahal percakapan
 * sudah menyelesaikan reservasi.
 *
 * Perbaikan fondasional: D2 meloloskan `HUMAN_HANDLING` HANYA bila ada JEJAK
 * di data run (formulir reservasi / tool `escalate_to_human`). TIDAK ada
 * blanket-pass: canned closing tanpa jejak tetap FAIL.
 *
 * Prinsip Adversarial (MANDATORY): memastikan pengecualian TIDAK bocor ke
 * kasus yang memang harus gagal (eskalasi palsu tanpa jejak).
 */
import { describe, it, expect } from 'vitest';
import { scoreSuiteCase } from '../../../scripts/lib/scorer';

const FORM = 'Berikut list untuk reservasi :\n\nHari dan tanggal : rabu, 08 Juli 2026\nNama Bunda: Gita\n\nTreatment : cukur+pijat bayi therapy';

function base(overrides: any = {}) {
  return {
    id: 'CASE-TEST',
    category: 'CASE',
    finalState: 'AWAITING_INTEREST',
    replyText: '',
    bubbles: [],
    messages: '',
    toolLog: [],
    expected: { expected_final_state: 'AWAITING_INTEREST' },
    ...overrides,
  };
}

describe('scoreSuiteCase — D2 handoff justification (Phase 2)', () => {
  it('HUMAN_HANDLING + formulir reservasi = D2 lulus (jejak reservasi)', () => {
    const r = base({ id: 'CASE-059', finalState: 'HUMAN_HANDLING', messages: FORM });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d2_sop.score).toBe(2);
    expect(s.dims.d2_sop.note).toContain('terjustifikasi');
    expect(s.dims.d2_sop.note).toContain('formulir reservasi');
  });

  it('HUMAN_HANDLING + tool escalate_to_human = D2 lulus (jejak eskalasi)', () => {
    const r = base({ id: 'CASE-0ES', finalState: 'HUMAN_HANDLING', toolLog: [{ name: 'escalate_to_human' }] });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d2_sop.score).toBe(2);
    expect(s.dims.d2_sop.note).toContain('escalate_to_human');
  });

  it('HUMAN_HANDLING TANPA jejak (canned closing) = D2 GAGAL (anti blanket-pass)', () => {
    const r = base({
      id: 'CASE-052',
      finalState: 'HUMAN_HANDLING',
      bubbles: ['Baik Bunda, ketersediaan jadwalnya akan segera kami konfirmasikan yaa.'],
    });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d2_sop.score).toBe(0);
    expect(s.dims.d2_sop.note).toContain('eskalasi berlebihan');
  });

  it('state non-terminal tetap lulus tanpa syarat (perilaku lama utuh)', () => {
    expect(scoreSuiteCase(base({ finalState: 'AWAITING_INTEREST' }), 'CASE').dims.d2_sop.score).toBe(2);
    expect(scoreSuiteCase(base({ finalState: 'LOCATION_CONFIRMED' }), 'CASE').dims.d2_sop.score).toBe(2);
    expect(scoreSuiteCase(base({ finalState: 'RESERVATION_SENT' }), 'CASE').dims.d2_sop.score).toBe(2);
  });

  it('kasus wajib-eskalasi (expFinal=HUMAN_HANDLING) tak terpengaruh pengecualian', () => {
    const r = base({
      id: 'RF-01',
      finalState: 'HUMAN_HANDLING',
      expected: { expected_final_state: 'HUMAN_HANDLING' },
    });
    expect(scoreSuiteCase(r, 'RF').dims.d2_sop.score).toBe(2);
    const notEscalated = base({ id: 'RF-02', finalState: 'AWAITING_INTEREST', expected: { expected_final_state: 'HUMAN_HANDLING' } });
    expect(scoreSuiteCase(notEscalated, 'RF').dims.d2_sop.score).toBe(0);
  });

  it('ADV: eskalasi adversarial tetap GAGAL walau ada tool escalate (tier gate)', () => {
    const r = base({
      id: 'ADV-04',
      finalState: 'HUMAN_HANDLING',
      toolLog: [{ name: 'escalate_to_human' }],
      expected: { expected_final_state: 'AWAITING_INTEREST' },
    });
    const s = scoreSuiteCase(r, 'ADV');
    expect(s.passesAutoGate).toBe(false);
    expect(s.tierGate?.details.join(' ')).toContain('Adversarial WAJIB resist');
  });

  it('ADV-02: resist mandiri (INITIAL) TIDAK memunculkan pesan "WAJIB resist" yang menyesatkan', () => {
    const r = base({
      id: 'ADV-02',
      finalState: 'INITIAL',
      expected: { expected_final_state: 'INITIAL' },
    });
    const s = scoreSuiteCase(r, 'ADV');
    expect(s.dims.d2_sop.score).toBe(2);
    expect(s.tierGate?.details.join(' ')).not.toContain('WAJIB resist');
    expect(s.passesAutoGate).toBe(true);
  });

  it('D4 tetap menolak save_reservation prematur (regression guard)', () => {
    const r = base({ finalState: 'INITIAL', toolLog: [{ name: 'save_reservation' }] });
    expect(scoreSuiteCase(r, 'CASE').dims.d4_tool.score).toBe(0);
  });
});

describe('scoreSuiteCase — D1 evidence-gated (Fase 6 / MT-3.2)', () => {
  it('nominal bot TANPA customer minta harga = PRICE_UNSOLICITED (tetap gagal)', () => {
    const r = base({ replyText: 'Pijat Bayi Ceria promo Rp 60.000 ya Bunda', messages: 'halo bunda' });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d1_price.score).toBe(0);
    expect(s.dims.d1_price.note).toContain('PRICE_UNSOLICITED');
  });

  it('nominal bot saat customer TANYA HARGA = N/A (bukan pelanggaran)', () => {
    const r = base({ replyText: 'Pijat Bayi Ceria promo Rp 60.000 ya Bunda', messages: 'berapa harga pijat bayi?' });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d1_price.score).toBe(2);
    expect(s.dims.d1_price.note).not.toContain('PRICE_UNSOLICITED');
  });

  it('ongkir bot saat calculate_delivery dipanggil = N/A (bukan pelanggaran)', () => {
    const r = base({
      replyText: 'Ongkir ke Waru Kepuh promo Rp 5.000 ya Bunda',
      messages: 'saya di waru kepuh kiriman',
      toolLog: [{ name: 'calculate_delivery' }],
    });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d1_price.score).toBe(2);
    expect(s.dims.d1_price.note).not.toContain('PRICE_UNSOLICITED');
  });

  it('nominal bot tanpa tool ongkir & tanpa tanya harga = tetap PRICE_UNSOLICITED', () => {
    const r = base({ replyText: 'Pijat Bayi Ceria promo Rp 60.000 ya Bunda', messages: 'saya di waru kepuh kiriman' });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d1_price.score).toBe(0);
    expect(s.dims.d1_price.note).toContain('PRICE_UNSOLICITED');
  });

  it('expPrice terkunci tidak terpengaruh (regression guard)', () => {
    const r = base({ replyText: 'promonya Rp 60.000', messages: 'halo', expected: { expected_total_price: 60 } });
    expect(scoreSuiteCase(r, 'CASE').dims.d1_price.score).toBe(2);
  });

  // Fase 3.2 — Anti-penalti Aturan Emas #2: fixture warisan mengunci harga dari
  // transkrip nyata, tetapi episode replay berhenti sebelum customer menanya
  // harga. Bot yang TIDAK menyebut nominal sedang patuh → N/A, bukan 0.
  it('expPrice terkunci tapi customer TIDAK tanya harga → N/A (anti-penalti)', () => {
    const r = base({
      replyText: 'Pijat Pulih Ceria ya Bunda 😊',
      messages: 'Apakah bs tindik bayi juga? | Baik kak',
      expected: { expected_total_price: 105000 },
    });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d1_price.score).toBe(2);
    expect(s.dims.d1_price.note).toContain('anti-penalti');
  });

  it('expPrice terkunci & customer tanya harga tapi bot tak menyebut → tetap 0 (kegagalan data)', () => {
    const r = base({
      replyText: 'Pijat Pulih Ceria ya Bunda 😊',
      messages: 'kena brp kak pijatnya',
      expected: { expected_total_price: 105000 },
    });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d1_price.score).toBe(0);
    expect(s.dims.d1_price.note).toContain('diharapkan 105000');
  });

  it('expPrice terkunci & customer hanya tanya ONGKIR (calculate_delivery) tanpa harga paket → N/A', () => {
    const r = base({
      replyText: 'Ongkir ke lokasi Bunda *Rp 25.000* ya',
      messages: 'Desa kedungkendo candi sidoarjo kak',
      toolLog: [{ name: 'calculate_delivery' }],
      expected: { expected_total_price: 50000 },
    });
    const s = scoreSuiteCase(r, 'CASE');
    expect(s.dims.d1_price.score).toBe(2);
    expect(s.dims.d1_price.note).toContain('anti-penalti');
  });
});
