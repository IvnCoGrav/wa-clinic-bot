import { describe, it, expect } from 'vitest';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { PersonaComposer } from '../../src/slot-engine/persona-composer';
import { GroundingComposer } from '../../src/slot-engine/grounding-composer';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';

describe('Dynamic Architecture & Anti-Hardcode (Single Source of Truth) Test Suite', () => {
  describe('1. Dynamic Service Duration Generator', () => {
    it('harus menghasilkan ringkasan durasi dinamis dari seluruh layanan aktif', () => {
      const summary = treatmentCatalogService.getServiceDurationSummary();
      expect(summary).toBeDefined();
      expect(summary).toContain('Pijat Bayi Ceria');
      expect(summary).toContain('~40 menit');
      expect(typeof summary).toBe('string');
    });

    it('harus mencerminkan perubahan durasi jika ada layanan baru atau durasi diubah', () => {
      const services = treatmentCatalogService.getAllServices();
      expect(services.length).toBeGreaterThan(0);
      for (const s of services) {
        expect(s.durationMinutes).toBeGreaterThan(0);
        expect(s.ageTier.label).toBeDefined();
      }
    });
  });

  describe('2. Dynamic Symptom Matcher in Catalog Service', () => {
    it('harus mencocokkan keluhan batuk / pilek ke layanan terapi bapil secara dinamis', () => {
      const matched = treatmentCatalogService.matchServicesBySymptoms(['batuk', 'pilek']);
      expect(matched.length).toBeGreaterThan(0);
      const names = matched.map((m) => m.name.toLowerCase());
      expect(names.some((n) => n.includes('pulih') || n.includes('bapil') || n.includes('terapi'))).toBe(true);
    });

    it('harus mencocokkan keluhan nafsu makan / gtm ke layanan nafsu makan secara dinamis', () => {
      const matched = treatmentCatalogService.matchServicesBySymptoms(['nafsu', 'makan']);
      expect(matched.length).toBeGreaterThan(0);
      const names = matched.map((m) => m.name.toLowerCase());
      expect(names.some((n) => n.includes('lahap') || n.includes('makan'))).toBe(true);
    });

    it('harus mencocokkan keluhan laktasi / ASI ke layanan laktasi secara dinamis', () => {
      const matched = treatmentCatalogService.matchServicesBySymptoms(['laktasi', 'asi']);
      expect(matched.length).toBeGreaterThan(0);
      const names = matched.map((m) => m.name.toLowerCase());
      expect(names.some((n) => n.includes('laktasi') || n.includes('oksitosin'))).toBe(true);
    });
  });

  describe('3. Pure PersonaComposer (Bebas Hardcode Bisnis)', () => {
    it('getClinicalAndOperationalFacts HANYA memuat aturan klinis murni tanpa hardcode durasi menit statis', () => {
      const facts = PersonaComposer.getClinicalAndOperationalFacts();
      expect(facts).toContain('PANDUAN USIA NEWBORN (MUTLAK)');
      expect(facts).toContain('100% AMAN dan SANGAT DIANJURKAN');
      expect(facts).toContain('Kualifikasi Bidan');
      
      // Pastikan tidak ada teks hardcode nama layanan spesifik
      expect(facts).not.toContain('*Pijat Pulih Ceria*');
      expect(facts).not.toContain('*Pijat Bayi Ceria*');
      expect(facts).not.toContain('*Pijat Lahap Juara*');
      expect(facts).not.toContain('Paket Laktasi: ~50-55 menit');
    });

    it('composeSlotGeneratorPrompt menggabungkan durasi dan fakta operasional dinamis secara benar', () => {
      const prompt = PersonaComposer.composeSlotGeneratorPrompt({
        deliveryFactsText: '• Lokasi: Tambakoso',
        ageText: '• Usia Anak: 1 bulan',
        catalogText: '- Pijat Bayi Ceria (Tarif Promo: Rp 60.000)',
        durationSummaryText: '  * Pijat Bayi Ceria (0 - 24 Bulan): ~40 menit',
        operationalFactsText: '• Homebase & Layanan: Homecare Waru Sidoarjo',
      });

      expect(prompt).toContain('DURASI STANDAR LAYANAN (DARI DATABASE KATALOG RESMI');
      expect(prompt).toContain('Pijat Bayi Ceria (0 - 24 Bulan): ~40 menit');
      expect(prompt).toContain('KEBIJAKAN OPERASIONAL RESMI');
      expect(prompt).toContain('Homebase & Layanan: Homecare Waru Sidoarjo');
    });
  });

  describe('4. Dynamic Grounding Composer Integration', () => {
    it('harus menyertakan dynamic durationSummaryText dan operationalFactsText di GroundingPackage', async () => {
      const slate: CustomerSlate = {
        customerId: 'cust_dyn_1',
        phone: '62812345678',
        tenantId: 'default-tenant',
        isLocationConfirmed: true,
        kelurahan: 'Tambakoso',
        kecamatan: 'Waru',
        kota: 'Kabupaten Sidoarjo',
        distanceKm: 8.5,
        ongkirFee: 20000,
        ongkirPromoFee: 10000,
        childAgeMonths: 1,
        childAgeCategory: 'BABY',
        selectedTreatmentName: null,
        medicalConcerns: [],
        symptoms: ['batuk', 'pilek'],
        isOutOfCoverage: false,
        reservationFormSent: false,
        lastInteractionAt: new Date().toISOString(),
        conversationState: 'COLLECTING_SLOTS',
      };

      const extraction: ExtractedEntities = {
        intents: ['consult_symptom'],
        locationText: null,
        streetDetail: null,
        childAgeMonths: 1,
        symptoms: ['batuk', 'pilek'],
        treatmentReferenced: null,
        preferredDateText: null,
        preferredTimeText: null,
        customerName: null,
        isMedicalEmergency: false,
        confidenceScore: 0.9,
      };

      const grounding = await GroundingComposer.compose(slate, extraction, {
        customerInput: 'anak saya batuk pilek usia 1 bulan di alana waru',
      });

      expect(grounding.durationSummaryText).toBeDefined();
      expect(grounding.durationSummaryText).toContain('~40 menit');
      expect(grounding.operationalFactsText).toBeDefined();
      expect(grounding.operationalFactsText).toContain('Homebase & Layanan');
      // Symptom matching must prioritize pulih ceria in filteredCatalog
      expect(grounding.filteredCatalog.length).toBeGreaterThan(0);
      expect(grounding.filteredCatalog[0].name.toLowerCase()).toContain('pulih');
    });
  });
});
