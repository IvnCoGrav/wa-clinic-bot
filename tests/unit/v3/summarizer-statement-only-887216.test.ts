import { describe, it, expect } from 'vitest';
import { V3ConversationSummarizer } from '../../../src/v3/state/conversation-summarizer';

/**
 * Sesi 887216: (a) pertanyaan durasi "Itu brp menit y?" DILARANG ditutup dengan
 * todong jadwal (kaset rusak); (b) klarifikasi kategori usia "16 bulan ikut
 * kids ceria?" harus dijawab statement-only dari katalog DB.
 */
describe('Summarizer — statement-only durasi & klarifikasi kategori usia (887216)', () => {
  it('pertanyaan durasi → STATEMENT-ONLY, larang todong jadwal', () => {
    const s = V3ConversationSummarizer.summarize(
      { genderGreeting: 'Bunda', selectedTreatment: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)' } as any,
      'Itu brp menit y?',
      { history: [], customerInput: 'Itu brp menit y?' }
    );
    expect(s).toContain('STATEMENT-ONLY RESPONSE');
    expect(s).toMatch(/DILARANG KERAS MENAMBAHKAN PERTANYAAN JADWAL/);
  });

  it('klarifikasi kategori usia → bahas BAYI/KIDS dari katalog, statement-only', () => {
    const s = V3ConversationSummarizer.summarize(
      { genderGreeting: 'Bunda', childProfile: { ageMonths: 16, symptoms: [] } } as any,
      '16 bulan ikut kids ceria?',
      { history: [], customerInput: '16 bulan ikut kids ceria?' }
    );
    expect(s).toMatch(/kategori usia/i);
    expect(s).toMatch(/BAYI.*KIDS|KIDS.*BAYI/);
    expect(s).toMatch(/STATEMENT-ONLY/);
  });

  it('anti-kaset: mengenali variasi asisten menanyakan jadwal ("hari atau tanggal")', () => {
    const s = V3ConversationSummarizer.summarize(
      { genderGreeting: 'Bunda' } as any,
      'baik bu',
      {
        history: [
          { role: 'assistant', content: 'bisa Bunda sebutkan hari atau tanggal yang diinginkan?' },
          { role: 'user', content: 'baik bu' },
        ],
        customerInput: 'baik bu',
      }
    );
    expect(s).toMatch(/menodong|hari apa|jadwal kunjungan/i);
  });
});
