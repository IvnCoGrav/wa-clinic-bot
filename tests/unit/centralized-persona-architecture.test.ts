import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersonaComposer } from '../../src/slot-engine/persona-composer';
import { UnifiedResponseSanitizer } from '../../src/utils/language-sanitizer';
import { DynamicCloserService } from '../../src/slot-engine/dynamic-closer.service';
import { FastFaqDetector } from '../../src/slot-engine/fast-faq-detector';
import { CustomerSlate } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';

describe('Centralized Architecture & PersonaComposer Test Suite', () => {
  describe('1. PersonaComposer Grounding & Rules', () => {
    it('harus memuat fakta klinis bahwa newborn 0-28 hari / 3 minggu aman dan sangat dianjurkan dipijat', () => {
      const facts = PersonaComposer.getClinicalAndOperationalFacts();
      expect(facts).toContain('PANDUAN USIA NEWBORN (MUTLAK)');
      expect(facts).toContain('0-28 hari');
      expect(facts).toContain('100% AMAN dan SANGAT DIANJURKAN');
      expect(facts).toContain('DILARANG KERAS menyarankan menunggu hingga 1 bulan');
    });

    it('harus memuat durasi standar resmi dan kebijakan operasional lengkap', () => {
      const facts = PersonaComposer.getClinicalAndOperationalFacts();
      expect(facts).toContain('Pijat Bayi / Baby (0-24 bulan): ~40 menit');
      expect(facts).toContain('Pijat Anak / Kids (>2-8 tahun): ~45 menit');
      expect(facts).toContain('Pijat Ibu Hamil / Nifas / Oksitosin: ~60 menit');
      expect(facts).toContain('Buka SETIAP HARI');
      expect(facts).toContain('QRIS Universal');
      expect(facts).toContain('1 kali per kunjungan rumah');
    });

    it('harus mengunci aturan panggilan Bunda dan kata ganti kami', () => {
      const rules = PersonaComposer.getPersonaRules();
      expect(rules).toContain('Selalu panggil dengan "Bunda"');
      expect(rules).toContain('DILARANG KERAS menggunakan singkatan "Bund"');
      expect(rules).toContain('Selalu gunakan kata "kami"');
      expect(rules).toContain('DILARANG KERAS menggunakan kata "saya"');
    });

    it('harus menyertakan larangan sapaan pembuka di percakapan lanjutan (history > 0)', () => {
      const rulesFollowUp = PersonaComposer.getPersonaRules({ historyCount: 3 });
      expect(rulesFollowUp).toContain('DILARANG KERAS membuka pesan dengan "Halo Bunda!"');
    });
  });

  describe('2. UnifiedResponseSanitizer Pipeline', () => {
    it('harus menormalisasi kata ganti saya/aku menjadi kami', () => {
      const raw = 'Biar saya bantu jadwalkan ya Bunda. Saya sarankan ambil paket ini.';
      const cleaned = UnifiedResponseSanitizer.sanitize(raw);
      expect(cleaned).toContain('Biar kami bantu');
      expect(cleaned).toContain('kami sarankan');
      expect(cleaned).not.toContain('saya');
    });

    it('harus menormalisasi singkatan Bund menjadi Bunda', () => {
      const raw = 'Halo Bund, untuk Bund bisa kami bantu.';
      const cleaned = UnifiedResponseSanitizer.sanitize(raw);
      expect(cleaned).not.toMatch(/\bBund\b/);
      expect(cleaned).toContain('Bunda');
    });

    it('harus menormalisasi QRIS e-wallet spesifik menjadi QRIS Universal', () => {
      const raw = 'Pembayaran bisa lewat transfer BCA atau QRIS ShopeePay ya Bunda.';
      const cleaned = UnifiedResponseSanitizer.sanitize(raw);
      expect(cleaned).toContain('QRIS');
      expect(cleaned).not.toContain('ShopeePay');
    });

    it('harus memangkas sapaan pembuka ganda pada percakapan lanjutan', () => {
      const raw = 'Halo Bunda! Untuk durasi pijat bayi adalah sekitar 40 menit.';
      const cleaned = UnifiedResponseSanitizer.sanitize(raw, { isFollowUp: true });
      expect(cleaned.startsWith('Untuk durasi pijat bayi')).toBe(true);
      expect(cleaned).not.toContain('Halo Bunda!');
    });

    it('harus merapikan format bold WhatsApp dan spasi rupiah', () => {
      const raw = 'Biayanya **Rp25000** dan jaraknya 16km.';
      const cleaned = UnifiedResponseSanitizer.sanitize(raw);
      expect(cleaned).toContain('*Rp 25.000*');
      expect(cleaned).not.toContain('**');
    });
  });

  describe('3. DynamicCloserService Slot-Aware Guidance', () => {
    it('harus memandu pertanyaan lokasi jika lokasi belum terkonfirmasi', () => {
      const slate: CustomerSlate = {
        customerId: 'cust-1',
        phone: '62812345678',
        name: 'Sari',
        tenantId: 'default-tenant',
        conversationId: 'conv-1',
        isLocationConfirmed: false,
        kelurahan: null,
        kecamatan: null,
        kota: null,
        lat: null,
        lng: null,
        streetDetail: null,
        distanceKm: null,
        ongkirFee: null,
        ongkirPromoFee: null,
        isOutOfCoverage: false,
        childAgeMonths: null,
        childAgeCategory: null,
        symptoms: [],
        medicalConcerns: [],
        selectedTreatmentName: null,
        preferredDate: null,
        preferredTime: null,
        pricelistSent: false,
        isHumanHandling: false,
        humanHandlingReason: null,
        lastInteractionAt: new Date(),
        projectedState: ConversationState.AWAITING_LOCATION,
      };

      const missing = DynamicCloserService.determineMissingSlot(slate);
      expect(missing).toBe('LOCATION');

      const closerInstruction = DynamicCloserService.getCloserInstruction(slate);
      expect(closerInstruction).toContain('Tanyakan alamat/daerah di kalimat penutup');
    });

    it('harus memandu pertanyaan usia anak jika lokasi sudah ada tapi usia belum', () => {
      const slate: CustomerSlate = {
        customerId: 'cust-1',
        phone: '62812345678',
        name: 'Sari',
        tenantId: 'default-tenant',
        conversationId: 'conv-1',
        isLocationConfirmed: true,
        kelurahan: 'Sukodono',
        kecamatan: 'Sukodono',
        kota: 'Sidoarjo',
        lat: -7.4,
        lng: 112.7,
        streetDetail: null,
        distanceKm: 16.5,
        ongkirFee: 25000,
        ongkirPromoFee: 20000,
        isOutOfCoverage: false,
        childAgeMonths: null,
        childAgeCategory: null,
        symptoms: [],
        medicalConcerns: [],
        selectedTreatmentName: null,
        preferredDate: null,
        preferredTime: null,
        pricelistSent: true,
        isHumanHandling: false,
        humanHandlingReason: null,
        lastInteractionAt: new Date(),
        projectedState: ConversationState.AWAITING_INTEREST,
      };

      const missing = DynamicCloserService.determineMissingSlot(slate);
      expect(missing).toBe('AGE');

      const closerInstruction = DynamicCloserService.getCloserInstruction(slate);
      expect(closerInstruction).toContain('Tanyakan usia si kecil di kalimat penutup');
    });
  });

  describe('4. FastFaqDetector Routing & Protection', () => {
    it('DILARANG membajak pesan lead iklan Meta di status INITIAL', () => {
      const slate: CustomerSlate = {
        customerId: 'cust-1',
        phone: '62812345678',
        name: 'New Lead',
        tenantId: 'default-tenant',
        conversationId: 'conv-1',
        isLocationConfirmed: false,
        kelurahan: null,
        kecamatan: null,
        kota: null,
        lat: null,
        lng: null,
        streetDetail: null,
        distanceKm: null,
        ongkirFee: null,
        ongkirPromoFee: null,
        isOutOfCoverage: false,
        childAgeMonths: null,
        childAgeCategory: null,
        symptoms: [],
        medicalConcerns: [],
        selectedTreatmentName: null,
        preferredDate: null,
        preferredTime: null,
        pricelistSent: false,
        isHumanHandling: false,
        humanHandlingReason: null,
        lastInteractionAt: new Date(),
        projectedState: ConversationState.INITIAL,
      };

      const isFaq = FastFaqDetector.isPotentialFastFaq(
        'Halo Bu Bidan, saya tertarik dengan layanan home-treatment',
        slate
      );
      expect(isFaq).toBe(false); // Wajib false agar masuk alur Onboarding Alamat!
    });

    it('HARUS meloloskan pertanyaan FAQ umum ke Fast-Track', () => {
      const slate: CustomerSlate = {
        customerId: 'cust-1',
        phone: '62812345678',
        name: 'Customer',
        tenantId: 'default-tenant',
        conversationId: 'conv-1',
        isLocationConfirmed: true,
        kelurahan: 'Waru',
        kecamatan: 'Waru',
        kota: 'Sidoarjo',
        lat: -7.35,
        lng: 112.75,
        streetDetail: null,
        distanceKm: 3.0,
        ongkirFee: 0,
        ongkirPromoFee: 0,
        isOutOfCoverage: false,
        childAgeMonths: 5,
        childAgeCategory: 'BABY',
        symptoms: [],
        medicalConcerns: [],
        selectedTreatmentName: null,
        preferredDate: null,
        preferredTime: null,
        pricelistSent: true,
        isHumanHandling: false,
        humanHandlingReason: null,
        lastInteractionAt: new Date(),
        projectedState: ConversationState.AWAITING_INTEREST,
      };

      expect(FastFaqDetector.isPotentialFastFaq('apakah bisa bayar lewat qris atau transfer?', slate)).toBe(true);
      expect(FastFaqDetector.isPotentialFastFaq('berapa lama durasi pijat bayi ya bu bidan?', slate)).toBe(true);
      expect(FastFaqDetector.isPotentialFastFaq('apakah terapisnya bidan resmi yang punya STR?', slate)).toBe(true);
    });
  });
});
