import { describe, it, expect, vi, afterEach } from 'vitest';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';

/**
 * Insiden 2026-10-03 (customer 62816331804): "Daerah Demak surabaya" →
 * crossCheckGazetteer menerima tebakan LLM kelurahan "Demak" (fiktif) dan
 * BLIND FALLBACK ke kecamatan "Semampir" yang TIDAK PERNAH disebut customer.
 * "Daerah Demak Jaya" → halusinasi kedua "Sukomanunggal". Kedua balasan
 * ditarik admin. Test ini mengunci guard anti-halusinasi.
 */
describe('Demak geocoding anti-hallucination (insiden 2026-10-03)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('RED→GREEN: kelurahan fiktif + kecamatan tak disebut customer → TOLAK (null), bukan Semampir', () => {
    const res = (geocodingService as any).crossCheckGazetteer(
      'Demak',
      'Semampir',
      'Kota Surabaya',
      'Kota Surabaya',
      false,
      'Daerah Demak surabaya'
    );
    expect(res).toBeNull();
  });

  it('kelurahan fiktif + kecamatan "Demak Jaya" yang tidak disebut → TOLAK (null), bukan Sukomanunggal', () => {
    const res = (geocodingService as any).crossCheckGazetteer(
      'Demak Jaya',
      'Sukomanunggal',
      'Kota Surabaya',
      'Kota Surabaya',
      false,
      'Daerah Demak Jaya'
    );
    expect(res).toBeNull();
  });

  it('kecamatan yang MEMANG disebut customer tetap sah (Semampir)', () => {
    const res = (geocodingService as any).crossCheckGazetteer(
      'TidakAdaKelurahanIni',
      'Semampir',
      'Kota Surabaya',
      'Kota Surabaya',
      false,
      'Saya di Kecamatan Semampir'
    );
    expect(res).not.toBeNull();
    expect(res.kecamatan).toBe('Semampir');
  });

  it('lookup authoritative (landmark) TIDAK terpengaruh guard', () => {
    const res = (geocodingService as any).crossCheckGazetteer(
      'Banjarkemantren',
      'Buduran',
      'Kabupaten Sidoarjo',
      'Kabupaten Sidoarjo',
      true
    );
    expect(res).not.toBeNull();
    expect(res.kelurahan).toBe('Banjarkemantren');
  });
});
