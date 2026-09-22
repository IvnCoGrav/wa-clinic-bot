import { describe, it, expect } from 'vitest';
import { V3ConversationSummarizer } from '../../../src/v3/state/conversation-summarizer';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { isAskedLocationRecently } from '../../../src/v3/state/conversation-summarizer';

describe('Location Prompt City Answer — State-Gated Cool-Off (anti-kaset rusak)', () => {
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

  it('isAskedLocationRecently mendeteksi sapaan lokasi', () => {
    expect(isAskedLocationRecently(historyAskedLocation)).toBe(true);
  });

  describe('conversation-summarizer (V3ConversationSummarizer)', () => {
    it('customer jawab kota luas ("surabaya") → TIDAK ada larangan cool-off, fokus minta kelurahan', () => {
      const session = { ...baseSession, location: null };
      const history = [
        ...historyAskedLocation,
        { role: 'user', content: 'surabaya' },
      ];

      const summary = V3ConversationSummarizer.summarize(session, 'surabaya', { history });

      // TIDAK boleh ada larangan "JANGAN menanyakan alamat/kelurahan lagi"
      expect(summary).not.toContain('JANGAN menanyakan alamat/kelurahan rumah Bunda lagi');
      // Fokus harus minta kelurahan/kecamatan
      expect(summary).toContain('Bunda menginfokan daerah tempat tinggal (masih berupa kota/wilayah luas)');
      expect(summary).toContain('Tanyakan nama kelurahan atau kecamatan spesifiknya');
    });

    it('customer jawab "surabaya utara" → TIDAK ada larangan cool-off, fokus minta kelurahan', () => {
      const session = { ...baseSession, location: null };
      const history = [
        ...historyAskedLocation,
        { role: 'user', content: 'surabaya utara' },
      ];

      const summary = V3ConversationSummarizer.summarize(session, 'surabaya utara', { history });

      expect(summary).not.toContain('JANGAN menanyakan alamat/kelurahan rumah Bunda lagi');
      expect(summary).toContain('Bunda menginfokan daerah tempat tinggal');
      expect(summary).toContain('Tanyakan nama kelurahan atau kecamatan spesifiknya');
    });

    it('customer jawab "sidoarjo" → TIDAK ada larangan cool-off, fokus minta kelurahan', () => {
      const session = { ...baseSession, location: null };
      const history = [
        ...historyAskedLocation,
        { role: 'user', content: 'sidoarjo' },
      ];

      const summary = V3ConversationSummarizer.summarize(session, 'sidoarjo', { history });

      expect(summary).not.toContain('JANGAN menanyakan alamat/kelurahan rumah Bunda lagi');
      expect(summary).toContain('Bunda menginfokan daerah tempat tinggal');
      expect(summary).toContain('Tanyakan nama kelurahan atau kecamatan spesifiknya');
    });

    it('customer jawab "gresik" → TIDAK ada larangan cool-off, fokus minta kelurahan', () => {
      const session = { ...baseSession, location: null };
      const history = [
        ...historyAskedLocation,
        { role: 'user', content: 'gresik' },
      ];

      const summary = V3ConversationSummarizer.summarize(session, 'gresik', { history });

      expect(summary).not.toContain('JANGAN menanyakan alamat/kelurahan rumah Bunda lagi');
      expect(summary).toContain('Bunda menginfokan daerah tempat tinggal');
      expect(summary).toContain('Tanyakan nama kelurahan atau kecamatan spesifiknya');
    });

    it('customer mengabaikan lokasi dan bertanya bapil ("yg untuk batuk pilek apa") → larangan cool-off TETAP AKTIF', () => {
      const session = { ...baseSession, location: null };
      const history = [
        ...historyAskedLocation,
        { role: 'user', content: 'yg untuk batuk pilek apa kak' },
      ];

      const summary = V3ConversationSummarizer.summarize(session, 'yg untuk batuk pilek apa kak', { history });

      // Karena tidak ada jawaban lokasi → cool-off harus aktif
      expect(summary).toContain('Menanyakan alamat/kelurahan rumah Bunda lagi');
      // Fokus jawab keluhan, BUKAN minta kelurahan
      expect(summary).not.toContain('Bunda menginfokan daerah tempat tinggal');
    });

    it('session.location sudah ada kelurahan → status lokasi tercatat, tidak ada cool-off', () => {
      const session = {
        ...baseSession,
        location: {
          kelurahan: 'Kutisari',
          kecamatan: 'Tenggilis Mejoyo',
          kota: 'Surabaya',
          distanceKm: 5,
        },
      };
      const history = historyAskedLocation;

      const summary = V3ConversationSummarizer.summarize(session, 'surabaya', { history });

      // conversation-summarizer menampilkan lokasi di sudahDibahas
      expect(summary).toContain('Lokasi: Kutisari');
      expect(summary).toContain('5 km');
      expect(summary).not.toContain('Menanyakan alamat/kelurahan rumah Bunda lagi');
    });
  });

  describe('goal-tracker (formatGoalSessionForPrompt)', () => {
    it('customer jawab kota luas ("surabaya") → TIDAK ada instruksi cool-off di prompt goal-tracker', () => {
      const session = { ...baseSession, location: null };
      const history = historyAskedLocation;

      const promptText = GoalTracker.formatGoalSessionForPrompt(session, { history, incomingText: 'surabaya' });

      // TIDAK boleh ada "Sudah ditanyakan di pesan sebelumnya — JANGAN menanyakan lokasi lagi"
      expect(promptText).not.toContain('Sudah ditanyakan di pesan sebelumnya — JANGAN menanyakan lokasi lagi');
      // Harus ada instruksi normal minta kelurahan
      expect(promptText).toContain('Lokasi: Belum diketahui (Perlu ditanyakan kelurahan/kecamatannya)');
    });

    it('customer mengabaikan lokasi dan bertanya bapil → instruksi cool-off TETAP AKTIF di goal-tracker', () => {
      const session = { ...baseSession, location: null };
      const history = [
        { role: 'user', content: 'halo kak' },
        { role: 'assistant', content: 'Perkenalkan, saya Bidan Yusi... Kalau boleh tau rumahnya dimana ya Bunda? 😊' },
        { role: 'user', content: 'yg untuk kembung apa kak' },
      ];

      const promptText = GoalTracker.formatGoalSessionForPrompt(session, { history, incomingText: 'yg untuk kembung apa kak' });

      // Cool-off harus aktif karena customer tidak jawab lokasi
      expect(promptText).toContain('Sudah ditanyakan di pesan sebelumnya — JANGAN menanyakan lokasi lagi');
    });

    it('session.location sudah ada kelurahan → status SUDAH DIKETAHUI di goal-tracker', () => {
      const session = {
        ...baseSession,
        location: {
          kelurahan: 'Kutisari',
          kecamatan: 'Tenggilis Mejoyo',
          kota: 'Surabaya',
          distanceKm: 5,
        },
      };

      const promptText = GoalTracker.formatGoalSessionForPrompt(session);

      expect(promptText).toContain('STATUS: SUDAH DIKETAHUI - DILARANG TANYA ALAMAT LAGI!');
    });
  });

  describe('Property-based: input arbitrer non-lokasi + askedRecently → cool-off AKTIF', () => {
    const nonLocationInputs = [
      'yg untuk batuk pilek apa',
      'harga pijat bayi berapa',
      'bisa hari ini nggak',
      'pijat apa yang bagus untuk grok-grok',
      'aku cuma mau tanya',
      'oh gitu ya',
      'siang kak',
    ];

    for (const input of nonLocationInputs) {
      it(`input "${input}" → cool-off aktif`, () => {
        const session = { ...baseSession, location: null };
        const history = historyAskedLocation;

        const summary = V3ConversationSummarizer.summarize(session, input, { history });

        expect(summary).toContain('Menanyakan alamat/kelurahan rumah Bunda lagi');
      });
    }
  });

  describe('Property-based: input yang tidak produce locationResolved → cool-off TIDAK AKTIF', () => {
    const broadAreaInputs = [
      'surabaya',
      'surabaya utara',
      'surabaya barat',
      'surabaya timur',
      'surabaya selatan',
      'surabaya pusat',
      'sidoarjo',
      'gresik',
      'malang',
      'kedung cowek',
      'medokan ayu',
      'rungkut',
      'kenjeran',
      'wiyung',
      'pakal',
      'gubeng',
      'wonokromo',
      'gayungan',
      'taman',
      'candi',
      'sedati',
      'buduran',
      'waru',
      'porong',
      'krian',
      'tanggulangin',
    ];

    for (const input of broadAreaInputs) {
      it(`input "${input}" (gagal resolve kelurahan) → cool-off TIDAK aktif, fokus minta kelurahan`, () => {
        const session = { ...baseSession, location: null };
        const history = historyAskedLocation;

        const summary = V3ConversationSummarizer.summarize(session, input, { history });

        // Cool-off TIDAK aktif karena input adalah jawaban lokasi (meski belum presisi kelurahan)
        expect(summary).not.toContain('JANGAN menanyakan alamat/kelurahan rumah Bunda lagi');
        // Fokus minta kelurahan/kecamatan spesifik
        expect(summary).toContain('Bunda menginfokan daerah tempat tinggal');
        expect(summary).toContain('Tanyakan nama kelurahan atau kecamatan spesifiknya');
      });
    }
  });
});