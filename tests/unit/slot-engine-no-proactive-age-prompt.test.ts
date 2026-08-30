import { describe, it, expect, vi } from 'vitest';
import { DynamicCloserService } from '../../src/slot-engine/dynamic-closer.service';
import { PersonaComposer } from '../../src/slot-engine/persona-composer';
import { CustomerSlate } from '../../src/slot-engine/types';
import { ConversationState } from '@prisma/client';

describe('Slot Engine - No Proactive Age Prompt & Custom Persona Integration', () => {
  const baseSlateWithLocation: CustomerSlate = {
    customerId: 'cust-platuk',
    phone: '628123456789',
    name: 'Bunda Test',
    tenantId: 'default-tenant',
    conversationId: 'conv-platuk-1',
    isLocationConfirmed: true,
    kelurahan: 'Sidotopo Wetan',
    kecamatan: 'Kenjeran',
    kota: 'Surabaya',
    lat: -7.23,
    lng: 112.76,
    streetDetail: 'Platuk tauladan 19a',
    distanceKm: 22.6,
    ongkirFee: 35000,
    ongkirPromoFee: 25000,
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

  it('1. Turn-2: Setelah ongkir terkonfirmasi, DynamicCloserService memandu pemilihan treatment', () => {
    const missing = DynamicCloserService.determineMissingSlot(baseSlateWithLocation);
    expect(missing).toBe('TREATMENT');

    const instruction = DynamicCloserService.getCloserInstruction(baseSlateWithLocation);
    expect(instruction).toContain('PANDUAN KONSULTASI & PENUTUP (TANYA PILIHAN TREATMENT)');
    expect(instruction).not.toContain('Tanyakan usia si kecil');
  });

  it('2. Turn-3: Saat customer menanyakan keluhan bapil ("Kalau mau pijat batuk pilek bisa ?"), closer langsung memandu penawaran jadwal (SCHEDULE), BUKAN tanya usia', () => {
    const slateWithSymptom: CustomerSlate = {
      ...baseSlateWithLocation,
      symptoms: ['batuk', 'pilek'],
    };

    const missing = DynamicCloserService.determineMissingSlot(slateWithSymptom);
    expect(missing).toBe('SCHEDULE');

    const instruction = DynamicCloserService.getCloserInstruction(slateWithSymptom, null, [
      { role: 'assistant', content: 'Jika dilihat dari jaraknya... Rencana mau treatment apa bunda ?🤗' },
    ]);
    expect(instruction).toContain('PANDUAN PENAWARAN JADWAL');
    expect(instruction).toContain('rencana mau treatment di hari apa');
    expect(instruction).not.toContain('berapa usia si kecil');
  });

  it('3. Passive Age Capture: Usia anak tetap tercatat di slate jika customer menyebutkannya, tapi bot tetap tidak menanyakan usia', () => {
    const slateWithAgeAndSymptom: CustomerSlate = {
      ...baseSlateWithLocation,
      childAgeMonths: 5,
      childAgeCategory: 'BABY',
      symptoms: ['batuk', 'pilek'],
    };

    const missing = DynamicCloserService.determineMissingSlot(slateWithAgeAndSymptom);
    expect(missing).toBe('SCHEDULE');

    const instruction = DynamicCloserService.getCloserInstruction(slateWithAgeAndSymptom);
    expect(instruction).toContain('PANDUAN PENAWARAN JADWAL');
    expect(instruction).not.toContain('berapa usia si kecil');
  });

  it('4. PersonaComposer menyuntikkan Rule 18 (larangan tanya usia proaktif)', () => {
    const rules = PersonaComposer.getPersonaRules();
    expect(rules).toContain('ATURAN USIA & KELUHAN PASIEN (TIDAK PERLU DITANYAKAN PROAKTIF)');
    expect(rules).toContain('DILARANG KERAS proaktif menanyakan usia atau umur si kecil');
  });

  it('5. PersonaComposer mengintegrasikan customPersonaPrompt dari DB/settings ke dalam System Prompt', () => {
    const customRules = `
[ATURAN KHUSUS OWNER KLINIK]:
- Jangan pernah tawarkan paket selain yang ada di pricelist.
- Jam operasional ketat jam 08.00-17.00 WIB.
    `.trim();

    const prompt = PersonaComposer.composeSlotGeneratorPrompt({
      deliveryFactsText: '• Lokasi: Sidotopo Wetan',
      customPersonaPrompt: customRules,
    });

    expect(prompt).toContain('ATURAN KHUSUS & SOP TAMBAHAN KLINIK DARI DATABASE / SETTINGS');
    expect(prompt).toContain('[ATURAN KHUSUS OWNER KLINIK]');
    expect(prompt).toContain('Jangan pernah tawarkan paket selain yang ada di pricelist');
  });

  it('6. FastFaqPrompt juga mengintegrasikan customPersonaPrompt dari DB/settings', () => {
    const customRules = `[ATURAN FAQ KHUSUS]: Jawab maksimal 2 kalimat.`;

    const fastFaqPrompt = PersonaComposer.composeFastFaqPrompt({
      knowledgeContext: 'Homecare Moms & Baby',
      customPersonaPrompt: customRules,
    });

    expect(fastFaqPrompt).toContain('ATURAN KHUSUS & SOP TAMBAHAN KLINIK DARI DATABASE / SETTINGS');
    expect(fastFaqPrompt).toContain('[ATURAN FAQ KHUSUS]: Jawab maksimal 2 kalimat.');
  });
});
