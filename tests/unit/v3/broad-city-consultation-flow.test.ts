import { describe, it, expect } from 'vitest';
import { V3ConversationSummarizer } from '../../../src/v3/state/conversation-summarizer';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { getCoverageCities } from '../../../src/config/coverage';

describe('Broad-city consultation-first (Fase 2, coverage-driven)', () => {
  const baseSession = {
    genderGreeting: 'Bunda',
    customerName: 'Bunda Test',
    location: null,
    cartItems: [],
    momProfile: {},
    childProfile: {},
    children: [],
    targetAudience: 'KIDS',
    ongkirStatus: null,
    priceDiscussed: false,
    booking: {},
    selectedTreatment: null,
    feverContraindication: false,
  };
  const historyAskedLocation = [
    { role: 'user', content: 'halo kak' },
    { role: 'assistant', content: 'Perkenalkan, saya Bidan Yusi... Kalau boleh tau rumahnya dimana ya Bunda? 😊' },
  ];

  const coverageCities = getCoverageCities().map((c) => String(c).toLowerCase()).filter((c) => c.length >= 3 && c !== 'sby' && c !== 'sda' && c !== 'jawa timur');

  for (const city of coverageCities.slice(0, 3)) {
    it(`customer jawab kota coverage "${city}" tanpa treatment → consultation-first, tanpa todong kelurahan/ongkir`, () => {
      const session = { ...baseSession, location: null, selectedTreatment: null, cartItems: [] as any[] };
      const summary = V3ConversationSummarizer.summarize(session, city, { history: historyAskedLocation });
      // Wajib afirmasi jangkauan + tanya kebutuhan perawatan
      expect(summary.toLowerCase()).toContain('wilayah operasional utama');
      // DILARANG memuat instruksi birokrasi lama
      expect(summary).not.toContain('Tanyakan nama kelurahan atau kecamatan spesifiknya dengan ramah agar kami bisa bantu cekkan jangkauan Bidan dan ongkir');
      expect(summary.toLowerCase()).not.toContain('estimasi ongkir');
      // goal-tracker status adaptif
      const promptText = GoalTracker.formatGoalSessionForPrompt(session as any, { history: historyAskedLocation, incomingText: city });
      expect(promptText).toContain('Area Terjangkau');
      expect(promptText).not.toContain('Perlu ditanyakan kelurahan/kecamatannya');
    });
  }

  it('customer jawab kota coverage dengan treatment sudah dipilih → BUKAN consultation-first, tetap jalur kelurahan/ongkir', () => {
    const city = coverageCities[0] || 'surabaya';
    const session = { ...baseSession, location: null, selectedTreatment: 'Pijat Bayi Pulih Ceria', cartItems: [{ name: 'Pijat Bayi Pulih Ceria', price: 75000 }] as any[] };
    const summary = V3ConversationSummarizer.summarize(session, city, { history: historyAskedLocation });
    expect(summary).not.toContain('wilayah operasional utama');
    expect(summary).toContain('Tanyakan nama kelurahan atau kecamatan spesifiknya');
  });

  it('kelurahan presisi (bukan kota) → tetap jalur kelurahan, bukan consultation-first', () => {
    const session = { ...baseSession, location: null, selectedTreatment: null, cartItems: [] as any[] };
    const summary = V3ConversationSummarizer.summarize(session, 'kutisari', { history: historyAskedLocation });
    // Kutisari adalah kelurahan, bukan kota coverage → masuk cabang lama (minta kecamatan spesifik atau sudah dianggap lokasi answer tapi bukan broad)
    // Untuk input 1 kata non-kota, summarizer tetap anggap location answer → cabang kelurahan (bukan broad)
    expect(summary).toContain('Bunda menginfokan daerah tempat tinggal');
  });
});
