import { describe, it, expect } from 'vitest';
import { PersonaPromptBuilder } from '../../src/v3/agent/persona';

/**
 * Sesi 309274 — Direct reply Call 1 (tanpa tool, temp 0.2) kehilangan persona:
 * tidak ada sapaan/perkenalan Turn-0 dan gaya birokratis
 * ("Sebelum melanjutkan, bolehkah ... Ini penting untuk ...").
 * Akar: buildRouterPrompt (ramping untuk routing) tidak memuat panduan
 * direct-reply. Fix: panduan Turn-0 + anti-birokrasi di level prompt router.
 * Uji kontrak prompt (deterministik, tanpa LLM).
 */
describe('Call-1 Direct Reply Natural (sesi 309274)', () => {
  const baseSession = { genderGreeting: 'Bunda' } as any;

  it('Turn-0: router memandu sapaan + perkenalan resmi Bidan Yusi', () => {
    const prompt = PersonaPromptBuilder.buildRouterPrompt(baseSession, false);
    expect(prompt).toContain('Halo Bunda!');
    expect(prompt).toContain('Perkenalkan, saya Bidan Yusi');
    expect(prompt).toContain('Kala Moms and Baby Spa');
  });

  it('Turn-0: router melarang frasa birokratis korporat', () => {
    const prompt = PersonaPromptBuilder.buildRouterPrompt(baseSession, false);
    expect(prompt).toContain('Sebelum melanjutkan');
    expect(prompt).toContain('ANTI-BIROKRASI');
    expect(prompt).toContain('Bisa banget Bunda');
  });

  it('chat lanjutan: DILARANG mengulang sapaan/perkenalan Turn-0', () => {
    const prompt = PersonaPromptBuilder.buildRouterPrompt(baseSession, true);
    expect(prompt).toContain('DILARANG mengulang sapaan');
    expect(prompt).not.toContain('AWALI dengan sapaan hangat');
  });

  it('direct reply memuat aturan emas: jam, durasi, harga, kata ganti (sesi 188034)', () => {
    const prompt = PersonaPromptBuilder.buildRouterPrompt(baseSession, false);
    expect(prompt).toContain('ATURAN EMAS MUTLAK BALASAN LANGSUNG');
    expect(prompt).toContain('DILARANG MENANYAKAN JAM KUNJUNGAN SPESIFIK');
    expect(prompt).toContain('DILARANG MENYEBUT DURASI MENIT');
    expect(prompt).toContain('DILARANG MENYEBUT HARGA/BIAYA');
    expect(prompt).toContain('"kami"/"Bidan kami"');
  });

  it('aturan 5b: lokasi diketahui -> DILARANG tanya lokasi lagi (sesi 310843)', () => {
    const prompt = PersonaPromptBuilder.buildRouterPrompt(baseSession, true);
    expect(prompt).toContain('DILARANG KERAS menanyakan lokasi/daerah rumah lagi');
    expect(prompt).toContain('tanyakan rencana perawatan yang diinginkan');
  });
});
