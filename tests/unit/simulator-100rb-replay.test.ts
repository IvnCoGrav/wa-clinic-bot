import { describe, it, expect } from 'vitest';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { V3ConversationSummarizer } from '../../src/v3/state/conversation-summarizer';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

/**
 * Replay simulator sesi 973126 (adversarial, bukan happy-path):
 * Turn 2 "Mba 100rb berapa menit pijetnya?" DILARANG membajak
 * session.selectedTreatment ke Pijat Bayi Ceria, dan summarizer wajib
 * mengenali pertanyaan komposit nominal+durasi.
 */
describe('Simulator 973126 replay: 100rb berapa menit', () => {
  it('detectAgreedTreatment mengabaikan pesan asisten (role user only)', () => {
    const catalogNames = treatmentCatalogService.getAllServices(true).map((s) => s.name);
    const history = [
      { role: 'assistant', content: 'Kami ada Pijat Bayi Ceria (Rileksasi) yang bagus Bunda' },
      { role: 'user', content: 'Mba 100rb berapa menit pijetnya?' },
    ];
    // Pesan asisten menyebut Ceria → DILARANG dianggap customer setuju
    expect(V3AgentRunner.detectAgreedTreatment(history, catalogNames)).toBeNull();
  });

  it('detectAgreedTreatment tetap menangkap persetujuan eksplisit user', () => {
    const catalogNames = treatmentCatalogService.getAllServices(true).map((s) => s.name);
    const history = [
      { role: 'assistant', content: 'Ada beberapa pilihan Bunda' },
      { role: 'user', content: 'Saya ambil Prenatal Massage (Pijat Hamil) ya' },
    ];
    expect(V3AgentRunner.detectAgreedTreatment(history, catalogNames)).toBe(
      'Prenatal Massage (Pijat Hamil)'
    );
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
