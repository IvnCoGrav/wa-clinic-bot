import { describe, it, expect } from 'vitest';
import { PersonaPromptBuilder } from '../../src/v3/agent/persona';
import { V3ConversationSummarizer } from '../../src/v3/state/conversation-summarizer';

/**
 * Masalah 1 & 2 sesi 435731: over-questioning/todong jadwal berulang dan
 * halusinasi domisili Waru. Prompt + summarizer wajib memuat guard eksplisit.
 */
describe('V3 anti-todong jadwal & anti-halusinasi domisili (sesi 435731)', () => {
  const prompt = () =>
    PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);

  it('tidak ada lagi instruksi "Closing CTA WAJIB" penodong jadwal', () => {
    const p = prompt();
    expect(p).not.toContain('Closing CTA WAJIB');
    // Frasa CTA lama hanya boleh muncul di dalam kalimat larangan (DILARANG),
    // bukan sebagai instruksi penutup yang diwajibkan.
    const hits = p.split('\n').filter((line) => line.includes('Mau kami bantu jadwalkan untuk treatment'));
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('DILARANG');
  });

  it('memuat panduan statement-only untuk pertanyaan teknis', () => {
    expect(prompt()).toContain('TANPA MENAMBAHKAN PERTANYAAN JADWAL');
    expect(prompt()).toContain('STATEMENT-ONLY RESPONSE');
  });

  it('contoh durasi menutup dengan pernyataan, tanpa todong jadwal', () => {
    const p = prompt();
    const idx = p.indexOf('Contoh (Customer tanya durasi pijat bayi');
    expect(idx).toBeGreaterThan(0);
    const slice = p.slice(idx, idx + 700);
    expect(slice).toContain('40 menit');
    expect(slice).not.toContain('Mau kami bantu jadwalkan');
  });

  it('Waru ditegaskan sebagai basecamp; dilarang mengasumsikan domisili customer', () => {
    const p = prompt();
    expect(p).toContain('Waru');
    expect(p).toContain('DILARANG mengasumsikan customer berdomisili di Waru');
    expect(p).toContain('DILARANG KERAS mengasumsikan customer berdomisili di Waru/kecamatan mana pun');
  });

  it('menyebut "Admin CS" hanya di baris larangan', () => {
    const outsideBan = prompt()
      .split('\n')
      .filter((line) => line.includes('Admin CS') && !line.includes('DILARANG SEBUT'));
    expect(outsideBan).toEqual([]);
  });

  it('summarizer: jadwal disepakati → larangan eksplisit tanya hari lagi', () => {
    const s = V3ConversationSummarizer.summarize(
      {
        genderGreeting: 'Bunda',
        booking: { preferredDate: 'Sabtu', isConfirmed: false },
      } as any,
      'berapa ya totalnya',
      { history: [], customerInput: 'berapa ya totalnya' }
    );
    expect(s).toContain('sudah disepakati dan tercatat');
    expect(s).toContain('sudah final disepakati');
  });

  it('summarizer: cooldown jadwal tetap aktif walau ada sebutan hari bila jadwal final', () => {
    const s = V3ConversationSummarizer.summarize(
      {
        genderGreeting: 'Bunda',
        booking: { preferredDate: 'Sabtu', reservationId: 'res-1', isConfirmed: false },
      } as any,
      'kalau di hari sabtu gimana?',
      {
        history: [
          { role: 'assistant', content: 'Rencana mau kami bantu jadwalkan di hari apa ya Bunda?' },
          { role: 'user', content: 'kalau di hari sabtu gimana?' },
        ],
        customerInput: 'kalau di hari sabtu gimana?',
      }
    );
    expect(s).toContain('tanpa menodong');
  });
});
