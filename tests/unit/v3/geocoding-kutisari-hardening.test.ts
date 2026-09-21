import { describe, it, expect } from 'vitest';
import { GeocodingService } from '../../../src/integrations/google-maps/geocoding';
import { executeCalculateDelivery } from '../../../src/v3/tools/calculate-delivery.tool';

/**
 * Agenda 1 (Fase 4 Master Plan) — Geocoding Hardening & Gazetteer Wilayah Utama.
 * Adu kasus Sesi 477412 Turn 3 & Issue #70: "Kutisari Indah" DILARANG ter-resolve
 * ke "Kutusari" Sukomanunggal (Surabaya Barat); pesan tool DILARANG menganjurkan
 * share location (Aturan Emas 21). Offline-safe (local-first, tanpa network).
 */
describe('Geocoding Kutisari Hardening (local-first)', () => {
  const geocodingService = new GeocodingService();

  it('"Kutisari Indah" -> Kel. Kutisari, Kec. Tenggilis Mejoyo (BUKAN Sukomanunggal)', async () => {
    const result = await geocodingService.geocodeText('Kutisari Indah');
    expect(result.isPrecise).toBe(true);
    expect(result.kelurahan).toBe('Kutisari');
    expect(result.kecamatan).toBe('Tenggilis Mejoyo');
    expect(result.kota?.toLowerCase()).toContain('surabaya');
    expect(result.kecamatan).not.toBe('Sukomanunggal');
    // Kunci Tier-0 landmark (bukan sekadar fuzzy gazetteer): alamat housing
    // eksplisit agar fallback Google/LLM tidak pernah dikonsultasikan.
    expect(result.formattedAddress).toMatch(/kutisari indah/i);
  });

  it('"Perumahan Rewwin" -> Kel. Wedoro, Kec. Waru, Kab. Sidoarjo', async () => {
    const result = await geocodingService.geocodeText('Perumahan Rewwin');
    expect(result.isPrecise).toBe(true);
    expect(result.kelurahan).toBe('Wedoro');
    expect(result.kecamatan).toBe('Waru');
    expect(result.kota?.toLowerCase()).toContain('sidoarjo');
  });

  it('"Pondok Candra" -> Kel. Tambaksumur, Kec. Waru, Kab. Sidoarjo', async () => {
    const result = await geocodingService.geocodeText('Pondok Candra');
    expect(result.isPrecise).toBe(true);
    expect(result.kelurahan).toBe('Tambaksumur');
    expect(result.kecamatan).toBe('Waru');
    expect(result.kota?.toLowerCase()).toContain('sidoarjo');
  });

  it('kecamatan ambigu ("Sedati") -> pesan TANPA anjuran share location (Aturan 21)', async () => {
    const out = await executeCalculateDelivery({ locationText: 'Sedati' });
    expect(out.success).toBe(false);
    expect(out.message).toMatch(/kelurahan|perumahan|patokan/i);
    // Kontrak anti-solicitation: DILARANG pola "(atau ... share location)" /
    // "tawarkan ... share location". Klausa penjaga "(tanpa menanyakan ...
    // share location)" SENGAJA dipertahankan sebagai pagar instruksi.
    expect(out.message).not.toMatch(/\(atau[^)]*share location/i);
    expect(out.message).not.toMatch(/tawarkan[^.]*share location/i);
    expect(out.message).toMatch(/tanpa menanyakan/i);
  });

  it('SESI 662917: "Wonokromo" ambigu kecamatan -> suggestedTemplateReply TANPA anjuran share location', async () => {
    const out = await executeCalculateDelivery({ locationText: 'Wonokromo' });
    expect(out.success).toBe(false);
    expect(out.suggestedTemplateReply).toBeTruthy();
    // Replay Turn-3 sesi 662917 di level tool: balasan customer-facing
    // (suggestedTemplateReply → DeliveryFastPath verbatim) WAJIB bebas
    // solicitation shareloc — bukan hanya message internal untuk LLM.
    expect(out.suggestedTemplateReply).toMatch(/kelurahan|desa|mana ya/i);
    expect(out.suggestedTemplateReply).not.toMatch(/share\s*loc(?:ation|k)?|sharelock/i);
    expect(out.suggestedTemplateReply).not.toMatch(/Atau jika berkenan/i);
  });

  it('suggestedTemplateReply semua hasil tool bebas solicitation shareloc (kecamatan tanpa koordinat)', async () => {
    const out = await executeCalculateDelivery({ locationText: 'Sedati' });
    if (out.suggestedTemplateReply) {
      expect(out.suggestedTemplateReply).not.toMatch(/share\s*loc(?:ation|k)?|sharelock/i);
      expect(out.suggestedTemplateReply).not.toMatch(/Atau jika berkenan/i);
    }
  });
});
