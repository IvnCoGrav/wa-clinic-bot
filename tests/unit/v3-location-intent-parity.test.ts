import { describe, it, expect } from 'vitest';
import { extractFastIntents } from '../../src/v3/agent/persona';

/**
 * C.2a (audit #199) — intent provide_location WAJIB word-boundary.
 * Kata berimbuhan/gejala (batuk, tertarik, sekarang, kembali) DILARANG
 * memicu provide_location (kelas bug "tertarik"→Kecamatan Tarik).
 */
describe('extractFastIntents — provide_location anti-false-positive substring', () => {
  it('kata berimbuhan/gejala TIDAK memicu provide_location', () => {
    expect(extractFastIntents('anak saya batuk pilek semalaman')).not.toContain('provide_location');
    expect(extractFastIntents('saya tertarik dengan layanan home-treatment')).not.toContain('provide_location');
    expect(extractFastIntents('mau booking untuk sekarang ya')).not.toContain('provide_location');
    expect(extractFastIntents('saya kembali ke sini')).not.toContain('provide_location');
  });

  it('nama daerah asli tetap memicu provide_location', () => {
    expect(extractFastIntents('rumah saya di Sedati')).toContain('provide_location');
    expect(extractFastIntents('di Tarik Sidoarjo')).toContain('provide_location');
    expect(extractFastIntents('tinggal di Tenggilis Mejoyo')).toContain('provide_location');
  });
});
