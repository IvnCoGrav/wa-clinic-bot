import { describe, it, expect } from 'vitest';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';

describe('Location Comparison Feature (Priority 4.9)', () => {
  const baseSlate: CustomerSlate = {
    customerId: 'cust_comparison_1',
    phone: '6288235780925',
    name: 'Bunda Test',
    tenantId: 'default-tenant',
    conversationId: 'conv_comp_1',
    kelurahan: null,
    kecamatan: null,
    kota: null,
    lat: null,
    lng: null,
    streetDetail: null,
    distanceKm: null,
    ongkirFee: null,
    ongkirPromoFee: null,
    isLocationConfirmed: false,
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

  it('membandingkan Wiguna Selatan vs Jojoran Baru 1: Wiguna Selatan terdeteksi lebih dekat (~8.1 km vs ~14.1 km)', async () => {
    const extraction: ExtractedEntities = {
      intents: ['compare_locations'],
      locationText: null,
      comparisonLocations: ['Wiguna selatan', 'jojoran baru 1'],
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const result = await DecisionMatrix.evaluate(baseSlate, extraction, {
      incomingText: 'Lebih dekat mana yaa\nWiguna selatan\nAtau jojoran baru 1',
    });

    expect(result.action).toBe('RESOLVE_LOCATION_COMPARISON');
    expect(result.deterministicTemplateReply).toBeDefined();

    const reply = result.deterministicTemplateReply!;
    // Harus menyebutkan Wiguna Selatan lebih dekat
    expect(reply).toContain('Lebih dekat yang *Wiguna Selatan* ya Bunda');
    // Harus memuat rincian kedua lokasi
    expect(reply).toContain('Wiguna Selatan');
    expect(reply).toContain('Jojoran Baru 1');
    // Harus ada estimasi jarak (km) & promo ongkir
    expect(reply).toMatch(/±\d+\.\d+ km/);
    expect(reply).toContain('Rp 10.000');
    expect(reply).toContain('Rp 15.000');
    // CTA menanyakan pilihan alamat
    expect(reply).toContain('alamat yang mana ya Bunda?');

    // Lokasi TIDAK BOLEH dikunci (isLocationConfirmed = false) karena customer baru bertanya komparasi
    expect(result.updatedSlate.isLocationConfirmed).toBe(false);
  });

  it('membandingkan dengan urutan terbalik: Jojoran Baru 1 vs Wiguna Selatan tetap menentukan Wiguna lebih dekat', async () => {
    const extraction: ExtractedEntities = {
      intents: ['compare_locations'],
      locationText: null,
      comparisonLocations: ['jojoran baru 1', 'Wiguna selatan'],
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const result = await DecisionMatrix.evaluate(baseSlate, extraction, {
      incomingText: 'Lebih dekat Jojoran Baru 1 atau Wiguna Selatan?',
    });

    expect(result.action).toBe('RESOLVE_LOCATION_COMPARISON');
    const reply = result.deterministicTemplateReply!;
    expect(reply).toContain('Lebih dekat yang *Wiguna Selatan* ya Bunda');
    expect(result.updatedSlate.isLocationConfirmed).toBe(false);
  });

  it('membandingkan nama kecamatan (Wonokromo) vs kelurahan (Wedoro): Wedoro terdeteksi lebih dekat dan gratis ongkir', async () => {
    const extraction: ExtractedEntities = {
      intents: ['compare_locations'],
      locationText: null,
      comparisonLocations: ['Wonokromo', 'Wedoro'],
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const result = await DecisionMatrix.evaluate(baseSlate, extraction, {
      incomingText: 'Lebih dekat mana yaa\nwonokromo\nAtau wedoro',
    });

    expect(result.action).toBe('RESOLVE_LOCATION_COMPARISON');
    const reply = result.deterministicTemplateReply!;
    expect(reply).toContain('Lebih dekat yang *Wedoro* ya Bunda');
    expect(reply).toContain('Gratis ongkir');
    expect(reply).toContain('Wonokromo');
    expect(result.updatedSlate.isLocationConfirmed).toBe(false);
  });
});
