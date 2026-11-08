import { describe, it, expect } from 'vitest';
import * as bookingCommitGate from '../../src/v3/agent/pipeline/booking-commit-gate';

describe('Active User Commitment Mutlak (Task 0.7)', () => {
  it('should export applyUserCommitmentSignal as the single seam for commitment mutation', () => {
    // Fase 4 ID 4.4.1: satu seam kanonis applyUserCommitmentSignal
    expect(typeof (bookingCommitGate as any).applyUserCommitmentSignal).toBe('function');
  });

  it('should NOT allow LLM tool arguments or LLM verdict to latch bookingCommitConfirmed when user message has no commitment signal', () => {
    const userMessage = { role: 'user', content: 'mau tanya harga pijat bayi berapa ya?' };
    const initialSession: any = { bookingCommitConfirmed: false, cartItems: [] };

    // Jika applyUserCommitmentSignal ada, uji kontrak bahwa pesan non-komitmen dari user
    // tidak boleh me-latch bookingCommitConfirmed meskipun sinyal LLM mengaku COMMITTED
    if (typeof (bookingCommitGate as any).applyUserCommitmentSignal === 'function') {
      const updated = (bookingCommitGate as any).applyUserCommitmentSignal(
        initialSession,
        userMessage.content,
        'COMMITTED' // sinyal dari routing LLM
      );
      expect(updated.bookingCommitConfirmed).toBe(false);
    } else {
      // Pada kode lama, seam ini belum ada dan agent-runner secara sepihak
      // me-latch bookingCommitConfirmed hanya dari routing.commitment === 'COMMITTED'
      expect((bookingCommitGate as any).applyUserCommitmentSignal).toBeDefined();
    }
  });

  it('Task 4.4.3: adversarial non-commitment phrases must NOT latch bookingCommitConfirmed or trigger commit ready', () => {
    const adversarialPhrases = [
      'cara booking gimana ya?',
      'mau tanya paket apa saja yang tersedia',
      'besok bisa?',
      'apakah besok jam 10 ada slot kosong?',
      'jadwal hari rabu masih bisa?',
    ];

    const baseSession: any = {
      bookingCommitConfirmed: false,
      cartItems: [{ name: 'Pijat Bayi Ceria', price: 65000 }],
      location: { kelurahan: 'Rungkut' },
    };

    for (const phrase of adversarialPhrases) {
      const updated = (bookingCommitGate as any).applyUserCommitmentSignal(
        baseSession,
        phrase,
        'COMMITTED' // LLM hallucinates commitment verdict
      );
      expect(updated.bookingCommitConfirmed, `Phrase "${phrase}" must not be committed`).toBe(false);

      const isReady = (bookingCommitGate as any).isBookingCommitReady(
        updated,
        phrase,
        [{ role: 'user', content: phrase }]
      );
      expect(isReady, `Phrase "${phrase}" must not be booking ready`).toBe(false);
    }
  });
});
