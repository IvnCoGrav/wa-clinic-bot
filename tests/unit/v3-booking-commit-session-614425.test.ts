import { describe, it, expect } from 'vitest';
import { ContextGrounder } from '../../src/v3/agent/pipeline/context-grounder';
import { V3ConversationSummarizer } from '../../src/v3/state/conversation-summarizer';
import type { CustomerGoalSession } from '../../src/v3/state/goal-tracker';

/**
 * Audit sesi 614425 (booking buntu): customer sudah menyatakan komitmen ganda
 * — memilih treatment ("iya bu saya ambil treatment nya") lalu memilih hari
 * ("inggih bu, besok boleh") — namun save_reservation TIDAK PERNAH dipanggil.
 * LLM malah menanyakan JAM kunjungan spesifik (dilarang Aturan Emas).
 *
 * Test ini mengunci regresi perilaku tsb secara deterministik (tanpa DB/LLM).
 */

const TREATMENT = 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)';

/** Session setelah sesi 614425 berjalan sampai turn "besok boleh". */
const committedSession: CustomerGoalSession = {
  genderGreeting: 'Bunda',
  location: { kelurahan: 'Tambakwedi', kecamatan: 'Kenjeran', distanceKm: 23.65 } as any,
  ongkirStatus: 'QUOTED' as any,
  targetAudience: 'KIDS' as any,
  selectedTreatment: TREATMENT,
  cartItems: [{ name: TREATMENT, promoPrice: 75000 } as any],
  // Rule 5 (sticky): komitmen eksplisit "iya bu saya ambil treatment nya" di
  // turn sebelumnya dikunci ke session (ContextGrounder.applySessionLatches),
  // sehingga jawaban hari "besok boleh" di turn terpisah tetap commit-ready.
  bookingCommitConfirmed: true,
};

const historyBeforeCommit = [
  { role: 'user', content: 'selamat malam, mau tanya untuk pijat bayi' },
  { role: 'assistant', content: 'Halo Bunda! Selamat malam! ... di daerah mana ya?' },
  { role: 'user', content: 'jln tambak wedi baru surabaya bu' },
  { role: 'assistant', content: 'Wah, dekat ya Bunda! ... Rencana mau ambil perawatan apa?' },
  { role: 'user', content: 'ini anak saya lagi pilek, apa bisa ya dipijat ?' },
  { role: 'assistant', content: 'Bisa banget, Bunda! ... Pijat Bayi Pulih Ceria ...' },
];

describe('Sesi 614425 — commit booking deterministik', () => {
  it('isBookingCommitReady TRUE saat treatment disepakati + hari disebut ("besok boleh")', () => {
    expect(
      ContextGrounder.isBookingCommitReady(committedSession, 'inggih bu, besok boleh', historyBeforeCommit)
    ).toBe(true);
  });

  it('isBookingCommitReady FALSE bila treatment belum disepakati', () => {
    const noTreatment: CustomerGoalSession = { genderGreeting: 'Bunda' };
    expect(
      ContextGrounder.isBookingCommitReady(noTreatment, 'inggih bu, besok boleh', historyBeforeCommit)
    ).toBe(false);
  });

  it('isBookingCommitReady FALSE bila tidak ada sebutan hari', () => {
    expect(
      ContextGrounder.isBookingCommitReady(committedSession, 'iya bu saya ambil treatment nya', historyBeforeCommit)
    ).toBe(false);
  });

  it('isBookingCommitReady FALSE bila reservasi sudah tercatat (anti dobel-kunci)', () => {
    const booked: CustomerGoalSession = {
      ...committedSession,
      booking: { preferredDate: 'besok', reservationId: 'res-1' } as any,
    };
    expect(
      ContextGrounder.isBookingCommitReady(booked, 'besok boleh', historyBeforeCommit)
    ).toBe(false);
  });

  it('summarizer TIDAK menyuruh tanya ulang hari dengan framing buntu — tapi menjaga larangan tanya-ulang', () => {
    const s = V3ConversationSummarizer.summarize(committedSession, 'inggih bu, besok boleh', {
      history: historyBeforeCommit as any,
      customerInput: 'inggih bu, besok boleh',
    });
    // Framing lama yang membuat LLM buntu ("karena Bunda sudah menyebutkan hari"
    // tanpa arahan maju) tidak boleh muncul lagi.
    expect(s).not.toContain('karena Bunda sudah menyebutkan hari');
    // Larangan tanya-ulang hari tetap ada (benar), namun dibarengi arahan maju.
    expect(s).toMatch(/JANGAN tanya ulang/);
  });

  it('summarizer mendorong arah maju (booking) dan melarang tanya jam spesifik', () => {
    const s = V3ConversationSummarizer.summarize(committedSession, 'inggih bu, besok boleh', {
      history: historyBeforeCommit as any,
      customerInput: 'inggih bu, besok boleh',
    });
    expect(s).toMatch(/kunci|reservasi/i);
    expect(s).toMatch(/jam spesifik|jam kunjungan/i);
  });
});
