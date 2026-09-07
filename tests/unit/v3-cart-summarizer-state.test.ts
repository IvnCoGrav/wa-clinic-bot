import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { extractFastIntents } from '../../src/v3/agent/persona';
import { ConversationStateSummarizer } from '../../src/slot-engine/conversation-summarizer';
import { ConversationState } from '@prisma/client';

const CATALOG = [
  { name: 'Pijat Bayi Pulih Ceria', promoPrice: 70000, originalPrice: 90000, category: 'BABY', isAddon: false },
  { name: 'Sinar Moksa', promoPrice: 10000, originalPrice: 15000, category: 'ADD_ON', isAddon: true },
  { name: 'Cukur Rambut Bayi', promoPrice: 30000, originalPrice: 30000, category: 'BABY', isAddon: false },
];

const baseSession: any = { genderGreeting: 'Bunda' };

describe('V3 cart tracking, fast intents & anti-amnesia summary', () => {
  it('syncCartItems mendeteksi add-on dari riwayat + hitung total', () => {
    const history = [
      { role: 'user', content: 'Pijat bayi sinar moksa ini gmn ya' },
      { role: 'assistant', content: 'Bisa dibantu dengan Pijat Bayi Pulih Ceria ya Bunda' },
      { role: 'user', content: 'Rencana itu sama cukur bayi' },
    ];
    const cart = GoalTracker.syncCartItems(baseSession, history as any, CATALOG as any);
    const names = cart.map((c) => c.name);
    expect(names).toContain('Pijat Bayi Pulih Ceria');
    expect(names).toContain('Sinar Moksa');
    expect(names).toContain('Cukur Rambut Bayi');
    const addon = cart.find((c) => c.name === 'Sinar Moksa');
    expect(addon?.type).toBe('ADDON');
    // Kandidat umum ("Pijat Bayi Ceria") tidak boleh ikut dari pertanyaan moksa
    expect(names).not.toContain('Pijat Bayi Ceria');
    expect(cart).toHaveLength(3);
    expect(GoalTracker.calcCartTotal({ ...baseSession, cartItems: cart, location: { rawText: '', ongkirPromo: 30000 } } as any)).toBe(140000);
  });

  it('formatGoalSessionForPrompt menampilkan cart + status ongkir QUOTED', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      location: { rawText: '', kelurahan: 'Pelemwatu', kecamatan: 'Menganti', kota: 'Kabupaten Gresik', distanceKm: 28.5, ongkirPromo: 30000, ongkirNormal: 35000 },
      ongkirStatus: 'QUOTED',
      cartItems: [{ name: 'Pijat Bayi Pulih Ceria', price: 90000, promoPrice: 70000, type: 'PRIMARY' }],
    } as any);
    expect(text).toContain('Keranjang Layanan Terpilih');
    expect(text).toContain('Pijat Bayi Pulih Ceria');
    expect(text).toContain('DILARANG ULANG HITUNGAN KM/ONGKIR!');
    expect(text).toContain('DILARANG TANYA ALAMAT LAGI!');
  });

  it('extractFastIntents: harga vs jadwal vs lokasi vs gejala (moksa BUKAN gejala)', () => {
    expect(extractFastIntents('cukurnya kak, totalnya berapa?')).toContain('ask_price');
    expect(extractFastIntents('minggu depan apakah masih kosong')).toContain('ask_schedule');
    expect(extractFastIntents('saya di pelemwatu menganti')).toContain('provide_location');
    expect(extractFastIntents('anak batuk pilek grok grok')).toContain('consult_symptom');
    expect(extractFastIntents('Pijat bayi sinar moksa ini gmn ya')).not.toContain('consult_symptom');
    expect(extractFastIntents('halo kak')).toEqual([]);
  });

  it('summarizer: pertanyaan tarif cukur → fokus biaya, larang ulang model cukur', () => {
    const slate: any = {
      isLocationConfirmed: true, kelurahan: 'Pelemwatu', ongkirPromoFee: 30000, distanceKm: 28.5,
      childAgeMonths: null, childAgeCategory: null, symptoms: [],
      selectedTreatmentName: 'Pijat Bayi Pulih Ceria', preferredDate: null, preferredTime: null,
      pricelistSent: false, reservationFormSent: false,
    };
    const history = [
      { role: 'user' as const, content: 'Kira kira kalau cukur bayi gak gundul bisa kah ?' },
      { role: 'assistant' as const, content: 'Nggak harus gundul kok, bisa dibantu potong rapi sesuai permintaan Bunda yaa' },
    ];
    const out = ConversationStateSummarizer.summarize(slate, {
      intents: ['ask_price'], locationText: null, streetDetail: null, childAgeMonths: null,
      symptoms: [], treatmentReferenced: null, preferredDateText: null, preferredTimeText: null,
      customerName: null, isMedicalEmergency: false, confidenceScore: 0.9,
    } as any, { history, customerInput: 'cukurnya kak, totalnya berapa?' });
    expect(out).toMatch(/TARIF biaya cukur/i);
    expect(out).toMatch(/DILARANG menjelaskan ulang model potongan rambut/i);
  });

  it('deriveConversationState: peta status reuse-enum', () => {
    expect(V3AgentRunner.deriveConversationState({ genderGreeting: 'Bunda' } as any)).toBe(ConversationState.INITIAL);
    expect(V3AgentRunner.deriveConversationState({ genderGreeting: 'Bunda', location: { rawText: '', kelurahan: 'Pelemwatu' } } as any)).toBe(ConversationState.LOCATION_CONFIRMED);
    expect(V3AgentRunner.deriveConversationState({ genderGreeting: 'Bunda', selectedTreatment: 'Pijat Bayi Ceria' } as any)).toBe(ConversationState.AWAITING_INTEREST);
    expect(V3AgentRunner.deriveConversationState({ genderGreeting: 'Bunda' } as any, ['ask_schedule'])).toBe(ConversationState.RESERVATION_SENT);
    expect(V3AgentRunner.deriveConversationState({ genderGreeting: 'Bunda', booking: { isConfirmed: true } } as any)).toBe(ConversationState.COMPLETED);
  });

  it('markOngkirQuoted/Confirmed idempoten (offline-safe)', async () => {
    const q = await GoalTracker.markOngkirQuoted('conv-x', 'default-tenant');
    expect(q.ongkirStatus).toBe('QUOTED');
    const c = await GoalTracker.markOngkirConfirmed('conv-x', 'default-tenant');
    expect(c.ongkirStatus).toBe('CONFIRMED');
  });
});
