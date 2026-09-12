import { describe, it, expect } from 'vitest';
import { getGazetteerCoordinates } from '../../src/utils/gazetteer';
import { ARTERY_CORRIDORS, resolveArteryCorridor } from '../../src/config/landmarks';

/**
 * Plan 6 FASE 3 (Issue #21) — Koridor arteri tanpa "Jl." terpetakan ke
 * kelurahan induk tanpa menodong customer. Koordinat selalu dari dataset
 * gazetteer (single source); kamus hanya memetakan nama → kelurahan.
 */
describe('Artery Corridor Gazetteer (Issue #21)', () => {
  it('"Saya di Klampis Jaya" langsung ter-resolve ke zona Sukolilo', () => {
    const hit = getGazetteerCoordinates('Saya di Klampis Jaya');
    expect(hit).not.toBeNull();
    expect(hit?.kecamatan.toLowerCase()).toBe('sukolilo');
    expect(hit?.lat).toBeDefined();
    expect(hit?.lng).toBeDefined();
  });

  it('"daerah bronggalan" langsung ter-resolve ke zona Tambaksari', () => {
    const hit = getGazetteerCoordinates('daerah bronggalan');
    expect(hit).not.toBeNull();
    expect(hit?.kecamatan.toLowerCase()).toBe('tambaksari');
  });

  it('seluruh 10 koridor ter-resolve ke koordinat dataset (ground-truth)', () => {
    expect(ARTERY_CORRIDORS).toHaveLength(10);
    const failures: string[] = [];
    for (const c of ARTERY_CORRIDORS) {
      const hit = getGazetteerCoordinates(`Saya di ${c.key}`);
      if (!hit || hit.lat == null || hit.lng == null) {
        failures.push(c.key);
        continue;
      }
      expect(hit.kecamatan.toLowerCase()).toBe(c.kecamatan.toLowerCase());
    }
    expect(failures).toEqual([]);
  });

  it('resolveArteryCorridor: jalan raya cocok; teks tak dikenal -> null; "Darmo Permai" BUKAN koridor', () => {
    // Jl. Raya Darmo (jalan raya) -> koridor raya darmo (Darmo/Wonokromo)
    expect(resolveArteryCorridor('Jl. Raya Darmo No 10')?.kecamatan.toLowerCase()).toBe('wonokromo');
    // Perumahan Darmo Permai TIDAK mengandung frasa "raya darmo" -> bukan koridor
    // (ranah POPULAR_LANDMARKS: Pradah Kalikendal — tanpa konflik)
    expect(resolveArteryCorridor('Darmo Permai')).toBeNull();
    expect(resolveArteryCorridor('jalan tidak dikenal xyz')).toBeNull();
    expect(resolveArteryCorridor('KERTAJAYA INDAH')?.kelurahan.toLowerCase()).toBe('kertajaya');
    expect(resolveArteryCorridor('  mayjen   sungkono  ')?.kecamatan.toLowerCase()).toBe('dukuh pakis');
  });

  it('perilaku eksisting lestari: kelurahan eksak tetap ter-resolve', () => {
    const hit = getGazetteerCoordinates('Keputih');
    expect(hit).not.toBeNull();
    expect(hit?.kecamatan.toLowerCase()).toBe('sukolilo');
  });
});
