import { describe, it, expect } from 'vitest';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';

describe('Geocoding Plus Code Normalization (Adversarial Multi-Variant)', () => {
  it('1. Mengenali toponimi ketika Plus Code berada di awal alamat Google Maps Place', async () => {
    const res = await geocodingService.geocodeText('JP96+9WG Asian Conveksi, Bohar, Kec. Taman, Kabupaten Sidoarjo, Jawa Timur 61257');
    expect(res.kelurahan).toBe('Bohar');
    expect(res.kecamatan).toBe('Taman');
    expect(res.isPrecise).toBe(true);
  });

  it('2. Mengenali toponimi ketika Plus Code berada di akhir teks alamat', async () => {
    const res = await geocodingService.geocodeText('Asian Conveksi, Bohar, Kec. Taman JP96+9WG');
    expect(res.kelurahan).toBe('Bohar');
    expect(res.kecamatan).toBe('Taman');
    expect(res.isPrecise).toBe(true);
  });

  it('3. Mengenali toponimi dengan Plus Code huruf kecil tanpa koma', async () => {
    const res = await geocodingService.geocodeText('jp96+9wg bohar taman');
    expect(res.kelurahan).toBe('Bohar');
    expect(res.kecamatan).toBe('Taman');
    expect(res.isPrecise).toBe(true);
  });

  it('4. Mengenali toponimi dengan Plus Code dan satu kelurahan saja', async () => {
    const res = await geocodingService.geocodeText('JP96+9WG, Bohar');
    expect(res.kelurahan).toBe('Bohar');
    expect(res.isPrecise).toBe(true);
  });

  it('5. Mengenali toponimi wilayah Surabaya dengan Plus Code berbeda di tengah kalimat', async () => {
    const res = await geocodingService.geocodeText('Kebraon Utama AU 18 7P28+VX Surabaya');
    expect(res.kelurahan).toBe('Kebraon');
    expect(res.kecamatan).toMatch(/Karang\s?Pilang/i);
    expect(res.isPrecise).toBe(true);
  });

  it('6. Menangani kalimat customer yang menyisipkan Plus Code dan kelurahan di Sidoarjo', async () => {
    const res = await geocodingService.geocodeText('titik jemput 8Q4F+M3 Berbek Waru Sidoarjo dekat stasiun');
    expect(res.kelurahan).toBe('Berbek');
    expect(res.kecamatan).toBe('Waru');
    expect(res.isPrecise).toBe(true);
  });

  it('7. Menangani Plus Code tunggal tanpa informasi toponimi secara aman (fail-closed)', async () => {
    const res = await geocodingService.geocodeText('JP96+9WG');
    expect(res.isPrecise).toBe(false);
  });
});
