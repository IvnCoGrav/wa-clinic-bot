import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mock axios SEBELUM impor modul yang memakainya (tier kandidat Google).
vi.mock('axios', () => {
  const get = vi.fn();
  return { default: { get }, get };
});

import axios from 'axios';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';

const mockedGet = axios.get as unknown as ReturnType<typeof vi.fn>;

function googleOk(results: any[], status = 'OK') {
  mockedGet.mockResolvedValue({ data: { status, results } });
}

/** Satu result Google lengkap untuk Jl. Demak (Tembok Dukuh / Bubutan / Surabaya). */
function demakResult(overrides: Partial<{ kota: string; kel: string; kec: string; partial: boolean }> = {}) {
  const kota = overrides.kota ?? 'Kota Surabaya';
  const kel = overrides.kel ?? 'Tembok Dukuh';
  const kec = overrides.kec ?? 'Bubutan';
  return [{
    partial_match: overrides.partial ?? false,
    address_components: [
      { long_name: 'Jl. Demak', short_name: 'Jl. Demak', types: ['route'] },
      { long_name: kel, short_name: kel, types: ['administrative_area_level_4'] },
      { long_name: kec, short_name: kec, types: ['administrative_area_level_3'] },
      { long_name: kota, short_name: kota, types: ['administrative_area_level_2'] },
    ],
  }];
}

describe('Google geocode candidate tier (insiden Demak 2026-10-03)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.GOOGLE_GEOCODE_ALLOW_TEST = '1';
    process.env.GOOGLE_MAPS_API_KEY = 'live-key-simulated';
    (geocodingService as any).apiKey = 'live-key-simulated';
    mockedGet.mockReset();
  });
  afterEach(() => {
    delete process.env.GOOGLE_GEOCODE_ALLOW_TEST;
    process.env.GOOGLE_MAPS_API_KEY = '';
    (geocodingService as any).apiKey = '';
    vi.restoreAllMocks();
  });

  it('"Daerah Demak surabaya" → kandidat Bubutan (BUKAN presisi, wajib konfirmasi)', async () => {
    googleOk(demakResult());
    const res: any = await geocodingService.geocodeText('Daerah Demak surabaya');
    expect(res.candidateFrom).toBe('google');
    expect(res.isPrecise).toBe(false);
    expect(res.kelurahan).toBe('Tembok Dukuh');
    expect(res.kecamatan).toBe('Bubutan');
    expect(res.kota).toBe('Kota Surabaya');
  });

  it('kota respons di luar cakupan (Kab. Demak) → DITOLAK (anti Demak Jateng)', async () => {
    googleOk(demakResult({ kota: 'Kabupaten Demak', kel: 'TidakAda', kec: 'TidakAda' }));
    const res: any = await geocodingService.geocodeText('Daerah Demak');
    expect(res.candidateFrom).toBeUndefined();
    expect(res.isPrecise).toBe(false);
    expect(res.kecamatan).toBeUndefined();
  });

  it('partial_match tetap kandidat (konfirmasi), tidak pernah presisi', async () => {
    googleOk(demakResult({ partial: true }));
    const res: any = await geocodingService.geocodeText('daerah demak jaya surabaya');
    expect(res.candidateFrom).toBe('google');
    expect(res.isPrecise).toBe(false);
  });

  it('kelurahan Google yang TIDAK eksis di gazetteer → ditolak (null)', async () => {
    googleOk(demakResult({ kel: 'WilayahFiktif', kec: 'Semampir' }));
    const res: any = await geocodingService.geocodeText('daerah wilayahfiktif surabaya');
    expect(res.candidateFrom).toBeUndefined();
    expect(res.isPrecise).toBe(false);
  });

  it('tanpa API key → tier mati total (fail-closed, tanpa network)', async () => {
    (geocodingService as any).apiKey = '';
    process.env.GOOGLE_MAPS_API_KEY = '';
    const res: any = await geocodingService.geocodeText('Jl Demak Surabaya');
    expect(res.candidateFrom).toBeUndefined();
    expect(mockedGet).not.toHaveBeenCalled();
  });
});

describe('Konfirmasi kandidat lokasi (cross-turn, state-gated)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.GOOGLE_MAPS_API_KEY = '';
    (geocodingService as any).apiKey = '';
    mockedGet.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('kandidat + afirmasi customer → dipromosikan presisi TANPA geocode ulang', async () => {
    const res: any = await executeCalculateDelivery({
      locationText: 'Daerah Demak surabaya',
      pendingLocation: { kelurahan: 'Tembok Dukuh', kecamatan: 'Bubutan', kota: 'Kota Surabaya', lat: -7.2547952, lng: 112.7219163 },
      incomingText: 'iya betul',
    });
    expect(res.success).toBe(true);
    expect(res.kelurahan).toBe('Tembok Dukuh');
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('kandidat + pesan NEGASI → tidak dipromosikan (alur normal, tanpa Semampir)', async () => {
    process.env.GOOGLE_GEOCODE_ALLOW_TEST = '1';
    process.env.GOOGLE_MAPS_API_KEY = 'live-key-simulated';
    (geocodingService as any).apiKey = 'live-key-simulated';
    // Mock Google mengembalikan kelurahan fiktif → guard gazetteer menolak.
    googleOk([{ partial_match: false, address_components: [
      { long_name: 'WilayahFiktif', short_name: 'WilayahFiktif', types: ['administrative_area_level_4'] },
      { long_name: 'Semampir', short_name: 'Semampir', types: ['administrative_area_level_3'] },
      { long_name: 'Kota Surabaya', short_name: 'Kota Surabaya', types: ['administrative_area_level_2'] },
    ] }]);
    const res: any = await executeCalculateDelivery({
      locationText: 'Daerah WilayahFiktif Surabaya',
      pendingLocation: { kelurahan: 'Tembok Dukuh', kecamatan: 'Bubutan', kota: 'Kota Surabaya', lat: -7.25, lng: 112.72 },
      incomingText: 'bukan, itu salah',
    });
    expect(res.kecamatan).not.toBe('Semampir');
    expect(res.success).toBe(false);
  });

  it('kandidat Google → balasan pertanyaan verifikasi (bukan pernyataan), tanpa nominal', async () => {
    process.env.GOOGLE_GEOCODE_ALLOW_TEST = '1';
    process.env.GOOGLE_MAPS_API_KEY = 'live-key-simulated';
    (geocodingService as any).apiKey = 'live-key-simulated';
    googleOk(demakResult());
    const res: any = await executeCalculateDelivery({ locationText: 'Daerah Demak surabaya' });
    expect(res.success).toBe(false);
    expect(res.suggestedTemplateReply).toMatch(/Apakah.*maksud/i);
    expect(res.suggestedTemplateReply).toMatch(/Tembok Dukuh|Bubutan/);
    expect(res.message).not.toMatch(/Rp\s*[\d.]+/);
    expect(res.__internalPendingLocation?.kelurahan).toBe('Tembok Dukuh');
  });
});
