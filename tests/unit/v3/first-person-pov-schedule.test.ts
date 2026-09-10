import { describe, it, expect } from 'vitest';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';

/**
 * Phase 4+5 (audit 337101) — POV first person KHUSUS penutup jadwal:
 * "kami bantu cekkan... segera kami infokan", TANPA pola lempar-tanggung-jawab.
 * LINGKUP SENGAJA SEMPIT: "Bidan kami" di konteks identitas treatment tetap sah.
 */
describe('First-Person POV Schedule Closing (narrow scope)', () => {
  it('persona memuat mandat POV + contoh first person', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('MANDAT POV FIRST PERSON KHUSUS PENUTUP JADWAL');
    expect(prompt).toContain('Nanti segera kami infokan ya bund');
    expect(prompt).toContain('Kalau hari ini kemungkinan jadwal kami penuh bunda');
  });

  it('contoh baku penutup jadwal BUKAN pola lempar ("oleh Bidan kami")', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).not.toContain('diinfokan kembali oleh Bidan kami');
    expect(prompt).not.toContain('ketersediaan jadwal Bidan yang ready');
  });

  it('"Bidan kami" identitas treatment TETAP sah (bukan larangan global)', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('dipijat oleh Bidan kami');
    expect(prompt).toContain('LINGKUP: mandat ini KHUSUS penutup pengecekan jadwal');
  });
});
