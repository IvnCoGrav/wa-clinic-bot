import { describe, it, expect, vi } from 'vitest';
import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';
import { executeGetCatalog } from '../../src/v3/tools/get-catalog.tool';
import { executeSaveReservation } from '../../src/v3/tools/save-reservation.tool';
import { executeEscalateHuman } from '../../src/v3/tools/escalate-human.tool';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

describe('V3 Native Agent Tools Suite', () => {
  describe('Tool: calculate_delivery', () => {
    it('harus menghitung jarak & ongkir promo untuk daerah Trosobo Sidoarjo', async () => {
      const result = await executeCalculateDelivery({
        locationText: 'Trosobo Sidoarjo',
      });

      expect(result.success).toBe(true);
      expect(result.distanceKm).toBeDefined();
      expect(result.distanceKm).toBeGreaterThan(10);
      expect(result.distanceKm).toBeLessThan(25);
      expect(result.ongkirNormal).toBeDefined();
      expect(result.ongkirPromo).toBeDefined();
      expect(result.isOutOfCoverage).toBe(false);
    });

    it('harus mencocokkan "Manukan Surabaya" ke Surabaya (Tandes, ~21 km), BUKAN Bojonegoro', async () => {
      const result = await executeCalculateDelivery({
        locationText: 'Manukan Surabaya',
      });

      expect(result.success).toBe(true);
      expect(result.isOutOfCoverage).toBe(false);
      expect(result.distanceKm).toBeDefined();
      expect(result.distanceKm).toBeLessThan(30); // Harus < 30 km (Surabaya Barat), bukan 165 km Bojonegoro!
    });

    it('harus menolak menghitung jarak jika customer hanya menyebut area luas seperti "Rumah d Surabaya barat" (isPrecise: false)', async () => {
      const result = await executeCalculateDelivery({
        locationText: 'Rumah d Surabaya barat',
      });

      expect(result.success).toBe(false);
      expect(result.isPrecise).toBe(false);
      expect(result.distanceKm).toBeUndefined();
      expect(result.message).toContain('terlalu luas');
    });

    it('harus menandai Out of Coverage untuk kota yang jauh di luar jangkauan (misal: Malang)', async () => {
      const result = await executeCalculateDelivery({
        locationText: 'Kepanjen Malang',
      });

      expect(result.success).toBe(true);
      expect(result.isOutOfCoverage).toBe(true);
      expect(result.distanceKm).toBeGreaterThan(30);
    });
  });

  describe('Tool: get_catalog_and_price', () => {
    it('harus merekomendasikan Pijat Bayi Pulih Ceria jika ada keluhan batuk / pilek / rewel', async () => {
      const result = await executeGetCatalog({
        category: 'BABY',
        symptoms: ['batuk', 'pilek', 'rewel'],
      });

      expect(result.success).toBe(true);
      expect(result.treatments.length).toBeGreaterThan(0);
      expect(result.treatments[0].name).toContain('Pulih Ceria');
      expect(result.treatments[0].promoPrice).toBe(70000);
      expect(result.recommendationReason).toContain('Pulih Ceria');
    });

    it('harus mengambil harga resmi untuk Pijat Bayi Ceria', async () => {
      const result = await executeGetCatalog({
        specificTreatmentName: 'Pijat Bayi Ceria',
      });

      expect(result.success).toBe(true);
      const ceria = result.treatments.find(t => t.name.includes('Pijat Bayi Ceria'));
      expect(ceria).toBeDefined();
      expect(ceria?.promoPrice).toBe(60000);
      expect(ceria?.originalPrice).toBe(80000);
    });
  });

  describe('Guardrail: OutputSanitizer', () => {
    it('harus membuang tag <think> dan monolog internal AI', () => {
      const rawWithThink = '<think>Kita perlu membalas Bunda dengan sopan dan ramah</think>Halo Bunda ! ✨ Ada yang bisa Bidan Yusi bantu?';
      const cleaned = OutputSanitizer.cleanOutboundReply(rawWithThink);
      expect(cleaned).toBe('Halo Bunda ! ✨ Ada yang bisa Bidan Yusi bantu?');
    });

    it('harus membuang monolog pembuka bahasa Indonesia "Kita perlu menyusun..."', () => {
      const rawMonologue = `Kita perlu menyusun balasan WhatsApp dari Bidan Yusi. Konteks: Bunda berkonsultasi mengenai si kecil yang sedang rewel.

Halo Bunda! Semoga Bunda dan si kecil selalu sehat ya 😊`;
      const cleaned = OutputSanitizer.cleanOutboundReply(rawMonologue);
      expect(cleaned).not.toContain('Kita perlu menyusun');
      expect(cleaned).toContain('Halo Bunda!');
    });

    it('harus menolak balasan terpotong satu huruf seperti "S"', () => {
      expect(OutputSanitizer.isValidReply('S')).toBe(false);
      expect(OutputSanitizer.isValidReply('.')).toBe(false);
      expect(OutputSanitizer.isValidReply('Halo Bunda 😊')).toBe(true);
    });
  });
});
