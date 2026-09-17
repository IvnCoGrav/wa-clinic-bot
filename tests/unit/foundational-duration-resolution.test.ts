import { describe, it, expect } from 'vitest';
import { extractDurationMinutes } from '../../packages/admin-dashboard/src/utils/durationCalculator';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

/**
 * Resolusi durasi fondasional: layanan utama vs add-on berbasis katalog dinamis.
 * Tanpa asumsi flat 60 menit per item dan tanpa menyebut nama pasien.
 */
describe('Resolusi durasi fondasional (main vs add-on)', () => {
  it('Pijat Bayi Pulih Ceria + Sinar Moksa tepat 75 menit (bukan 135m)', () => {
    expect(extractDurationMinutes('Pijat Bayi Pulih Ceria + Sinar Moksa')).toBe(75);
    expect(treatmentCatalogService.resolveCanonicalDuration('Pijat Bayi Pulih Ceria + Sinar Moksa')).toBe(75);
  });

  it('Pijat Bayi Ceria + Cukur Rambut Bayi tepat 75 menit (bukan 135m)', () => {
    expect(extractDurationMinutes('Pijat Bayi Ceria + Cukur Rambut Bayi')).toBe(75);
    expect(treatmentCatalogService.resolveCanonicalDuration('Pijat Bayi Ceria + Cukur Rambut Bayi')).toBe(75);
  });

  it('Pijat Bayi Pulih Ceria + Nebulizer tepat 80 menit (bukan 135m)', () => {
    expect(extractDurationMinutes('Pijat Bayi Pulih Ceria + Nebulizer')).toBe(80);
    expect(treatmentCatalogService.resolveCanonicalDuration('Pijat Bayi Pulih Ceria + Nebulizer')).toBe(80);
  });

  it('Main + 2 add-on tepat 90 menit (bukan 195m)', () => {
    expect(extractDurationMinutes('Pijat Bayi Pulih Ceria + Sinar Moksa + Cukur Rambut Bayi')).toBe(90);
    expect(treatmentCatalogService.resolveCanonicalDuration('Pijat Bayi Pulih Ceria + Sinar Moksa + Cukur Rambut Bayi')).toBe(90);
  });

  it('Dua treatment utama ikut katalog: Ceria 40m + Prenatal 60m + buffer kunjungan 20m = 120 menit', () => {
    // Deviasi sadar dari plan (135 via asumsi flat-60 — asumsi yang justru dihapus):
    // kebenaran katalog adalah Ceria 40m & Prenatal 60m + buffer 20m per kunjungan.
    expect(treatmentCatalogService.resolveCanonicalDuration('Pijat Bayi Ceria + Prenatal Massage')).toBe(120);
  });

  it('Tag eksplisit [Total 75m] dan [Total 60m + Buffer 15m = 75m] tetap diprioritaskan', () => {
    expect(extractDurationMinutes('Pijat Bayi Pulih Ceria + Sinar Moksa [Total 75m]')).toBe(75);
    expect(extractDurationMinutes('Pijat Bayi Pulih Ceria + Sinar Moksa [Total 60m + Buffer 15m = 75m]')).toBe(75);
    expect(treatmentCatalogService.resolveCanonicalDuration('Pijat Bayi Pulih Ceria + Sinar Moksa [Total 75m]')).toBe(75);
  });

  it('Metadata audiens structured DB tidak boleh dipecah jadi item hantu (Usia/Kehamilan)', () => {
    // Format asli DB: label audiens + parenthetical metadata tidak boleh dihitung sebagai layanan.
    const raw = 'Baby: pijat bayi pulih ceria + sinar moksa (Bayi: m. kaysan al hanan, Usia: 21 bulan)';
    expect(extractDurationMinutes(raw)).toBe(75);
    expect(treatmentCatalogService.resolveCanonicalDuration(raw)).toBe(75);

    // Item tunggal main treatment: durasi katalog 40m + buffer kunjungan 20m = 60m.
    const single = 'Baby: Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung) (Bayi: Joyceline, Usia: 1 Tahun)';
    expect(treatmentCatalogService.resolveCanonicalDuration(single)).toBe(60);
    expect(extractDurationMinutes(single)).toBe(60);

    // Add-on tunggal tidak menambah buffer kunjungan (Sinar Moksa = 15m).
    const addonOnly = 'Baby: Sinar Moksa (Add-on) (Bayi: Ryu, Usia: 3 bulan)';
    expect(treatmentCatalogService.resolveCanonicalDuration(addonOnly)).toBe(15);
  });

  it('Urutan kata berbeda tetap cocok katalog (Pijat Ceria Bayi -> Pijat Bayi Ceria 40m + Kids 45m + buffer 20m)', () => {
    expect(treatmentCatalogService.resolveCanonicalDuration('Combination: Pijat Ceria Bayi, Pijat Ceria Kids')).toBe(105);
  });

  it('resolveDurationBreakdown memberi flag confident=false saat item tak dikenali', () => {
    const unknown = treatmentCatalogService.resolveDurationBreakdown('Layanan Misterius Tanpa Katalog');
    expect(unknown.confident).toBe(false);

    const known = treatmentCatalogService.resolveDurationBreakdown('Pijat Bayi Pulih Ceria + Sinar Moksa');
    expect(known.confident).toBe(true);
    expect(known.totalMinutes).toBe(75);
    expect(known.matchedItemIds.length).toBe(2);
  });
});
