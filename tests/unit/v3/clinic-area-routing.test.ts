import { describe, it, expect } from 'vitest';
import { ContextGrounder } from '../../../src/v3/agent/pipeline/context-grounder';

/**
 * Fondasi 3 — Clinic Area Signal Routing (sesi 983902).
 * hasClinicAreaSignal mendeteksi pertanyaan area/wilayah secara deterministik.
 * Jika aktif + lokasi belum diketahui → Call 1 diarahkan ke get_clinic_policy_faq(homebase_and_coverage).
 * Menghindari rute symptoms-therapy (kedua kalinya ke hulu pantai dengan perahu dayung).
 */
describe('Clinic Area Routing Signal (Fondasi 3)', () => {
  it('mendeteksi semua pola area — positif', () => {
    const positives = [
      'kak ini area mana',
      'wilayah mana ya',
      'cover area ke mana aja',
      'cakupan area mana kak',
      'bisa dipanggil ke mana aja',
      'jangkauan mana aja kak',
      'daerah mana yang area',
    ];
    for (const t of positives) {
      expect(ContextGrounder.hasClinicAreaSignal(t), `expected true: "${t}"`).toBe(true);
    }
  });

  it('bukan area: pertanyaan harga, jadwal, keluhan', () => {
    const negatives = [
      'berapa harga pijat bayi',
      'jadwalnya kapan',
      'anak saya batuk pilek',
      'kak mau tanya treatment',
      'lagi flek kuning',
      '',
    ];
    for (const t of negatives) {
      expect(ContextGrounder.hasClinicAreaSignal(t), `expected false: "${t}"`).toBe(false);
    }
  });

  it('case-insensitive', () => {
    expect(ContextGrounder.hasClinicAreaSignal('KAK INI AREA MANA')).toBe(true);
    expect(ContextGrounder.hasClinicAreaSignal('Wilayah Mana Aja Kak')).toBe(true);
  });

  it('teks gabungan dengan area + keluhan tetap terdeteksi', () => {
    // Area routing harus menang meski ada kata lain
    expect(ContextGrounder.hasClinicAreaSignal('kak ini area mana? saya di sidoarjo')).toBe(true);
    expect(ContextGrounder.hasClinicAreaSignal('cover area ke mana aja kak, saya di waru')).toBe(true);
  });

  it('kata "area" tanpa pola tidak false-positive', () => {
    expect(ContextGrounder.hasClinicAreaSignal('ada area yang sakit')).toBe(false);
    expect(ContextGrounder.hasClinicAreaSignal('area treatment apa yang cocok')).toBe(false);
  });
});
