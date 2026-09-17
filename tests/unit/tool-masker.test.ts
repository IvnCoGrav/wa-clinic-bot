import { describe, it, expect, vi } from 'vitest';
import { ALL_V3_TOOLS } from '../../src/v3/tools/tool-registry';
import {
  evaluateToolMasking,
  buildEvidenceTexts,
  resolveCandidateBookingDate,
  resolveCandidateTreatment,
} from '../../src/v3/tools/tool-masker';
import { CustomerGoalSession } from '../../src/v3/domain/types';
import * as dateConfirmationModule from '../../src/utils/date-confirmation';

describe('Tool Masker Engine (Fase 2)', () => {
  const baseSession: CustomerGoalSession = {
    genderGreeting: 'Bunda',
    cartItems: [],
    location: undefined,
  };

  describe('1. Verifikasi Signature & Adapter isDateConfirmed', () => {
    it('isDateConfirmed dipanggil dengan signature ASLI (bookingDate, evidenceTexts)', () => {
      const isDateConfirmedSpy = vi.spyOn(dateConfirmationModule, 'isDateConfirmed');

      const sessionWithCart: CustomerGoalSession = {
        ...baseSession,
        cartItems: [{ name: 'Pijat Bayi Ceria', price: 100000, type: 'PRIMARY' }],
        location: { rawText: 'Waru, Sidoarjo', kelurahan: 'Waru' },
      };

      const history = [
        { role: 'user', content: 'Halo Bidan' },
        { role: 'assistant', content: 'Halo Bunda!' },
      ];

      evaluateToolMasking(ALL_V3_TOOLS, sessionWithCart, 'Bisa hari Sabtu besok?', history);

      // Verifikasi: argumen pertama adalah string kandidat hari, argumen kedua adalah string[]
      expect(isDateConfirmedSpy).toHaveBeenCalled();
      const lastCall = isDateConfirmedSpy.mock.calls[isDateConfirmedSpy.mock.calls.length - 1];
      const [calledBookingDate, calledEvidence] = lastCall;

      expect(typeof calledBookingDate === 'string' || calledBookingDate === undefined).toBe(true);
      expect(Array.isArray(calledEvidence)).toBe(true);
      expect(calledEvidence).toContain('Halo Bidan');
      expect(calledEvidence).toContain('Bisa hari Sabtu besok?');

      isDateConfirmedSpy.mockRestore();
    });

    it('buildEvidenceTexts merakit pesan kronologis tanpa duplikasi pesan terakhir', () => {
      const history = [
        { role: 'user', content: 'Pesan 1' },
        { role: 'assistant', content: 'Balasan bot' },
        { role: 'user', content: 'Pesan 2' },
      ];
      const evidence = buildEvidenceTexts('Pesan 3', baseSession, history);
      expect(evidence).toEqual(['Pesan 1', 'Pesan 2', 'Pesan 3']);

      // Jika incoming text sama dengan user text terakhir di history, hindari duplikasi
      const deduplicated = buildEvidenceTexts('Pesan 2', baseSession, history);
      expect(deduplicated).toEqual(['Pesan 1', 'Pesan 2']);
    });

    it('resolveCandidateBookingDate mendeteksi preferredDate, requestedTimeHint, atau kata waktu teks', () => {
      const sessionWithPref: CustomerGoalSession = {
        ...baseSession,
        booking: { preferredDate: 'Minggu, 21 September', isConfirmed: false },
      };
      expect(resolveCandidateBookingDate(sessionWithPref, '', [])).toBe('Minggu, 21 September');

      const sessionWithHint: CustomerGoalSession = {
        ...baseSession,
        booking: { requestedTimeHint: 'hari ini', isConfirmed: false },
      };
      expect(resolveCandidateBookingDate(sessionWithHint, '', [])).toBe('hari ini');

      expect(resolveCandidateBookingDate(baseSession, 'Saya mau hari jumat ya', [])).toBe('jumat');
      expect(resolveCandidateBookingDate(baseSession, 'Saya mau booking dong', ['kemarin bilangnya sabtu'])).toBe('sabtu');
    });
  });

  describe('2. Skenario Deterministik Tool Masking', () => {
    it('Skenario A: Customer baru menyapa ("Halo Bidan") → save_reservation di-mask (TREATMENT_EMPTY)', () => {
      const result = evaluateToolMasking(ALL_V3_TOOLS, baseSession, 'Halo Bidan');
      expect(result.isSaveReservationAllowed).toBe(false);
      expect(result.maskedToolNames).toContain('save_reservation');
      expect(result.availableTools.some((t) => t.function?.name === 'save_reservation')).toBe(false);
      expect(result.reason).toContain('TREATMENT_EMPTY');
    });

    it('Skenario B: Layanan dipilih tapi lokasi belum ada → save_reservation di-mask (LOCATION_EMPTY)', () => {
      const sessionWithCart: CustomerGoalSession = {
        ...baseSession,
        cartItems: [{ name: 'Pijat Bayi Ceria', price: 100000, type: 'PRIMARY' }],
      };
      const result = evaluateToolMasking(ALL_V3_TOOLS, sessionWithCart, 'Mau ambil pijat bayi');
      expect(result.isSaveReservationAllowed).toBe(false);
      expect(result.maskedToolNames).toContain('save_reservation');
      expect(result.reason).toContain('LOCATION_EMPTY');
    });

    it('Skenario C: Layanan dan lokasi ada, tapi belum sebut jadwal → save_reservation di-mask (DATE_NOT_CONFIRMED)', () => {
      const sessionWithLocation: CustomerGoalSession = {
        ...baseSession,
        cartItems: [{ name: 'Pijat Bayi Ceria', price: 100000, type: 'PRIMARY' }],
        location: { rawText: 'Waru, Sidoarjo', kelurahan: 'Waru' },
      };
      const result = evaluateToolMasking(ALL_V3_TOOLS, sessionWithLocation, 'Rumah saya di Perum Delta Sari Waru');
      expect(result.isSaveReservationAllowed).toBe(false);
      expect(result.maskedToolNames).toContain('save_reservation');
      expect(result.reason).toContain('DATE_NOT_CONFIRMED');
      expect(result.suspectOverRestrictive).toBe(false);
    });

    it('Skenario D: Jawaban ambigu ("boleh deh yang itu" / "siap") tanpa tanggal → save_reservation di-mask (anti booking sepihak)', () => {
      const session: CustomerGoalSession = {
        ...baseSession,
        cartItems: [{ name: 'Pijat Bayi Ceria', price: 100000, type: 'PRIMARY' }],
        location: { rawText: 'Rungkut', kecamatan: 'Rungkut' },
      };
      const result = evaluateToolMasking(ALL_V3_TOOLS, session, 'Boleh deh yang itu');
      expect(result.isSaveReservationAllowed).toBe(false);
      expect(result.maskedToolNames).toContain('save_reservation');
    });

    it('Skenario E: Pertanyaan slot bertanda tanya ("Bisa hari Sabtu?") → save_reservation di-mask + ditandai suspectOverRestrictive', () => {
      const session: CustomerGoalSession = {
        ...baseSession,
        cartItems: [{ name: 'Pijat Bayi Ceria', price: 100000, type: 'PRIMARY' }],
        location: { rawText: 'Waru', kelurahan: 'Waru' },
      };
      const result = evaluateToolMasking(ALL_V3_TOOLS, session, 'Kalau hari Sabtu apakah ada slot kosong?');
      expect(result.isSaveReservationAllowed).toBe(false);
      expect(result.maskedToolNames).toContain('save_reservation');
      // Karena customer menyebut kata hari 'sabtu' tapi gate menolak karena kalimat tanya,
      // wajib ditandai suspectOverRestrictive untuk audit manual!
      expect(result.suspectOverRestrictive).toBe(true);
    });

    it('Skenario F: Kesepakatan tanggal tegas tanpa tanda tanya ("Saya ambil hari Sabtu ya") → save_reservation DIBUKA', () => {
      const session: CustomerGoalSession = {
        ...baseSession,
        cartItems: [{ name: 'Pijat Bayi Ceria', price: 100000, type: 'PRIMARY' }],
        location: { rawText: 'Waru', kelurahan: 'Waru' },
      };
      const history = [
        { role: 'user', content: 'Sabtu bisa?' },
        { role: 'assistant', content: 'Bisa Bunda, hari Sabtu tersedia slot pagi.' },
      ];
      const result = evaluateToolMasking(ALL_V3_TOOLS, session, 'Baik saya fix ambil hari Sabtu ya', history);
      expect(result.isSaveReservationAllowed).toBe(true);
      expect(result.maskedToolNames.length).toBe(0);
      expect(result.availableTools.some((t) => t.function?.name === 'save_reservation')).toBe(true);
      expect(result.reason).toContain('ALL_PRECONDITIONS_MET');
      expect(result.suspectOverRestrictive).toBe(false);
    });

    it('Skenario G: Permintaan same-day ("bisa hari ini?") dengan lokasi → save_reservation DIBUKA (antrean pending check staf)', () => {
      const session: CustomerGoalSession = {
        ...baseSession,
        cartItems: [{ name: 'Pijat Bayi Ceria', price: 100000, type: 'PRIMARY' }],
        location: { rawText: 'Sedati', kecamatan: 'Sedati' },
      };
      const result = evaluateToolMasking(ALL_V3_TOOLS, session, 'Apakah bisa hari ini siang kak?');
      expect(result.isSaveReservationAllowed).toBe(true);
      expect(result.maskedToolNames.length).toBe(0);
    });
  });

  describe('3. Resolusi kandidat treatment anaphoric (Fase 1 enforce-gap)', () => {
    const emptySession: CustomerGoalSession = { ...baseSession, cartItems: [] };

    it('selectedTreatment/cart menang langsung tanpa membaca riwayat', () => {
      expect(
        resolveCandidateTreatment({ ...emptySession, selectedTreatment: 'Pijat Bayi Ceria' }, 'oke jadwalkan besok ya', [])
      ).toBe('Pijat Bayi Ceria');
      expect(
        resolveCandidateTreatment(
          { ...emptySession, cartItems: [{ name: 'Oksitosin Massage Fullbody', price: 1, type: 'PRIMARY' }] },
          'oke jadwalkan besok ya',
          []
        )
      ).toBe('Oksitosin Massage Fullbody');
    });

    it('komitmen anaphoric + rekomendasi asisten ber-bold → kandidat sah', () => {
      const history = [
        { role: 'user', content: 'Anak GTM susah makan usia 2 tahun' },
        { role: 'assistant', content: 'Bisa dibantu dengan *Pijat Lahap Juara (Nafsu Makan)* ya Bunda.' },
      ];
      expect(resolveCandidateTreatment(emptySession, 'Oke jadwalkan besok lusa ya mbak', history)).toBe(
        'Pijat Lahap Juara (Nafsu Makan)'
      );
    });

    it('tanpa sinyal komitmen → undefined walau asisten menyebut paket (anti 973126-bypass)', () => {
      const history = [
        { role: 'assistant', content: 'Bisa dibantu dengan *Pijat Lahap Juara (Nafsu Makan)* ya Bunda.' },
      ];
      expect(resolveCandidateTreatment(emptySession, 'Harganya berapa ya?', history)).toBeUndefined();
      expect(resolveCandidateTreatment(emptySession, 'Oke jadwalkan besok ya', [])).toBeUndefined();
      expect(resolveCandidateTreatment(emptySession, 'Oke jadwalkan besok ya')).toBeUndefined();
    });

    it('masker MEMBUKA save untuk komitmen anaphoric + lokasi + tanggal tegas', () => {
      const history = [
        { role: 'user', content: 'Anak GTM susah makan usia 2 tahun' },
        { role: 'assistant', content: 'Bisa dibantu dengan *Pijat Lahap Juara (Nafsu Makan)* ya Bunda.' },
      ];
      const session: CustomerGoalSession = {
        ...emptySession,
        location: { rawText: 'Rungkut Menanggal', kelurahan: 'Rungkut Menanggal' },
      };
      const result = evaluateToolMasking(ALL_V3_TOOLS, session, 'Oke jadwalkan besok lusa ya mbak', history);
      expect(result.isSaveReservationAllowed).toBe(true);
      expect(result.availableTools.some((t) => t.function?.name === 'save_reservation')).toBe(true);
    });
  });
});
