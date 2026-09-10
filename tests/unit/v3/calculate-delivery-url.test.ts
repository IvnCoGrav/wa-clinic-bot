import { describe, it, expect } from 'vitest';
import { executeCalculateDelivery } from '../../../src/v3/tools/calculate-delivery.tool';

/**
 * Phase 0 — Location Shortlink Resolution: link Google Maps di chat langsung
 * dihitung jarak & ongkirnya tanpa menodong shareloc ulang.
 * Offline-safe: URL berkoordinat langsung ter-resolve tanpa network
 * (extractCoordinatesFromUrlString); shortlink asli diuji graceful-fallback.
 */
describe('Calculate Delivery URL Resolution', () => {
  it('URL maps berkoordinat langsung -> isPrecise + ongkir valid (tanpa network)', async () => {
    const out = await executeCalculateDelivery({
      locationText: 'https://www.google.com/maps/@-7.340000,112.720000,17z',
    });
    expect(out.success).toBe(true);
    expect(out.isPrecise).toBe(true);
    expect(typeof out.distanceKm).toBe('number');
    expect(typeof out.ongkirNormal).toBe('number');
    expect(typeof out.ongkirPromo).toBe('number');
    expect(out.message).toContain('share location berhasil diidentifikasi');
  });

  it('share.google shortlink offline -> graceful (tidak crash, jalur teks biasa)', async () => {
    const out = await executeCalculateDelivery({
      locationText: 'https://share.google/Ef30htzIpVPKEwdWP',
    });
    // Tanpa network, resolve gagal → jatuh ke geocoding teks (tetap objek valid)
    expect(typeof out.success).toBe('boolean');
    expect(typeof out.message).toBe('string');
    expect(out.message.length).toBeGreaterThan(0);
  });

  it('teks biasa tetap lewat jalur lama (broad region Gedangan ditanya kelurahan)', async () => {
    const out = await executeCalculateDelivery({ locationText: 'Gedangan' });
    expect(out.success).toBe(false);
    expect(out.message).toMatch(/kecamatan|kelurahan/i);
  });
});
