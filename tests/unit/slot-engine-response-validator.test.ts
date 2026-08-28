import { describe, it, expect } from 'vitest';
import { ResponseValidator } from '../../src/slot-engine/response-validator';
import { SlateStore } from '../../src/slot-engine/slate-store';
import { EntityExtractor } from '../../src/slot-engine/entity-extractor';
import { DecisionMatrix } from '../../src/slot-engine/decision-matrix';

describe('ResponseValidator & Anti-Hallucination Guard', () => {
  it('should intercept and block fabricated delivery tier ranges', () => {
    const slate = SlateStore.hydrateSlate({
      customer: { id: 'c1', phone: '628123' } as any,
      conversation: { current_state: 'AWAITING_TREATMENT' } as any,
    });

    const hallucinatedReply =
      'Ongkir untuk wilayah Wonorejo II, Tegalsari Surabaya akan kami hitung berdasarkan jarak dari klinik kami di Waru. Jika jaraknya di bawah 5 km, ongkirnya gratis. Untuk jarak 5-30 km berkisar antara Rp 5.000 hingga Rp 25.000 setelah promo. 😊\n\nKalau mau bisa langsung tanyakan paket treatment yang Bunda minati untuk si kecil? 😊';

    const result = ResponseValidator.validate(hallucinatedReply, slate);
    expect(result.isValid).toBe(false);
    expect(result.violations).toContain('HALLUCINATED_ONGKIR_RANGE');
    expect(result.fallbackReply).toBeDefined();
    expect(result.fallbackReply).not.toContain('berkisar antara');
  });

  it('should intercept fabricated dummy reservation lists (1-4 forms) when not booking ready', () => {
    const slate = SlateStore.hydrateSlate({
      customer: { id: 'c2', phone: '628124' } as any,
      conversation: { current_state: 'INITIAL' } as any,
    });

    const dummyFormReply = `Baik Bunda, untuk pengecekan ketersediaan jadwal dan Bidan terdekat, mohon bantu lengkapi format reservasi berikut ya Bunda:

1. Nama lengkap Bunda
2. Nama si kecil
3. Usia si kecil
4. Alamat lengkap (nama kelurahan atau desa)

Dengan informasi tersebut, kami bisa bantu cekkan ketersediaan jadwal dan ongkirnya. 😊`;

    const result = ResponseValidator.validate(dummyFormReply, slate);
    expect(result.isValid).toBe(false);
    expect(result.violations).toContain('HALLUCINATED_DUMMY_FORM');
    expect(result.fallbackReply).toContain('Kalau boleh tahu, nama kelurahan atau desanya apa ya Bunda');
  });

  it('should sanitize robotic phrase "mau dicobakan"', () => {
    const slate = SlateStore.hydrateSlate({
      customer: { id: 'c3', phone: '628125' } as any,
      conversation: { current_state: 'AWAITING_TREATMENT' } as any,
    });

    const stiffReply = 'Tentu bisa Bunda, kami sarankan Pijat Bayi Pulih Ceria. Kalau si kecil mau dicobakan yang Pijat Bayi Pulih Ceria dulu Bunda? 😊';
    const result = ResponseValidator.validate(stiffReply, slate);
    expect(result.isValid).toBe(true);
    expect(result.sanitizedReply).not.toContain('mau dicobakan yang');
    expect(result.sanitizedReply).toContain('Bunda tertarik mau ambil paket Pijat Bayi Pulih Ceria');
  });

  it('should pass valid and polite clinical responses', () => {
    const slate = SlateStore.hydrateSlate({
      customer: { id: 'c4', phone: '628126', kelurahan: 'Jambangan', distance_km: 9.0 } as any,
      conversation: { current_state: 'AWAITING_TREATMENT' } as any,
    });

    const goodReply = 'Untuk si kecil usia 6 bulan yang sedang batuk dan pilek, kami sangat merekomendasikan paket *Pijat Bayi Pulih Ceria* Bunda. Pijat ini membantu melegakan pernapasan dan membuat si kecil lebih nyaman. 😊\n\nBunda mau ambil paket *Pijat Bayi Pulih Ceria*, atau mungkin pilih treatment lain Bunda? 🤗';
    const result = ResponseValidator.validate(goodReply, slate);
    expect(result.isValid).toBe(true);
    expect(result.violations.length).toBe(0);
  });
});

describe('EntityExtractor Context Bleed Guard', () => {
  it('should not extract location from bot assistant history if not present in customer text', async () => {
    const customerText = 'Kalo homecare ke wonorejo II no 25 tegalsari surabaya ada biaya ongkir ga ya?';
    const history = [
      { role: 'user' as const, content: 'Alamatnya sby mana ya bubid?' },
      { role: 'assistant' as const, content: 'Untuk klinik kami berfokus pada layanan Homecare (Bidan datang ke rumah). Homebase kami ada di Waru, Sidoarjo Bunda 😊' },
    ];

    const extraction = await EntityExtractor.extract(customerText, { history });
    // Location extracted should NOT be "Waru"
    if (extraction.locationText) {
      expect(extraction.locationText.toLowerCase()).not.toContain('waru');
      expect(
        extraction.locationText.toLowerCase().includes('wonorejo') ||
        extraction.locationText.toLowerCase().includes('tegalsari') ||
        extraction.locationText.toLowerCase().includes('surabaya')
      ).toBe(true);
    }
  });
});

describe('DecisionMatrix Composite Geocoding & Imprecise Fallback', () => {
  it('should return safe deterministic template when geocoding is imprecise and customer asks about ongkir', async () => {
    const slate = SlateStore.hydrateSlate({
      customer: { id: 'c5', phone: '628127' } as any,
      conversation: { current_state: 'INITIAL' } as any,
    });

    const extraction = {
      intents: ['provide_location' as const, 'ask_price' as const],
      locationText: 'Sidoarjo',
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.9,
    };

    const decision = await DecisionMatrix.evaluate(slate, extraction, {
      incomingText: 'ke sidoarjo berapa ya ongkirnya',
    });

    expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
    expect(decision.deterministicTemplateReply).toBeDefined();
    expect(decision.deterministicTemplateReply).toContain('Di Sidoarjo kelurahan atau kecamatan mana ya Bunda');
  });
});
