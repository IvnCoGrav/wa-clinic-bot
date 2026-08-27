import { describe, it, expect } from 'vitest';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';
import { SlateStore } from '../../src/slot-engine/slate-store';
import { ExtractedEntities } from '../../src/slot-engine/types';

describe('Turn 1 & Turn 2 Resolution Fix', () => {
  it('Turn 1: "Alamatnya sby mana ya bubid?" -> Must return Homecare origin policy', async () => {
    const slate = SlateStore.hydrateSlate({
      customer: { id: 'c1', phone: '628111' } as any,
      conversation: { current_state: 'INITIAL' } as any,
    });

    const extraction: ExtractedEntities = {
      intents: ['ask_clinic_origin'],
      locationText: 'sby',
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

    const decision = await DecisionMatrix.evaluate(slate, extraction, {
      incomingText: 'Alamatnya sby mana ya bubid?',
    });

    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.deterministicTemplateReply).toContain('Homebase kami ada di Waru, Sidoarjo');
    expect(decision.deterministicTemplateReply).toContain('Homecare');
  });

  it('Turn 2: "Kalo homecare ke wonorejo II np 25 tegalsari surabaya ada biaya ongkir ga ya?" -> Must resolve precisely and return TEMPLATES.ongkirInfo', async () => {
    const slate = SlateStore.hydrateSlate({
      customer: { id: 'c1', phone: '628111' } as any,
      conversation: { current_state: 'INITIAL' } as any,
    });

    const extraction: ExtractedEntities = {
      intents: ['provide_location', 'ask_price'],
      locationText: 'tegalsari surabaya',
      streetDetail: 'wonorejo II np 25',
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const decision = await DecisionMatrix.evaluate(slate, extraction, {
      incomingText: 'Kalo homecare ke wonorejo II np 25 tegalsari surabaya ada biaya ongkir ga ya?',
      history: [
        { role: 'user', content: 'Alamatnya sby mana ya bubid?' },
        { role: 'assistant', content: 'Homebase kami ada di Waru, Sidoarjo...' },
      ],
    });

    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.deterministicTemplateReply).toBeDefined();
    expect(decision.deterministicTemplateReply).toContain('Jika dilihat dari jaraknya kurang lebih');
    expect(decision.deterministicTemplateReply).toContain('tambahan ongkir');
    expect(decision.deterministicTemplateReply).toContain('promo');
    expect(decision.deterministicTemplateReply).not.toContain('berkisar antara');
  });
});
