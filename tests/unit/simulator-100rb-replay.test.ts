import { describe, it, expect } from 'vitest';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { V3ConversationSummarizer } from '../../src/v3/state/conversation-summarizer';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

/**
 * Replay simulator sesi 973126 (adversarial, bukan happy-path):
 * pertanyaan nominal+durasi DILARANG membajak session.selectedTreatment,
 * dan summarizer wajib mengenali pertanyaan komposit nominal+durasi.
 * SENGAJA tanpa hafalan nama layanan (katalog dapat di-rename admin via
 * dashboard) — nama diambil dinamis dari katalog aktif.
 */
describe('Simulator 973126 replay: nominal + durasi tanpa nama paket', () => {
  const catalogNames = () =>
    treatmentCatalogService.getAllServices(true).map((s) => s.name);

  it('detectAgreedTreatment mengabaikan pesan asisten (role user only)', () => {
    const names = catalogNames();
    expect(names.length).toBeGreaterThan(0);
    const history = [
      { role: 'assistant', content: `Kami ada ${names[0]} yang bagus Bunda` },
      { role: 'user', content: 'Mba 100rb berapa menit pijetnya?' },
    ];
    // Sebutan asisten DILARANG dianggap customer setuju; user tak menyebut
    // nama paket apa pun → null.
    expect(V3AgentRunner.detectAgreedTreatment(history, names)).toBeNull();
  });

  it('detectAgreedTreatment tetap menangkap persetujuan eksplisit user', () => {
    const names = catalogNames();
    const agreed = names[0];
    const history = [
      { role: 'assistant', content: 'Ada beberapa pilihan Bunda' },
      { role: 'user', content: `Saya ambil ${agreed} ya` },
    ];
    expect(V3AgentRunner.detectAgreedTreatment(history, names)).toBe(agreed);
  });

  it('summarizer komposit nominal+durasi → klarifikasi paket, bukan durasi paket terkunci', () => {
    const summary = V3ConversationSummarizer.summarize(
      {} as any,
      'Mba 100rb berapa menit pijetnya?',
      { history: [], customerInput: 'Mba 100rb berapa menit pijetnya?' }
    );
    expect(summary).toContain('nominal tertentu');
    expect(summary).toContain('Bunda atau si kecil');
    // DILARANG ada larangan tanya treatment saat paket belum dipilih
    expect(summary).not.toContain("Menanyakan 'rencana mau treatment apa'");
  });

  it('summarizer durasi murni (tanpa nominal) tetap jalur durasi biasa', () => {
    const summary = V3ConversationSummarizer.summarize(
      {} as any,
      'Untuk pijat bayi biasanya brp menit kak',
      { history: [], customerInput: 'Untuk pijat bayi biasanya brp menit kak' }
    );
    expect(summary).toContain('durasi waktu pelaksanaan');
  });
});
